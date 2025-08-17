import { TransportCapabilities } from '../event-transport/transport.interface';

// Event routing configuration - must be explicitly provided
export interface EventRoute {
  pattern: string; // Pattern string (e.g., 'user.*', '*.user.*')
  transport: string; // Transport name/identifier
  priority?: number; // Higher priority routes are matched first
  options?: {
    topic?: string; // Custom Redis topic (optional, uses namespace strategy if not provided)
    partition?: number;
    ordering?: 'strict' | 'per-partition' | 'none';
    retention?: {
      maxAge?: number;
      maxSize?: number;
      maxMessages?: number;
    };
  };
}

// Routing configuration interface
export interface RoutingConfig {
  routes: EventRoute[];
  validationMode: 'strict' | 'warn' | 'ignore';
  originPrefix?: string;  // e.g., 'eu.de', 'us.ca', 'dz.ma'
  topicMapping: {
    [pattern: string]: string;  // e.g., '*.user.*' -> 'user'
  };
  defaultTopicStrategy: 'namespace' | 'custom';  // 'custom' uses a configurable word
  customTopicWord?: string;  // Used when defaultTopicStrategy is 'custom'
  enablePatternRouting?: boolean;
  enableBatching?: boolean;
  enablePartitioning?: boolean;
  enableConsumerGroups?: boolean;
}

// Routing validation result
export interface RoutingValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  unsupportedFeatures: string[];
}



// Routing engine that validates and matches routes
export class EventRouter {
  private config: RoutingConfig;
  private transportCapabilities: Map<string, TransportCapabilities>;

  constructor(config: RoutingConfig, transportCapabilities: Map<string, TransportCapabilities>) {
    this.config = config;
    this.transportCapabilities = transportCapabilities;
    
    // Validate configuration
    const validation = this.validateConfiguration();
    if (validation.errors.length > 0) {
      throw new Error(`Invalid routing configuration: ${validation.errors.join(', ')}`);
    }
    
    if (validation.warnings.length > 0 && config.validationMode === 'strict') {
      throw new Error(`Routing configuration warnings: ${validation.warnings.join(', ')}`);
    }
  }

  // Validate event type format (alphanumeric + dots only, no wildcards)
  validateEventType(eventType: string): boolean {
    const pattern = /^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/;
    return pattern.test(eventType);
  }

  // Validate origin prefix format (alphanumeric + dots only)
  private validateOriginPrefix(originPrefix: string): boolean {
    const pattern = /^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/;
    return pattern.test(originPrefix);
  }

  // Validate pattern format
  private validatePattern(pattern: string): boolean {
    // Basic checks
    if (!pattern || pattern.length === 0) {
      return false;
    }
    
    // Only allow alphanumeric characters, dots, and asterisks
    const validChars = /^[a-zA-Z0-9.*]+$/;
    if (!validChars.test(pattern)) {
      return false;
    }
    
    // Cannot start or end with a dot
    if (pattern.startsWith('.') || pattern.endsWith('.')) {
      return false;
    }
    
    // Cannot have consecutive dots
    if (pattern.includes('..')) {
      return false;
    }
    
    // Cannot have consecutive asterisks
    if (pattern.includes('**')) {
      return false;
    }
    
    // Asterisk validation rules:
    // 1. Asterisk can be at the beginning or end of the entire pattern
    // 2. Asterisk can be in the middle as a single segment wildcard
    // 3. Valid patterns: *.user.*, user.*, *.user, user.created, user.*.updated
    // 4. Invalid patterns: user.created.*, *.user.created, user*created
    
    const segments = pattern.split('.');
    
    // Check if pattern starts with asterisk
    const startsWithAsterisk = segments[0] === '*';
    
    // Check if pattern ends with asterisk
    const endsWithAsterisk = segments[segments.length - 1] === '*';
    
    // Check for invalid asterisk usage in segments
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      // Segment can be just '*' (wildcard) or alphanumeric
      if (segment !== '*' && segment.includes('*')) {
        // Segment contains asterisk but is not just '*'
        // This means asterisk is mixed with other characters, which is invalid
        return false;
      }
    }
    
