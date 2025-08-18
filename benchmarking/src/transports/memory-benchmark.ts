import { TransportBenchmark } from '../types';
import { TransportCapabilities } from '@logistically/events/event-transport/transport.interface';
import { createEventSystemBuilder } from '@logistically/events';

export class MemoryBenchmark implements TransportBenchmark {
  name = 'memory';
  capabilities: TransportCapabilities = {
    supportsPublishing: true,
    supportsSubscription: true,
    supportsBatching: true,
    supportsPartitioning: false,
    supportsOrdering: false,
    supportsPatternRouting: true,
    supportsConsumerGroups: false,
    supportsDeadLetterQueues: false,
    supportsMessageRetention: false,
    supportsMessageCompression: false,
    maxMessageSize: 1024 * 1024, // 1MB
    maxBatchSize: 100,
    maxTopics: 1000,
    maxPartitions: 1,
    maxConsumerGroups: 0,
    supportsPersistence: false,
    supportsReplication: false,
    supportsFailover: false,
    supportsTransactions: false,
    supportsMetrics: false,
    supportsTracing: false,
    supportsHealthChecks: true
  };

  async createTransport(config: any, iteration?: number): Promise<any> {
    const defaultConfig = this.getDefaultConfig();
    const mergedConfig = { ...defaultConfig, ...config };
    
    // Validate configuration
    const validation = this.validateConfig(mergedConfig);
    if (!validation.valid) {
      throw new Error(`Invalid Memory configuration: ${validation.errors.join(', ')}`);
    }
    
    // Create EventSystem instance with memory transport
    const eventSystem = createEventSystemBuilder()
      .service('benchmark-service')
      .addTransportFromFactory('memory', 'memory', mergedConfig)
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
        enableBatching: false,
        enablePartitioning: false,
        enableConsumerGroups: false
      })
      .enablePublisherBatching({
        enabled: false,
        maxSize: 1,
        maxWaitMs: 0,
        maxConcurrentBatches: 1,
        strategy: 'size'
      })
      .build();

    // Connect to the event system
    await eventSystem.connect();
    
    return eventSystem;
  }

  async cleanup(): Promise<void> {
    // Memory transport doesn't need cleanup
  }

  getDefaultConfig(): any {
    return {
      // Memory transport specific settings
      maxQueueSize: 10000,
      enableAsyncProcessing: true,
      processingDelay: 0, // No artificial delay
      
      // Performance tuning
      batchSize: 1,
      maxConcurrentHandlers: 1,
      
      // Reliability - minimal for performance testing
      enableRetries: false,
      maxRetries: 0,
      
      // Advanced features - disable for performance testing
      enablePartitioning: false,
      partitionCount: 1,
      enableMessageOrdering: false,
      enableSchemaValidation: false,
      
      // Monitoring - disable for performance testing
      enableMetrics: false,
      metricsInterval: 5000
    };
  }

  validateConfig(config: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (config.maxQueueSize && config.maxQueueSize < 1) {
      errors.push('maxQueueSize must be at least 1');
    }
    
    if (config.processingDelay && config.processingDelay < 0) {
      errors.push('processingDelay must be non-negative');
    }
    
    if (config.batchSize && config.batchSize < 1) {
      errors.push('batchSize must be at least 1');
    }
    
    return { valid: errors.length === 0, errors };
  }
}
