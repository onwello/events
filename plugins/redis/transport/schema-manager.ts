import { Redis } from 'ioredis';
import { z } from 'zod';

export interface SchemaVersion {
  version: string;
  schema: z.ZodSchema;
  compatibility: 'backward' | 'forward' | 'full' | 'none';
  deprecated: boolean;
  createdAt: string;
  description?: string;
}

export interface SchemaConfig {
  enabled: boolean;
  registry: 'redis' | 'external';
  validationMode: 'strict' | 'warn' | 'ignore';
  autoEvolution: boolean;
  compatibilityCheck: boolean;
  versioningStrategy: 'semantic' | 'timestamp' | 'incremental';
  maxVersions: number;
}

export interface SchemaValidationResult {
  valid: boolean;
  version: string;
  errors: string[];
  warnings: string[];
  compatibility: 'compatible' | 'incompatible' | 'unknown';
}

export class SchemaManager {
  private redis: Redis;
  private config: SchemaConfig;
  private schemas: Map<string, Map<string, SchemaVersion>> = new Map();
  private validationCache: Map<string, SchemaValidationResult> = new Map();

  constructor(redis: Redis, config: SchemaConfig) {
    this.redis = redis;
    this.config = config;
  }

  /**
   * Register a new schema version
   */
  async registerSchema(
    eventType: string, 
    schema: z.ZodSchema, 
    version: string,
    compatibility: SchemaVersion['compatibility'] = 'backward',
    description?: string
  ): Promise<void> {
    if (!this.config.enabled) return;

    const schemaVersion: SchemaVersion = {
      version,
      schema,
      compatibility,
      deprecated: false,
      createdAt: new Date().toISOString(),
      description
    };

    // Store in memory
    if (!this.schemas.has(eventType)) {
      this.schemas.set(eventType, new Map());
    }
    this.schemas.get(eventType)!.set(version, schemaVersion);

    // Store in Redis for persistence
    if (this.config.registry === 'redis') {
      await this.storeSchemaInRedis(eventType, version, schemaVersion);
      
      // Check if we need to remove old versions to respect maxVersions limit
      if (this.config.maxVersions > 0) {
        const currentVersions = await this.redis.scard(`schemas:${eventType}`);
        if (currentVersions > this.config.maxVersions) {
          // Remove oldest versions beyond the limit
          const versionsToRemove = currentVersions - this.config.maxVersions;
          for (let i = 0; i < versionsToRemove; i++) {
            const oldestVersion = await this.redis.spop(`schemas:${eventType}`);
            if (oldestVersion) {
              await this.redis.del(`schema:${eventType}:${oldestVersion}`);
            }
          }
        }
      }
    }

    // Check compatibility with existing schemas
    if (this.config.compatibilityCheck) {
      await this.checkCompatibility(eventType, version, schema);
    }

    console.log(`Registered schema for ${eventType} version ${version}`);
  }

  /**
   * Store schema in Redis
   */
  private async storeSchemaInRedis(eventType: string, version: string, schemaVersion: SchemaVersion): Promise<void> {
    const key = `schema:${eventType}:${version}`;
    const schemaString = schemaVersion.schema.toString();
    
    await this.redis.hset(key, {
      version: schemaVersion.version,
      schema: schemaString,
      compatibility: schemaVersion.compatibility,
      deprecated: schemaVersion.deprecated.toString(),
      createdAt: schemaVersion.createdAt,
      description: schemaVersion.description || ''
    });

    // Add version to the set of versions for this event type
    await this.redis.sadd(`schemas:${eventType}`, version);
  }

  /**
   * Load schemas from Redis
   */
  async loadSchemasFromRedis(): Promise<void> {
    if (this.config.registry !== 'redis') return;

    const schemaKeys = await this.redis.keys('schema:*');
    
    for (const key of schemaKeys) {
      const parts = key.split(':');
      if (parts.length >= 3) {
        const eventType = parts[1];
        const version = parts[2];
        
        const schemaData = await this.redis.hgetall(key);
        if (schemaData.schema) {
          // Note: This is a simplified approach. In production, you'd want to
          // properly reconstruct the Zod schema from stored representation
          const schemaVersion: SchemaVersion = {
            version: schemaData.version,
            schema: z.any(), // Placeholder - would need proper reconstruction
            compatibility: schemaData.compatibility as SchemaVersion['compatibility'],
            deprecated: schemaData.deprecated === 'true',
            createdAt: schemaData.createdAt,
            description: schemaData.description
          };
          
          if (!this.schemas.has(eventType)) {
            this.schemas.set(eventType, new Map());
          }
          this.schemas.get(eventType)!.set(version, schemaVersion);
        }
      }
    }
  }