    return true;
  }

  // Validate and normalize pattern
  validateAndNormalizePattern(pattern: string): string {
    if (!this.validatePattern(pattern)) {
      throw new Error(`Invalid pattern '${pattern}': Only alphanumeric characters, dots (.), and asterisks (*) are allowed. Patterns must follow the format '*.subtopic.*' or 'namespace.*'`);
    }
    
    // Normalize to lowercase
    return pattern.toLowerCase();
  }

  // Check if event type matches a pattern with origin prefix awareness
  matchesPattern(eventType: string, pattern: string): boolean {
    // Validate the pattern first
    const normalizedPattern = this.validateAndNormalizePattern(pattern);
    const normalizedEventType = this.normalizeEventType(eventType);
    
    // Special case: if pattern doesn't contain wildcards, use exact matching
    // This ensures exact patterns like 'user.created' only match the exact event type
    if (!normalizedPattern.includes('*')) {
      // For exact patterns, check if they match exactly (with or without origin prefix)
      if (this.config.originPrefix) {
        // When origin prefix is configured, exact patterns should ONLY match with that prefix
        // This enforces regional isolation - different origin prefixes should not match
        return normalizedEventType === `${this.config.originPrefix}.${normalizedPattern}`;
      } else {
        // No origin prefix configured, exact match
        return normalizedEventType === normalizedPattern;
      }
    }
    
    // Convert pattern to regex for wildcard matching
    const regexPattern = this.patternToRegex(normalizedPattern);
    const regex = new RegExp(regexPattern);
    
    return regex.test(normalizedEventType);
  }

  // Convert pattern to regex with origin prefix awareness
  private patternToRegex(pattern: string): string {
    // Handle special cases for origin prefix patterns
    if (pattern.startsWith('*.')) {
      // Pattern like *.user.* or *.user - matches any origin prefix
      // For *.user.*, we want to match:
      // - user.created (no prefix)
      // - eu.de.user.subscribed (with prefix)
      // - us.ca.user.login (with prefix)
      // - eu.de.user (with prefix, no suffix)
      
      // Remove the leading *. and convert to regex
      const withoutLeadingStar = pattern.substring(2); // Remove "*. "
      let regexPattern = withoutLeadingStar.replace(/\./g, '\\.').replace(/\*/g, '.*');
      
      // Add optional prefix and make the pattern flexible
      if (pattern.endsWith('.*')) {
        // Pattern like *.user.* - should match user.anything or prefix.user.anything or prefix.user
        const basePattern = withoutLeadingStar.replace(/\.\*$/, ''); // Remove trailing .*
        regexPattern = `^(.*\\.)?${basePattern}(\\.(.*))?$`;
      } else {
        // Pattern like *.user
        regexPattern = `^(.*\\.)?${regexPattern}$`;
      }
      
      return regexPattern;
    } else if (pattern.includes('.*')) {
      // Pattern like user.* - should respect origin prefix
      if (this.config.originPrefix) {
        // For patterns like 'user.*', we need to match 'originprefix.user.*'
        const parts = pattern.split('.*');
        if (parts.length === 2 && parts[1] === '') {
          // Pattern ends with .* (e.g., 'user.*')
          const namespace = parts[0];
          // Create a regex that matches the pattern as a suffix
          // This allows 'user.*' to match 'us.ca.user.created'
          return `^.*\\.${namespace}\\.(.*)$`;
        }
      }
      
      // Fallback for other patterns
      let regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
      // For patterns like 'user.*', when origin prefix is configured, only match events with that prefix
      if (pattern.endsWith('.*')) {
        const basePattern = pattern.replace(/\.\*$/, '');
        if (this.config.originPrefix) {
          // When origin prefix is configured, ONLY match events with that specific prefix
          // This enforces regional isolation
          regexPattern = `^${this.config.originPrefix.replace(/\./g, '\\.')}\\.${basePattern.replace(/\./g, '\\.')}\\.(.*)$`;
        } else {
          // No origin prefix configured, allow any prefix
          regexPattern = `^(.*\\.)?${basePattern.replace(/\./g, '\\.')}\\.(.*)$`;
        }
      } else {
        regexPattern = `^${regexPattern}$`;
      }
      return regexPattern;
    } else {
      // Exact match pattern
      if (this.config.originPrefix) {
        // For exact patterns, we need to match with origin prefix
        // But also allow the pattern to match as a suffix when origin prefix is present
        return `^(.*\\.)?${pattern.replace(/\./g, '\\.')}$`;
      } else {
        // No origin prefix, exact match
        let regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
        regexPattern = `^${regexPattern}$`;
        return regexPattern;
      }
    }
  }

  // Validate topic name format (lowercase alphanumeric and hyphens allowed)
  private validateTopicName(topicName: string): boolean {
    const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    return pattern.test(topicName);
  }



  // Normalize event type to lowercase with warning
  normalizeEventType(eventType: string): string {
    if (eventType !== eventType.toLowerCase()) {
      console.warn(`Warning: Event type '${eventType}' contains uppercase characters. Converting to lowercase.`);
    }
    return eventType.toLowerCase();
  }



  // Resolve Redis topic for a message type using origin-based strategy
  resolveTopic(eventType: string): string {
    // Normalize event type to lowercase
    const normalizedEventType = this.normalizeEventType(eventType);
    
    // Check if the event type already has the origin prefix
    const hasOriginPrefix = this.config.originPrefix && normalizedEventType.startsWith(this.config.originPrefix + '.');
    
    // Apply origin prefix if configured and not already present
    let fullEventType = normalizedEventType;
    if (this.config.originPrefix && !hasOriginPrefix) {
      fullEventType = `${this.config.originPrefix}.${normalizedEventType}`;
    }
    
    // Check topic mapping patterns first
    if (this.config.topicMapping) {
      // Check against the full event type (with origin prefix)
      for (const [pattern, topicName] of Object.entries(this.config.topicMapping)) {
        if (this.matchesPatternForTopicMapping(fullEventType, pattern)) {
          const resolvedTopic = `${topicName}-events`;
          return resolvedTopic;
        }
      }
      
      // Also check against the original event type (without origin prefix)
      // This allows patterns like 'user.created' to match 'us.ca.user.created'
      for (const [pattern, topicName] of Object.entries(this.config.topicMapping)) {
        if (this.matchesPatternForTopicMapping(normalizedEventType, pattern)) {
          const resolvedTopic = `${topicName}-events`;
          return resolvedTopic;
        }
      }
    }
    
    // Apply default topic strategy
    const fallbackTopic = this.applyDefaultTopicStrategy(fullEventType);
    return fallbackTopic;
  }
  
  // Pattern matching method specifically for topic mapping (allows suffix matching)
  private matchesPatternForTopicMapping(eventType: string, pattern: string): boolean {
    // Validate the pattern first
    const normalizedPattern = this.validateAndNormalizePattern(pattern);
    const normalizedEventType = this.normalizeEventType(eventType);
    
    // For topic mapping, allow suffix matching for exact patterns
    // This allows patterns like 'user.created' to match 'us.ca.user.created'
    if (!normalizedPattern.includes('*')) {
      if (normalizedEventType.endsWith(normalizedPattern)) {
        return true;
      }
    }
    
    // Convert pattern to regex for wildcard matching
    const regexPattern = this.patternToRegex(normalizedPattern);
    const regex = new RegExp(regexPattern);
    
    return regex.test(normalizedEventType);
  }

  // Apply default topic strategy
  private applyDefaultTopicStrategy(eventType: string): string {
    // For namespace strategy, we need to use the original event type (without origin prefix)
    // since the origin prefix is not part of the logical namespace
    const originalEventType = this.config.originPrefix && eventType.startsWith(this.config.originPrefix + '.') 
      ? eventType.substring(this.config.originPrefix.length + 1) 
      : eventType;
    
    const parts = originalEventType.split('.');
    
    switch (this.config.defaultTopicStrategy) {
      case 'namespace':
        // Use first segment as namespace
        if (parts.length > 0 && parts[0]) {
          return `${parts[0]}-events`;
        }
        break;
      case 'custom':
        // Use configured custom word
        if (this.config.customTopicWord) {
          return `${this.config.customTopicWord}-events`;
        }
        break;
    }
    
    // Fallback to unroutable if we can't determine topic
    return 'unroutable';
  }





  // Validate that a transport supports the required features
  validateTransportFeatures(transportName: string, requiredFeatures: string[]): RoutingValidationResult {
    const capabilities = this.transportCapabilities.get(transportName);
    if (!capabilities) {
      return {
        valid: false,
        warnings: [],
        errors: [`Transport '${transportName}' not found`],
        unsupportedFeatures: requiredFeatures
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const unsupportedFeatures: string[] = [];

    // Check each required feature
    for (const feature of requiredFeatures) {
      switch (feature) {
        case 'patternRouting':
          if (!capabilities.supportsPatternRouting) {
            if (this.config.validationMode === 'strict') {
              errors.push(`Transport '${transportName}' does not support pattern routing`);
            } else if (this.config.validationMode === 'warn') {
              warnings.push(`Transport '${transportName}' does not support pattern routing`);
            }
            unsupportedFeatures.push(feature);
          }
          break;
        case 'batching':
          if (!capabilities.supportsBatching) {
            if (this.config.validationMode === 'strict') {
              errors.push(`Transport '${transportName}' does not support batching`);
            } else if (this.config.validationMode === 'warn') {
              warnings.push(`Transport '${transportName}' does not support batching`);
            }
            unsupportedFeatures.push(feature);
          }
          break;
        case 'partitioning':
          if (!capabilities.supportsPartitioning) {
            if (this.config.validationMode === 'strict') {
              errors.push(`Transport '${transportName}' does not support partitioning`);
            } else if (this.config.validationMode === 'warn') {
              warnings.push(`Transport '${transportName}' does not support partitioning`);
            }
            unsupportedFeatures.push(feature);
          }
          break;
        case 'consumerGroups':
          if (!capabilities.supportsConsumerGroups) {
            if (this.config.validationMode === 'strict') {
              errors.push(`Transport '${transportName}' does not support consumer groups`);
            } else if (this.config.validationMode === 'warn') {
              warnings.push(`Transport '${transportName}' does not support consumer groups`);
            }
            unsupportedFeatures.push(feature);
          }
          break;
        default:
          warnings.push(`Unknown feature requirement: ${feature}`);
      }
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
      unsupportedFeatures
    };
  }

  // Get all routes for a specific transport
  getRoutesForTransport(transportName: string): EventRoute[] {
    if (!this.config.routes || this.config.routes.length === 0) {
      return [];
    }
    return this.config.routes.filter(route => route.transport === transportName);
  }

  // Get all configured transports
  getConfiguredTransports(): string[] {
    const transports = new Set<string>();
    
    // Add transports from routes if they exist
    if (this.config.routes && this.config.routes.length > 0) {
      for (const route of this.config.routes) {
        transports.add(route.transport);
      }
    }
    
    // Add default transport if configured
    // This logic is no longer needed as defaultTransport is removed from config
    // if (this.config.defaultTransport) {
    //   transports.add(this.config.defaultTransport);
    // }
    
    return Array.from(transports);
  }

  // Cache compiled patterns and namespace mappings for performance




  // Update transport capabilities (useful for dynamic transport discovery)
  updateTransportCapabilities(transportName: string, capabilities: TransportCapabilities): void {
    this.transportCapabilities.set(transportName, capabilities);
  }

  // Remove transport capabilities
  removeTransportCapabilities(transportName: string): void {
    this.transportCapabilities.delete(transportName);
  }

  // Private method to validate the routing configuration
  private validateConfiguration(): RoutingValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate origin prefix if provided
    if (this.config.originPrefix) {
      if (!this.validateOriginPrefix(this.config.originPrefix)) {
        errors.push(`Invalid origin prefix '${this.config.originPrefix}'. Only alphanumeric characters and dots allowed.`);
      }
    }

    // Validate topic mapping patterns
    if (this.config.topicMapping) {
      for (const [pattern, topicName] of Object.entries(this.config.topicMapping)) {
        if (!this.validatePattern(pattern)) {
          errors.push(`Invalid topic mapping pattern '${pattern}'. Only alphanumeric characters, dots, and wildcards allowed.`);
        }
        if (!this.validateTopicName(topicName)) {
          errors.push(`Invalid topic name '${topicName}'. Only lowercase alphanumeric characters and hyphens allowed.`);
        }
      }
    }

    // Validate default topic strategy
    if (this.config.defaultTopicStrategy === 'custom' && !this.config.customTopicWord) {
      errors.push('Custom topic strategy requires customTopicWord to be specified.');
    }

    // Check if routes are provided
    if (!this.config.routes || this.config.routes.length === 0) {
      // If no routes, return early to avoid validation errors
      return {
        valid: errors.length === 0,
        warnings,
        errors,
        unsupportedFeatures: []
      };
    }

    // Validate route patterns and topics
    for (const route of this.config.routes) {
      if (!route.pattern) {
        errors.push('Routing patterns are not optional');
      }
      
      if (!route.transport) {
        errors.push('All routes must specify a transport');
      }
      
      // Validate route pattern format
      if (route.pattern && !this.validatePattern(route.pattern)) {
        errors.push(`Invalid route pattern '${route.pattern}'. Only alphanumeric characters, dots, and wildcards allowed.`);
      }
      
      // Validate topic if specified
      if (route.options?.topic) {
        const topic = route.options.topic;
        if (topic !== topic.toLowerCase()) {
          warnings.push(`Route pattern '${route.pattern}' has uppercase topic '${topic}' - converting to lowercase`);
          route.options.topic = topic.toLowerCase();
        }
        
        // Validate topic format (alphanumeric + hyphens only)
        const topicPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
        if (!topicPattern.test(route.options.topic)) {
          errors.push(`Invalid topic format '${route.options.topic}' - only lowercase alphanumeric characters and hyphens allowed`);
        }
      }
    }

    // Check for conflicting patterns
    const patterns = this.config.routes.map(r => r.pattern);
    const uniquePatterns = new Set(patterns);
    if (patterns.length !== uniquePatterns.size) {
      warnings.push('Duplicate route patterns detected - only the first match will be used');
    }

    // Validate feature requirements against transport capabilities
    if (this.config.enablePatternRouting) {
      const transports = this.getConfiguredTransports();
      const supportingTransports = transports.filter(transport => {
        const capabilities = this.transportCapabilities.get(transport);
        return capabilities?.supportsPatternRouting;
      });
      
      if (supportingTransports.length === 0) {
        errors.push('No configured transports support pattern routing');
      } else if (supportingTransports.length < transports.length) {
        warnings.push(`Some transports (${transports.filter(t => !supportingTransports.includes(t)).join(', ')}) do not support pattern routing`);
      }
    }

    if (this.config.enableBatching) {
      const transports = this.getConfiguredTransports();
      const supportingTransports = transports.filter(transport => {
        const capabilities = this.transportCapabilities.get(transport);
        return capabilities?.supportsBatching;
      });
      
      if (supportingTransports.length === 0) {
        errors.push('No configured transports support batching');
      } else if (supportingTransports.length < transports.length) {
        warnings.push(`Some transports (${transports.filter(t => !supportingTransports.includes(t)).join(', ')}) do not support batching`);
      }
    }

    if (this.config.enablePartitioning) {
      const transports = this.getConfiguredTransports();
      const supportingTransports = transports.filter(transport => {
        const capabilities = this.transportCapabilities.get(transport);
        return capabilities?.supportsPartitioning;
      });
      
      if (supportingTransports.length === 0) {
        errors.push('No configured transports support partitioning');
      } else if (supportingTransports.length < transports.length) {
        warnings.push(`Some transports (${transports.filter(t => !supportingTransports.includes(t)).join(', ')}) do not support partitioning`);
      }
    }

    if (this.config.enableConsumerGroups) {
      const transports = this.getConfiguredTransports();
      const supportingTransports = transports.filter(transport => {
        const capabilities = this.transportCapabilities.get(transport);
        return capabilities?.supportsConsumerGroups;
      });
      
      if (supportingTransports.length === 0) {
        errors.push('No configured transports support consumer groups');
      } else if (supportingTransports.length < transports.length) {
        warnings.push(`Some transports (${transports.filter(t => !supportingTransports.includes(t)).join(', ')}) do not support consumer groups`);
      }
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
      unsupportedFeatures: []
    };
  }
}

