// Redis Plugin Exports
export { RedisStreamsPlugin } from './redis-plugin';
export type { RedisStreamsConfig } from './transport/enhanced-redis-streams-transport';

// Enhanced Transport Export (supersedes old RedisStreamsTransport)
export { EnhancedRedisStreamsTransport } from './transport/enhanced-redis-streams-transport';

// Enterprise Feature Managers (for advanced usage)
export { MessageOrderingManager } from './transport/message-ordering';
export { PartitioningManager } from './transport/partitioning-manager';
export { SchemaManager } from './transport/schema-manager';
export { MessageReplayManager } from './transport/message-replay';

// Configuration and Utilities
export { 
  enterpriseRedisConfig, 
  highPerformanceConfig, 
  developmentConfig, 
  productionConfig,
  RedisConfigFactory,
  ConfigValidator 
} from './transport/enhanced-config';

// Legacy Support (deprecated, use EnhancedRedisStreamsTransport instead)
export { RedisClusterManager } from './transport/redis-cluster-support';
export { TopicRouter, TopicRegistry } from './routing/topic-router';
export { RedisCLITools } from './tools/cli-tools';