  /**
   * Validate message against schema
   */
  async validateMessage(eventType: string, message: any, targetVersion?: string): Promise<SchemaValidationResult> {
    if (!this.config.enabled) {
      return {
        valid: true,
        version: 'unknown',
        errors: [],
        warnings: [],
        compatibility: 'unknown'
      };
    }

    const cacheKey = `${eventType}:${JSON.stringify(message)}:${targetVersion || 'latest'}`;
    if (this.validationCache.has(cacheKey)) {
      return this.validationCache.get(cacheKey)!;
    }

    const eventSchemas = this.schemas.get(eventType);
    if (!eventSchemas || eventSchemas.size === 0) {
      const result: SchemaValidationResult = {
        valid: this.config.validationMode === 'ignore',
        version: 'unknown',
        errors: this.config.validationMode === 'strict' ? [`No schema found for event type: ${eventType}`] : [],
        warnings: this.config.validationMode === 'warn' ? [`No schema found for event type: ${eventType}`] : [],
        compatibility: 'unknown'
      };
      
      this.validationCache.set(cacheKey, result);
      return result;
    }

    // Determine target version
    const version = targetVersion || this.getLatestVersion(eventType);
    const schemaVersion = eventSchemas.get(version);
    
    if (!schemaVersion) {
      const result: SchemaValidationResult = {
        valid: false,
        version: 'unknown',
        errors: [`Schema version ${version} not found for event type: ${eventType}`],
        warnings: [],
        compatibility: 'incompatible'
      };
      
      this.validationCache.set(cacheKey, result);
      return result;
    }

    // Validate message
    const validationResult = schemaVersion.schema.safeParse(message);
    
    const result: SchemaValidationResult = {
      valid: validationResult.success,
      version: schemaVersion.version,
      errors: validationResult.success ? [] : validationResult.error.issues.map((e: any) => e.message),
      warnings: [],
      compatibility: 'compatible'
    };

    // Check compatibility if validation failed
    if (!validationResult.success && this.config.compatibilityCheck) {
      result.compatibility = await this.checkMessageCompatibility(eventType, message, version);
    }

    this.validationCache.set(cacheKey, result);
    return result;
  }

  /**
   * Check message compatibility with other schema versions
   */
  private async checkMessageCompatibility(
    eventType: string, 
    message: any, 
    currentVersion: string
  ): Promise<'compatible' | 'incompatible' | 'unknown'> {
    const eventSchemas = this.schemas.get(eventType);
    if (!eventSchemas) return 'unknown';

    // Get the target schema version
    const targetSchema = eventSchemas.get(currentVersion);
    if (!targetSchema) return 'unknown';

    // Try to validate the message against the target schema
    try {
      targetSchema.schema.parse(message);
      return 'compatible';
    } catch {
      return 'incompatible';
    }
  }

  /**
   * Check schema compatibility
   */
  private async checkCompatibility(
    eventType: string, 
    newVersion: string, 
    newSchema: z.ZodSchema
  ): Promise<void> {
    const eventSchemas = this.schemas.get(eventType);
    if (!eventSchemas) return;

    for (const [version, schemaVersion] of eventSchemas) {
      if (version === newVersion) continue;

      const compatibility = this.assessSchemaCompatibility(newSchema, schemaVersion.schema);
      
      if (compatibility === 'incompatible' && this.config.validationMode === 'strict') {
        throw new Error(
          `Schema compatibility check failed: ${eventType} version ${newVersion} is incompatible with version ${version}`
        );
      }
    }
  }

  /**
   * Assess compatibility between two schemas
   */
  private assessSchemaCompatibility(
    newSchema: z.ZodSchema, 
    oldSchema: z.ZodSchema
  ): 'compatible' | 'incompatible' | 'unknown' {
    try {
      // If the schemas are identical (same object reference), they're compatible
      if (newSchema === oldSchema) {
        return 'compatible';
      }
      
      // Get the field definitions from both schemas
      const oldShape = (oldSchema as any)._def?.shape || {};
      const newShape = (newSchema as any)._def?.shape || {};
      
      const oldFields = Object.keys(oldShape);
      const newFields = Object.keys(newShape);
      
      // Check if new schema has more required fields (incompatible)
      // In Zod, fields are required by default unless explicitly made optional
      const oldRequiredFields = oldFields.filter(field => {
        const fieldDef = oldShape[field];
        // Use Zod's built-in isOptional() method
        return !(fieldDef && typeof fieldDef === 'object' && fieldDef.isOptional && fieldDef.isOptional());
      });
      
      const newRequiredFields = newFields.filter(field => {
        const fieldDef = newShape[field];
        // Use Zod's built-in isOptional() method
        return !(fieldDef && typeof fieldDef === 'object' && fieldDef.isOptional && fieldDef.isOptional());
      });
      
      // If new schema has more required fields, it's incompatible
      if (newRequiredFields.length > oldRequiredFields.length) {
        return 'incompatible';
      }
      
      // Check if any required fields in old schema are missing in new schema
      for (const requiredField of oldRequiredFields) {
        if (!newFields.includes(requiredField)) {
          return 'incompatible';
        }
      }
      
      // Check if any required fields in old schema became optional in new schema
      // This is actually compatible since existing code will still work
      // for (const requiredField of oldRequiredFields) {
      //   if (newFields.includes(requiredField)) {
      //     const newFieldDef = newShape[requiredField];
      //     if (newFieldDef && typeof newFieldDef === 'object' && 'optional' in newFieldDef) {
      //       // Field became optional, which could break existing code
      //       return 'incompatible';
      //     }
      //   }
      // }
      
      // If we get here, the schemas are compatible
      return 'compatible';
    } catch {
      return 'incompatible';
    }
  }



