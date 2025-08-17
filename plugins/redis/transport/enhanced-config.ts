import { RedisStreamsConfig } from './enhanced-redis-streams-transport';
import { OrderingConfig } from './message-ordering';
import { PartitioningConfig } from './partitioning-manager';
import { SchemaConfig } from './schema-manager';
import { ReplayConfig } from './message-replay';

/**
 * Complete configuration example for enterprise-grade Redis Streams transport
 */
export const enterpriseRedisConfig: RedisStreamsConfig = {
  // Basic connection settings
  host: 'localhost',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  
  // Consumer group settings
  groupId: 'enterprise-group',
  consumerId: `consumer-${process.env.NODE_ENV || 'dev'}-${Date.now()}`,
  
  // Stream settings
  streamPrefix: 'enterprise:',
  maxLen: 100000, // Keep more messages for replay
  trimStrategy: 'MAXLEN',
  
  // Consumer settings
  batchSize: 50,
  blockTime: 2000,
  pollInterval: 100,
  maxRetries: 5,
  retryDelay: 2000,
  
  // Dead letter queue settings
  enableDLQ: true,
  dlqStreamPrefix: 'dlq:enterprise:',
  maxRetriesBeforeDLQ: 5,
  
  // Performance settings
  enablePipelining: true,
  pipelineSize: 200,
  


  // Enterprise Features Configuration
  
  // 1. Message Ordering
  ordering: {
    enabled: true,
    strategy: 'global', // 'global' | 'partition' | 'causal' | 'none'
    partitionKey: 'userId', // Use userId for partitioning
    maxConcurrency: 10,
    timeoutMs: 30000,
    retryAttempts: 3
  },

  // 2. Advanced Partitioning
  partitioning: {
    enabled: true,
    strategy: 'dynamic', // 'hash' | 'roundRobin' | 'keyBased' | 'dynamic'
    partitionCount: 16,
    rebalanceThreshold: 1000,
    rebalanceInterval: 60000, // 1 minute
    partitionKeyExtractor: (message: any) => {
      // Extract partition key from message
      if (message.userId) return message.userId;
      if (message.customerId) return message.customerId;
      if (message.orderId) return message.orderId;
      return JSON.stringify(message);
    },
    loadBalancing: true,
    autoScaling: true,
    partitionRebalancing: true,
    minPartitions: 4,
    maxPartitions: 64
  },

  // 3. Schema Management
  schema: {
    enabled: true,
    registry: 'redis', // 'redis' | 'external'
    validationMode: 'strict', // 'strict' | 'warn' | 'ignore'
    autoEvolution: true,
    compatibilityCheck: true,
    versioningStrategy: 'semantic', // 'semantic' | 'timestamp' | 'incremental'
    maxVersions: 10
  },

  // 4. Message Replay
  replay: {
    enabled: true,
    maxReplayMessages: 100000,
    replayTimeout: 300000, // 5 minutes
    validateReplay: true,
    preserveOrdering: true,
    batchSize: 100,
    compression: false
  }
};

/**
 * High-performance configuration for high-throughput scenarios
 */
export const highPerformanceConfig: RedisStreamsConfig = {
  ...enterpriseRedisConfig,
  
  // Optimize for performance
  batchSize: 200,
  pipelineSize: 500,
  enablePipelining: true,
  
  // Reduce overhead
  ordering: {
    ...enterpriseRedisConfig.ordering!,
    strategy: 'partition', // Use partition ordering for better performance
    maxConcurrency: 50
  },
  
  partitioning: {
    ...enterpriseRedisConfig.partitioning!,
    strategy: 'hash', // Use hash-based partitioning for consistency
    partitionCount: 32
  },
  
  schema: {
    ...enterpriseRedisConfig.schema!,
    validationMode: 'warn', // Reduce validation overhead
    compatibilityCheck: false
  }
};

/**
 * Development/testing configuration
 */
