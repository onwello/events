import { TransportBenchmark } from '../types';
import { TransportCapabilities } from '@logistically/events/event-transport/transport.interface';
import { createEventSystemBuilder } from '@logistically/events';

export class RedisBenchmark implements TransportBenchmark {
  readonly name = 'redis';
  
  readonly capabilities: TransportCapabilities = {
    // Core capabilities
    supportsPublishing: true,
    supportsSubscription: true,
    supportsBatching: true,
    supportsPartitioning: true,
    supportsOrdering: true,
    supportsPatternRouting: true,
    supportsConsumerGroups: true,
    supportsDeadLetterQueues: true,
    supportsMessageRetention: true,
    supportsMessageCompression: false,
    
    // Performance characteristics
    maxMessageSize: 1024 * 1024, // 1MB
    maxBatchSize: 1000,
    maxTopics: 10000,
    maxPartitions: 100,
    maxConsumerGroups: 1000,
    
    // Reliability features
    supportsPersistence: true,
    supportsReplication: true,
    supportsFailover: true,
    supportsTransactions: false,
    
    // Monitoring and observability
    supportsMetrics: true,
    supportsTracing: true,
    supportsHealthChecks: true
  };

  async createTransport(config: any, iteration?: number): Promise<any> {
    const defaultConfig = this.getDefaultConfig();
    const mergedConfig = { ...defaultConfig, ...config };
    
    // Validate configuration
    const validation = this.validateConfig(mergedConfig);
    if (!validation.valid) {
      throw new Error(`Invalid Redis configuration: ${validation.errors.join(', ')}`);
    }
    
    // Determine batching settings from config
    const batchSize = mergedConfig.batchSize || 1;
    const flushInterval = mergedConfig.flushInterval || 0;
    const enableBatching = batchSize > 1 || flushInterval > 0;
    
    // Create EventSystem instance
    const eventSystem = createEventSystemBuilder()
      .service('benchmark-service')
      .addTransportFromFactory('redis', 'redis-streams', mergedConfig)
      .originPrefix('benchmark')
      .setValidationMode('warn')
      .routing({
        routes: [],
        validationMode: 'warn',
        topicMapping: {
          'topic.default': 'topic-default'
        },
        defaultTopicStrategy: 'namespace',
        enablePatternRouting: true,
        enableBatching: enableBatching,
        enablePartitioning: false,
        enableConsumerGroups: true
      })
      .enablePublisherBatching({
        enabled: enableBatching,
        maxSize: batchSize,
        maxWaitMs: flushInterval,
        maxConcurrentBatches: 1,
        strategy: 'size'
      })
      .enableConsumerPatternRouting()
      .enableConsumerGroups()
      .build();

    // Connect to the event system
    await eventSystem.connect();
    
    return eventSystem;
  }

  async cleanup(): Promise<void> {
    // No cleanup needed in the new design - EventSystem is managed by the runner
  }

  getDefaultConfig(): any {
    return {
      host: 'localhost',
      port: 6379,
      db: 0,
      groupId: 'benchmark-group',
      consumerId: 'benchmark-consumer',
      streamPrefix: 'stream:',
      maxLen: 10000,
      trimStrategy: 'MAXLEN',
      batchSize: 100, // Increased from 1 for better throughput
      blockTime: 50,  // Increased from 1ms to reduce polling frequency
      pollInterval: 10, // Increased from 1ms to reduce overhead
      maxRetries: 0,
      retryDelay: 1000,
      enableDLQ: false,
      dlqStreamPrefix: 'dlq:',
      maxRetriesBeforeDLQ: 0,
      enablePipelining: true,
      pipelineSize: 100,
      skipStreamGroupCheck: true,
      enableMetrics: false,
      // Enable connection pooling for concurrent publishing
      connectionPool: {
        enabled: true,
        size: 10, // 10 Redis connections in the pool
        maxConcurrentPublishers: 20 // Allow up to 20 concurrent publishing operations
      }
    };
  }

  validateConfig(config: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Validate Redis connection
    if (!config.url && (!config.host || !config.port)) {
      errors.push('Either url or host+port must be specified');
    }
    
    if (config.port && (config.port < 1 || config.port > 65535)) {
      errors.push('Port must be between 1 and 65535');
    }
    
    // Validate consumer group
    if (!config.groupId || typeof config.groupId !== 'string') {
      errors.push('Valid groupId must be specified');
    }
    
    // Validate performance settings
    if (config.blockTime && (config.blockTime < 0 || config.blockTime > 60000)) {
      errors.push('Block time must be between 0 and 60000ms');
    }
    
    if (config.batchSize && (config.batchSize < 1 || config.batchSize > 10000)) {
      errors.push('Batch size must be between 1 and 10000');
    }
    
    // Validate partitioning
    if (config.enablePartitioning) {
      if (config.partitionCount < 1 || config.partitionCount > 100) {
        errors.push('Partition count must be between 1 and 100');
      }
    }
    
    // Validate retry configuration
    if (config.maxRetries < 0 || config.maxRetries > 10) {
      errors.push('Max retries must be between 0 and 10');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}