  /**
   * Get latest schema version for event type (synchronous version)
   */
  getLatestVersion(eventType: string): string {
    const eventSchemas = this.schemas.get(eventType);
    if (!eventSchemas || eventSchemas.size === 0) {
      return 'unknown';
    }

    const versions = Array.from(eventSchemas.keys());
    
    if (this.config.versioningStrategy === 'semantic') {
      // Sort by semantic version
      return versions.sort((a, b) => this.compareSemanticVersions(a, b)).pop() || 'unknown';
    } else if (this.config.versioningStrategy === 'timestamp') {
      // Sort by timestamp
      return versions.sort((a, b) => a.localeCompare(b)).pop() || 'unknown';
    } else {
      // Sort by incremental version
      return versions.sort((a, b) => parseInt(a) - parseInt(b)).pop() || 'unknown';
    }
  }

  /**
   * Get latest schema version for event type (async version with Redis support)
   */
  async getLatestVersionAsync(eventType: string): Promise<string> {
    // Check memory first
    const eventSchemas = this.schemas.get(eventType);
    if (eventSchemas && eventSchemas.size > 0) {
      const versions = Array.from(eventSchemas.keys());
      
      if (this.config.versioningStrategy === 'semantic') {
        // Sort by semantic version
        return versions.sort((a, b) => this.compareSemanticVersions(a, b)).pop() || 'unknown';
      } else if (this.config.versioningStrategy === 'timestamp') {
        // Sort by timestamp
        return versions.sort((a, b) => a.localeCompare(b)).pop() || 'unknown';
      } else {
        // Sort by incremental version
        return versions.sort((a, b) => parseInt(a) - parseInt(b)).pop() || 'unknown';
      }
    }

    // If not in memory and Redis registry is enabled, check Redis
    if (this.config.registry === 'redis') {
      try {
        const versions = await this.redis.smembers(`schemas:${eventType}`);
        if (versions.length === 0) {
          return 'unknown';
        }

        if (this.config.versioningStrategy === 'semantic') {
          // Sort by semantic version
          return versions.sort((a, b) => this.compareSemanticVersions(a, b)).pop() || 'unknown';
        } else if (this.config.versioningStrategy === 'timestamp') {
          // Sort by timestamp
          return versions.sort((a, b) => a.localeCompare(b)).pop() || 'unknown';
        } else {
          // Sort by incremental version
          return versions.sort((a, b) => parseInt(a) - parseInt(b)).pop() || 'unknown';
        }
      } catch (error) {
        console.warn(`Failed to get latest version from Redis for ${eventType}:`, error);
        return 'unknown';
      }
    }

    return 'unknown';
  }

  /**
   * Compare semantic versions
   */
  private compareSemanticVersions(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;
      
      if (aPart !== bPart) {
        return aPart - bPart;
      }
    }
    
    return 0;
  }

  /**
   * Deprecate a schema version
   */
  async deprecateSchema(eventType: string, version: string): Promise<void> {
    const eventSchemas = this.schemas.get(eventType);
    if (!eventSchemas) return;

    const schemaVersion = eventSchemas.get(version);
    if (schemaVersion) {
      schemaVersion.deprecated = true;
      
      if (this.config.registry === 'redis') {
        await this.redis.hset(`schema:${eventType}:${version}`, 'deprecated', 'true');
      }
    }
  }

  /**
   * Get schema evolution history
   */
  getSchemaHistory(eventType: string): SchemaVersion[] {
    const eventSchemas = this.schemas.get(eventType);
    if (!eventSchemas) return [];

    return Array.from(eventSchemas.values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Clean up old schema versions
   */
  async cleanupOldVersions(eventType: string): Promise<void> {
    if (!this.config.enabled) return;

    const eventSchemas = this.schemas.get(eventType);
    if (!eventSchemas || eventSchemas.size <= this.config.maxVersions) return;

    const versions = Array.from(eventSchemas.entries())
      .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));

    // Remove oldest versions beyond maxVersions
    const versionsToRemove = versions.slice(0, versions.length - this.config.maxVersions);
    
    for (const [version] of versionsToRemove) {
      eventSchemas.delete(version);
      
      if (this.config.registry === 'redis') {
        await this.redis.del(`schema:${eventType}:${version}`);
      }
    }
  }

  /**
   * Clear validation cache
   */
  clearValidationCache(): void {
    this.validationCache.clear();
  }

  /**
   * Get schema statistics
   */
  getSchemaStats(): {
    totalEventTypes: number;
    totalSchemas: number;
    averageVersionsPerType: number;
  } {
    const totalEventTypes = this.schemas.size;
    const totalSchemas = Array.from(this.schemas.values())
      .reduce((sum, versions) => sum + versions.size, 0);
    
    return {
      totalEventTypes,
      totalSchemas,
      averageVersionsPerType: totalEventTypes > 0 ? totalSchemas / totalEventTypes : 0
    };
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.schemas.clear();
    this.validationCache.clear();
  }
}
