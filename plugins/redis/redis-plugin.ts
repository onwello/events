import { Redis } from 'ioredis';
import { TransportPlugin, PluginStructure } from '../../event-transport/plugin.interface';
import { Transport, TransportCapabilities } from '../../event-transport/transport.interface';
import { EnhancedRedisStreamsTransport } from './transport/enhanced-redis-streams-transport';
import { RedisStreamsConfig } from './transport/enhanced-redis-streams-transport';

export class RedisStreamsPlugin implements TransportPlugin<RedisStreamsConfig> {
  readonly name = 'redis-streams';
  readonly version = '2.0.0';
  readonly capabilities: TransportCapabilities = {
    supportsPublishing: true,
    supportsSubscription: true,
    supportsBatching: true,
    supportsPartitioning: true, // Now supports partitioning
    supportsOrdering: true,
    supportsPatternRouting: true,
    supportsConsumerGroups: true,
    supportsDeadLetterQueues: true,
    supportsMessageRetention: true,
    supportsMessageCompression: false,
    maxMessageSize: 512 * 1024 * 1024,
    maxBatchSize: 5000,
    maxTopics: 10000,
    maxPartitions: 10000, // Support up to 10k partitions
    maxConsumerGroups: 1000,
    supportsPersistence: true,
    supportsReplication: true,
    supportsFailover: true,
    supportsTransactions: false,
    supportsMetrics: true,
    supportsTracing: false,
    supportsHealthChecks: true
  };

  createTransport(config: RedisStreamsConfig): Transport {
    // Create Redis connection
    const redisOptions: any = {
      host: config.host || 'localhost',
      port: config.port || 6379,
      db: config.db || 0,
      password: config.password,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    };

    // Use URL if provided, otherwise use host/port
    if (config.url) {
      const redis = new Redis(config.url, redisOptions);
      return new EnhancedRedisStreamsTransport(redis, config);
    } else {
      const redis = new Redis(redisOptions);
      return new EnhancedRedisStreamsTransport(redis, config);
    }
  }

  validateConfig(config: RedisStreamsConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate connection settings
    if (!config.host && !config.url) {
      errors.push('Either host or url must be provided');
    }

    if (config.port && (config.port < 1 || config.port > 65535)) {
      errors.push('Port must be between 1 and 65535');
    }

    if (config.db && (config.db < 0 || config.db > 15)) {
      errors.push('Database must be between 0 and 15');
    }

    // Validate stream settings
    if (config.maxLen && config.maxLen < 1) {
      errors.push('maxLen must be greater than 0');
    }

    if (config.trimStrategy && !['MAXLEN', 'MINID'].includes(config.trimStrategy)) {
      errors.push('trimStrategy must be either MAXLEN or MINID');
    }

    // Validate consumer settings
    if (config.batchSize && (config.batchSize < 1 || config.batchSize > 5000)) {
      errors.push('batchSize must be between 1 and 5000');
    }

    if (config.blockTime && (config.blockTime < 0 || config.blockTime > 30000)) {
      errors.push('blockTime must be between 0 and 30000ms');
    }

    if (config.maxRetries && (config.maxRetries < 0)) {
      errors.push('maxRetries must be non-negative');
    }

    if (config.retryDelay && (config.retryDelay < 0)) {
      errors.push('retryDelay must be non-negative');
    }

    // Validate performance settings
    if (config.pipelineSize && (config.pipelineSize < 1 || config.pipelineSize > 10000)) {
      errors.push('pipelineSize must be between 1 and 10000');
    }



    // Validate enterprise features if enabled
    if (config.ordering?.enabled) {
      if (config.ordering.timeoutMs && config.ordering.timeoutMs < 1000) {
        errors.push('Ordering timeout must be at least 1000ms');
      }
      if (config.ordering.maxConcurrency && config.ordering.maxConcurrency < 1) {
        errors.push('Ordering max concurrency must be at least 1');
      }
    }

    if (config.partitioning?.enabled) {
      if (config.partitioning.partitionCount && config.partitioning.partitionCount < 1) {
        errors.push('Partition count must be at least 1');
      }
      if (config.partitioning.minPartitions && config.partitioning.maxPartitions && 
          config.partitioning.minPartitions > config.partitioning.maxPartitions) {
        errors.push('Min partitions cannot be greater than max partitions');
      }
    }

    if (config.schema?.enabled) {
      if (config.schema.maxVersions && config.schema.maxVersions < 1) {
        errors.push('Max schema versions must be at least 1');
      }
    }

    if (config.replay?.enabled) {
      if (config.replay.maxReplayMessages && config.replay.maxReplayMessages < 1) {
        errors.push('Max replay messages must be at least 1');
      }
      if (config.replay.replayTimeout && config.replay.replayTimeout < 1000) {
        errors.push('Replay timeout must be at least 1000ms');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  getDefaultConfig(): RedisStreamsConfig {
    return {
      host: 'localhost',
      port: 6379,
      groupId: 'default-group',
      consumerId: `consumer-${Date.now()}`,
      streamPrefix: 'stream:',
      maxLen: 10000,
      trimStrategy: 'MAXLEN',
      batchSize: 10,
      blockTime: 1000,
      pollInterval: 100,
      maxRetries: 3,
      retryDelay: 1000,
      enableDLQ: true,
      dlqStreamPrefix: 'dlq:',
      maxRetriesBeforeDLQ: 3,
      enablePipelining: true,
      pipelineSize: 100,

      // Enterprise features disabled by default for backward compatibility
      ordering: {
        enabled: false,
        strategy: 'none',
        maxConcurrency: 1,
        timeoutMs: 5000,
        retryAttempts: 1
      },
      partitioning: {
        enabled: false,
        strategy: 'hash',
        partitionCount: 1,
        rebalanceThreshold: 1000,
        rebalanceInterval: 60000,
        loadBalancing: false,
        autoScaling: false,
        partitionRebalancing: false,
        minPartitions: 1,
        maxPartitions: 1
      },
      schema: {
        enabled: false,
        registry: 'redis',
        validationMode: 'ignore',
        autoEvolution: false,
        compatibilityCheck: false,
        versioningStrategy: 'semantic',
        maxVersions: 1
      },
      replay: {
        enabled: false,
        maxReplayMessages: 1000,
        replayTimeout: 30000,
        validateReplay: false,
        preserveOrdering: false,
        batchSize: 10,
        compression: false
      }
    };
  }

  getPluginStructure(): PluginStructure {
    return {
      transport: './transport/enhanced-redis-streams-transport',
      routing: [
        './routing/topic-router'
      ],
      tools: [
        './tools/cli-tools'
      ],
      exports: [
        './transport/redis-cluster-support'
      ]
    };
  }

  onRegister?(): void {
    console.log('Redis Streams Plugin registered with enterprise features support');
  }

  onUnregister?(): void {
    console.log('Redis Streams Plugin unregistered');
  }
}