// Factory function to create a router with validation
export function createEventRouter(
  config: RoutingConfig, 
  transportCapabilities: Map<string, TransportCapabilities>
): EventRouter {
  return new EventRouter(config, transportCapabilities);
}



// Helper function to create a basic routing configuration
export function createBasicRoutingConfig(
  routes: EventRoute[],
  validationMode: 'strict' | 'warn' | 'ignore' = 'warn',
  originPrefix?: string,
  topicMapping: { [pattern: string]: string } = {},
  defaultTopicStrategy: 'namespace' | 'custom' = 'namespace',
  customTopicWord?: string
): RoutingConfig {
  return {
    routes,
    validationMode,
    originPrefix,
    topicMapping,
    defaultTopicStrategy,
    customTopicWord,
    enablePatternRouting: false,
    enableBatching: false,
    enablePartitioning: false,
    enableConsumerGroups: false
  };
}

// Types are exported through the class definitions above 

// Default routing configuration for backward compatibility
export const defaultRoutingConfig: RoutingConfig = {
  routes: [],
  validationMode: 'warn',
  topicMapping: {},
  defaultTopicStrategy: 'namespace',
  enablePatternRouting: false,
  enableBatching: false,
  enablePartitioning: false,
  enableConsumerGroups: false
};

// Export the default config as the default export
export default defaultRoutingConfig; 