export const developmentConfig: RedisStreamsConfig = {
  ...enterpriseRedisConfig,
  
  // Reduce resource usage
  maxLen: 1000,
  batchSize: 10,
  pipelineSize: 50,
  
  // Disable heavy features
  ordering: {
    ...enterpriseRedisConfig.ordering!,
    enabled: false
  },
  
  partitioning: {
    ...enterpriseRedisConfig.partitioning!,
    enabled: false
  },
  
  schema: {
    ...enterpriseRedisConfig.schema!,
    validationMode: 'warn'
  },
  
  replay: {
    ...enterpriseRedisConfig.replay!,
    enabled: false
  }
};

/**
 * Production configuration with high reliability
 */
export const productionConfig: RedisStreamsConfig = {
  ...enterpriseRedisConfig,
  
  // High reliability settings
  maxRetries: 10,
  retryDelay: 5000,
  enableDLQ: true,
  maxRetriesBeforeDLQ: 10,
  

  
  // Strict validation
  schema: {
    ...enterpriseRedisConfig.schema!,
    validationMode: 'strict',
    compatibilityCheck: true
  },
  
  // Enhanced ordering
  ordering: {
    ...enterpriseRedisConfig.ordering!,
    strategy: 'global',
    timeoutMs: 60000,
    retryAttempts: 5
  }
};

/**
 * Configuration factory for different environments
 */
export class RedisConfigFactory {
  static createConfig(environment: 'dev' | 'test' | 'staging' | 'prod'): RedisStreamsConfig {
    switch (environment) {
      case 'dev':
        return developmentConfig;
      case 'test':
        return developmentConfig;
      case 'staging':
        return highPerformanceConfig;
      case 'prod':
        return productionConfig;
      default:
        return enterpriseRedisConfig;
    }
  }

  static createCustomConfig(base: RedisStreamsConfig, overrides: Partial<RedisStreamsConfig>): RedisStreamsConfig {
    return {
      ...base,
      ...overrides,
      // Deep merge for nested objects
      ordering: base.ordering && overrides.ordering ? { ...base.ordering, ...overrides.ordering } : overrides.ordering || base.ordering,
      partitioning: base.partitioning && overrides.partitioning ? { ...base.partitioning, ...overrides.partitioning } : overrides.partitioning || base.partitioning,
      schema: base.schema && overrides.schema ? { ...base.schema, ...overrides.schema } : overrides.schema || base.schema,
      replay: base.replay && overrides.replay ? { ...base.replay, ...overrides.replay } : overrides.replay || base.replay
    };
  }
}

/**
 * Configuration validation utilities
 */
export class ConfigValidator {
  static validateConfig(config: RedisStreamsConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate basic settings
    if (config.port && (config.port < 1 || config.port > 65535)) {
      errors.push('Port must be between 1 and 65535');
    }

    if (config.batchSize && (config.batchSize < 1 || config.batchSize > 1000)) {
      errors.push('Batch size must be between 1 and 1000');
    }

    // Validate enterprise features
    if (config.ordering?.enabled) {
      if (config.ordering.timeoutMs < 1000) {
        errors.push('Ordering timeout must be at least 1000ms');
      }
      if (config.ordering.maxConcurrency < 1) {
        errors.push('Ordering max concurrency must be at least 1');
      }
    }

    if (config.partitioning?.enabled) {
      if (config.partitioning.partitionCount < 1) {
        errors.push('Partition count must be at least 1');
      }
      if (config.partitioning.minPartitions > config.partitioning.maxPartitions) {
        errors.push('Min partitions cannot be greater than max partitions');
      }
    }

    if (config.schema?.enabled) {
      if (config.schema.maxVersions < 1) {
        errors.push('Max schema versions must be at least 1');
      }
    }

    if (config.replay?.enabled) {
      if (config.replay.maxReplayMessages < 1) {
        errors.push('Max replay messages must be at least 1');
      }
      if (config.replay.replayTimeout < 1000) {
        errors.push('Replay timeout must be at least 1000ms');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
