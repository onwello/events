
// Transport config types are now plugin-specific

// Core message types - now using EventEnvelope directly
export interface EventEnvelope<T = any> {
  header: {
    id: string;
    type: string;
    origin: string;
    originPrefix?: string;  // Regional/organizational prefix (e.g., 'eu.de', 'us.ca')
    timestamp: string;
    hash: string;
    version: string;
  };
  body: T;
}

// MessageMetadata for transport-specific information
export interface MessageMetadata {
  topic: string;
  partition?: number;
  offset: string;
  timestamp: number;
  headers?: Record<string, string>;
  matchedPattern?: string;
  correlationId?: string;
  traceId?: string;
}

// Configuration interface moved to event-system-builder.ts to avoid duplication

// Transport capabilities - these define what features a transport supports
export interface TransportCapabilities {
  // Core capabilities
  supportsPublishing: boolean;
  supportsSubscription: boolean;
  supportsBatching: boolean;
  supportsPartitioning: boolean;
  supportsOrdering: boolean;
  supportsPatternRouting: boolean;
  supportsConsumerGroups: boolean;
  supportsDeadLetterQueues: boolean;
  supportsMessageRetention: boolean;
  supportsMessageCompression: boolean;
  
  // Performance characteristics
  maxMessageSize: number;
  maxBatchSize: number;
  maxTopics: number;
  maxPartitions: number;
  maxConsumerGroups: number;
  
  // Reliability features
  supportsPersistence: boolean;
  supportsReplication: boolean;
  supportsFailover: boolean;
  supportsTransactions: boolean;
  
  // Monitoring and observability
  supportsMetrics: boolean;
  supportsTracing: boolean;
  supportsHealthChecks: boolean;
}

// Publish options that may not be supported by all transports
export interface PublishOptions {
  partitionKey?: string;
  partition?: number;
  headers?: Record<string, string>;
  correlationId?: string;
  traceId?: string;
  priority?: number;
  ttl?: number;
  ordering?: 'strict' | 'per-partition' | 'none';
  batchKey?: string; // For batching support
}

// Subscribe options that may not be supported by all transports
export interface SubscribeOptions {
  groupId?: string;
  consumerId?: string;
  autoOffsetReset?: 'earliest' | 'latest' | 'specific';
  enableAutoCommit?: boolean;
  autoCommitInterval?: number;
  partition?: number;
  startOffset?: string;
  maxPollRecords?: number;
  sessionTimeout?: number;
  heartbeatInterval?: number;
}

// Batch options for transports that support batching
export interface BatchOptions {
  maxSize: number;
  maxWaitMs: number;
  maxConcurrentBatches: number;
  compression?: boolean;
  ordering?: 'strict' | 'per-partition' | 'none';
}

// Message handler interface
export type MessageHandler<T = any> = (
  message: EventEnvelope<T>, 
  metadata: MessageMetadata
) => Promise<void> | void;

// Pattern handler for wildcard subscriptions
export type PatternHandler<T = any> = (
  message: EventEnvelope<T>, 
  metadata: MessageMetadata,
  matchedPattern: string
) => Promise<void> | void;

// Core transport interface - all transports must implement this
export interface Transport {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  
  // Core methods - all transports must support these
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // Publishing - all transports must support basic publishing
  // Users can pass any data, library creates EventEnvelope internally
  publish(topic: string, message: any, options?: PublishOptions): Promise<void>;
  
  // Subscription - all transports must support basic subscription
  subscribe(topic: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  
  // Lifecycle
  close(): Promise<void>;
  
  // Health and status
  getStatus(): Promise<TransportStatus>;
  getMetrics(): Promise<TransportMetrics>;
}

// Extended transport interface for advanced features
export interface AdvancedTransport extends Transport {
  // Pattern-based routing (optional)
  subscribePattern?(pattern: string, handler: PatternHandler, options?: SubscribeOptions): Promise<void>;
  unsubscribePattern?(pattern: string): Promise<void>;
  
  // Batching (optional) - now with consistent signature accepting any data type
  publishBatch?(topic: string, messages: any[], options?: PublishOptions & BatchOptions): Promise<void>;
  
  // Partitioning (optional)
  createPartition?(topic: string, partitionId: string, options?: any): Promise<void>;
  deletePartition?(topic: string, partitionId: string): Promise<void>;
  
  // Consumer groups (optional)
  createConsumerGroup?(topic: string, groupId: string, options?: any): Promise<void>;
  deleteConsumerGroup?(topic: string, groupId: string): Promise<void>;
  
  // Topic management (optional)
  createTopic?(name: string, options?: TopicOptions): Promise<void>;
  deleteTopic?(name: string): Promise<void>;
  getTopicInfo?(name: string): Promise<TopicInfo>;
  
  // Dead letter queues (optional)
  createDeadLetterQueue?(topic: string, options?: DeadLetterQueueOptions): Promise<void>;
  moveToDeadLetter?(topic: string, message: EventEnvelope, reason: string): Promise<void>;
}

// Topic management interfaces
export interface TopicOptions {
  partitions?: number;
  retention?: RetentionConfig;
  ordering?: 'strict' | 'per-partition' | 'none';
  compression?: boolean;
  encryption?: boolean;
}

export interface RetentionConfig {
  maxAge?: number; // milliseconds
  maxSize?: number; // bytes
  maxMessages?: number;
  cleanupPolicy?: 'delete' | 'compact' | 'log';
}

export interface TopicInfo {
  name: string;
  partitions: number;
  retention: RetentionConfig;
  ordering: 'strict' | 'per-partition' | 'none';
  compression: boolean;
  encryption: boolean;
  messageCount: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeadLetterQueueOptions {
  maxRetries?: number;
  retryDelay?: number;
  maxAge?: number;
  maxSize?: number;
}

// Transport status and metrics
export interface TransportStatus {
  connected: boolean;
  healthy: boolean;
  lastError?: string;
  lastErrorTime?: string;
  uptime: number;
  version: string;
}

export interface TransportMetrics {
  messagesPublished: number;
  messagesReceived: number;
  publishLatency: number;
  receiveLatency: number;
  errorRate: number;
  throughput: number;
  memoryUsage: number;
  cpuUsage: number;
}

// Transport factory interface
export interface TransportFactory {
  createTransport(config: any): Transport;
  getSupportedTypes(): string[];
  validateConfig(config: any): boolean;
}


