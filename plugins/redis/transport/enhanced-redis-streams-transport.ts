import { Redis } from 'ioredis';
import { 
  Transport, 
  MessageHandler, 
  PublishOptions, 
  SubscribeOptions, 
  TransportCapabilities,
  MessageMetadata,
  EventEnvelope,
  TransportStatus,
  TransportMetrics,
  BatchOptions,
  AdvancedTransport
} from '../../../event-transport/transport.interface';
import { createEventEnvelope } from '../../../event-types';
import { MessageOrderingManager, OrderingConfig } from './message-ordering';
import { PartitioningManager, PartitioningConfig } from './partitioning-manager';
import { SchemaManager, SchemaConfig } from './schema-manager';
import { MessageReplayManager, ReplayConfig } from './message-replay';

export interface RedisStreamsConfig {
  // Connection settings
  host?: string;
  port?: number;
  url?: string;
  db?: number;
  password?: string;
  
  // Connection pooling for concurrent publishing
  connectionPool?: {
    enabled: boolean;
    size: number; // Number of Redis connections in the pool
    maxConcurrentPublishers: number; // Max concurrent publishing operations
  };
  
  // Consumer group settings
  groupId?: string;
  consumerId?: string;
  
  // Stream settings
  streamPrefix?: string;
  maxLen?: number;
  trimStrategy?: 'MAXLEN' | 'MINID';
  
  // Consumer settings
  batchSize?: number;
  blockTime?: number;
  pollInterval?: number;
  maxRetries?: number;
  retryDelay?: number;
  
  // Dead letter queue settings
  enableDLQ?: boolean;
  dlqStreamPrefix?: string;
  maxRetriesBeforeDLQ?: number;
  
  // Performance settings
  enablePipelining?: boolean;
  pipelineSize?: number;
  skipStreamGroupCheck?: boolean;  // Skip ensureStreamAndGroup calls for performance
  enableMetrics?: boolean;  // Enable/disable metrics collection for performance


  // Enterprise features
  ordering?: OrderingConfig;
  partitioning?: PartitioningConfig;
  schema?: SchemaConfig;
  replay?: ReplayConfig;
  
  // Stale consumer detection and cleanup
  staleConsumerDetection?: {
    enabled: boolean;
    heartbeatInterval: number;        // How often to send heartbeats (ms)
    staleThreshold: number;          // How long before consumer is considered stale (ms)
    cleanupInterval: number;         // How often to run cleanup (ms)
    maxStaleConsumers: number;       // Max stale consumers before forced cleanup
    enableHeartbeat: boolean;        // Enable heartbeat mechanism
    enablePingPong: boolean;         // Enable ping-pong health check
    cleanupStrategy: 'aggressive' | 'conservative' | 'manual';
    preserveConsumerHistory: boolean; // Keep consumer history for debugging
  };
}

interface StreamSubscription {
  streamName: string;
  groupId: string;
  consumerId: string;
  handler: MessageHandler;
  eventType?: string;        // Event type for exact subscriptions
  isPattern?: boolean;       // Whether this is a pattern subscription
  pattern?: string;          // Pattern for pattern subscriptions
  options?: SubscribeOptions;
  running: boolean;
  lastProcessedId: string;
  retryCount: Map<string, number>;
  metrics: {
    messagesProcessed: number;
    messagesFailed: number;
    lastProcessedAt: Date;
    averageProcessingTime: number;
  };
  // Stale consumer detection fields
  lastHeartbeat: Date;
  lastPingResponse: Date;
  healthStatus: 'healthy' | 'degraded' | 'stale' | 'dead';
  consecutiveFailures: number;
  lastHealthCheck: Date;
}

interface ConsumerHealthInfo {
  consumerId: string;
  groupId: string;
  streamName: string;
  lastSeen: Date;
  lastHeartbeat: Date;
  lastPingResponse: Date;
  healthStatus: 'healthy' | 'degraded' | 'stale' | 'dead';
  consecutiveFailures: number;
  messagesProcessed: number;
  messagesFailed: number;
  lastProcessedAt: Date;
  isActive: boolean;
  pendingMessages: number;
}

interface StaleConsumerMetrics {
  totalConsumers: number;
  healthyConsumers: number;
  staleConsumers: number;
  deadConsumers: number;
  cleanupOperations: number;
  lastCleanupAt: Date;
  averageCleanupTime: number;
  totalCleanupTime: number;
}

/**
 * Detects stale consumers using multiple strategies
 */
class StaleConsumerDetector {
  constructor(
    private redis: Redis,
    private config: RedisStreamsConfig['staleConsumerDetection']
  ) {}

  /**
   * Detect stale consumers using Redis XINFO GROUPS command
   */
  async detectStaleConsumers(streamName: string, groupId: string): Promise<ConsumerHealthInfo[]> {
    try {
      const groupInfo = await this.redis.xinfo('GROUPS', streamName);
      const consumers: ConsumerHealthInfo[] = [];
      
      // Handle case where groupInfo is not an array or is empty
      if (!Array.isArray(groupInfo) || groupInfo.length === 0) {
        return consumers;
      }
      
      for (const group of groupInfo) {
        // Ensure group has the expected structure
        if (!Array.isArray(group) || group.length < 6) {
          continue;
        }
        
        if (group[1] === groupId) {
          const consumerList = group[5]; // Consumers array
          
          // Ensure consumerList is an array
          if (!Array.isArray(consumerList)) {
            continue;
          }
          
          for (const consumer of consumerList) {
            // Ensure consumer has the expected structure
            if (!Array.isArray(consumer) || consumer.length < 6) {
              continue;
            }
            
            const consumerId = consumer[1];
            const pendingMessages = consumer[3] || 0;
            const idleTime = consumer[5] || 0;
            
            const lastSeen = new Date(Date.now() - (idleTime * 1000));
            const isStale = idleTime > (this.config?.staleThreshold || 30000) / 1000;
            
            consumers.push({
              consumerId,
              groupId,
              streamName,
              lastSeen,
              lastHeartbeat: new Date(), // Will be updated by health monitor
              lastPingResponse: new Date(), // Will be updated by health monitor
              healthStatus: isStale ? 'stale' : 'healthy',
              consecutiveFailures: 0,
              messagesProcessed: 0,
              messagesFailed: 0,
              lastProcessedAt: new Date(),
              isActive: !isStale,
              pendingMessages
            });
          }
        }
      }
      
      return consumers;
    } catch (error) {
      console.warn(`Failed to detect stale consumers for stream ${streamName}:`, error);
      return [];
    }
  }

  /**
   * Check if a consumer is stale based on heartbeat
   */
  isConsumerStale(lastHeartbeat: Date, staleThreshold: number): boolean {
    const now = new Date();
    const timeSinceHeartbeat = now.getTime() - lastHeartbeat.getTime();
    return timeSinceHeartbeat > staleThreshold;
  }
}

/**
 * Monitors consumer health using heartbeat and ping-pong mechanisms
 */
class ConsumerHealthMonitor {
  constructor(
    private redis: Redis,
    private config: RedisStreamsConfig['staleConsumerDetection']
  ) {}

  /**
   * Send heartbeat for a consumer
   */
  async sendHeartbeat(streamName: string, groupId: string, consumerId: string): Promise<void> {
    try {
      const heartbeatKey = `heartbeat:${streamName}:${groupId}:${consumerId}`;
      await this.redis.set(heartbeatKey, Date.now().toString(), 'PX', this.config?.staleThreshold || 30000);
    } catch (error) {
      console.warn(`Failed to send heartbeat for consumer ${consumerId}:`, error);
    }
  }

  /**
   * Check heartbeat for a consumer
   */
  async checkHeartbeat(streamName: string, groupId: string, consumerId: string): Promise<boolean> {
    try {
      const heartbeatKey = `heartbeat:${streamName}:${groupId}:${consumerId}`;
      const heartbeat = await this.redis.get(heartbeatKey);
      return heartbeat !== null;
    } catch (error) {
      console.warn(`Failed to check heartbeat for consumer ${consumerId}:`, error);
      return false;
    }
  }

  /**
   * Send ping to consumer and wait for pong response
   */
  async sendPing(streamName: string, groupId: string, consumerId: string): Promise<boolean> {
    try {
      const pingKey = `ping:${streamName}:${groupId}:${consumerId}`;
      const pongKey = `pong:${streamName}:${groupId}:${consumerId}`;
      
      // Send ping
      await this.redis.set(pingKey, Date.now().toString(), 'PX', 5000);
      
      // Wait for pong response (with timeout)
      const startTime = Date.now();
      const timeout = 3000; // 3 second timeout
      
      while (Date.now() - startTime < timeout) {
        const pong = await this.redis.get(pongKey);
        if (pong) {
          await this.redis.del(pongKey);
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      return false;
    } catch (error) {
      console.warn(`Failed to send ping for consumer ${consumerId}:`, error);
      return false;
    }
  }
}

/**
 * Manages cleanup of stale consumers
 */
class ConsumerCleanupManager {
  constructor(
    private redis: Redis,
    private config: RedisStreamsConfig['staleConsumerDetection']
  ) {}

  /**
   * Clean up stale consumers from a consumer group
   */
  async cleanupStaleConsumers(streamName: string, groupId: string, staleConsumers: ConsumerHealthInfo[]): Promise<number> {
    let cleanedCount = 0;
    
    for (const consumer of staleConsumers) {
      try {
        if (this.config?.cleanupStrategy === 'conservative' && consumer.pendingMessages > 0) {
          console.log(`Skipping cleanup of consumer ${consumer.consumerId} due to pending messages`);
          continue;
        }
        
        // Remove consumer from group
        await this.redis.xgroup('DELCONSUMER', streamName, groupId, consumer.consumerId);
        
        // Clean up heartbeat and ping keys
        const heartbeatKey = `heartbeat:${streamName}:${groupId}:${consumer.consumerId}`;
        const pingKey = `ping:${streamName}:${groupId}:${consumer.consumerId}`;
        const pongKey = `pong:${streamName}:${groupId}:${consumer.consumerId}`;
        
        await this.redis.del(heartbeatKey, pingKey, pongKey);
        
        cleanedCount++;
        console.log(`Cleaned up stale consumer ${consumer.consumerId} from group ${groupId}`);
      } catch (error) {
        console.warn(`Failed to cleanup consumer ${consumer.consumerId}:`, error);
      }
    }
    
    return cleanedCount;
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats(streamName: string, groupId: string): Promise<{ total: number; stale: number; pending: number }> {
    try {
      const groupInfo = await this.redis.xinfo('GROUPS', streamName);
      
      for (const group of groupInfo as any[]) {
        if (group[1] === groupId) {
          const consumers = group[5];
          const pendingMessages = group[3];
          
          let staleCount = 0;
          for (const consumer of consumers) {
            const idleTime = consumer[5];
            if (idleTime > (this.config?.staleThreshold || 30000) / 1000) {
              staleCount++;
            }
          }
          
          return {
            total: consumers.length,
            stale: staleCount,
            pending: pendingMessages
          };
        }
      }
      
      return { total: 0, stale: 0, pending: 0 };
    } catch (error) {
      console.warn(`Failed to get cleanup stats for stream ${streamName}:`, error);
      return { total: 0, stale: 0, pending: 0 };
    }
  }
}

export class EnhancedRedisStreamsTransport implements AdvancedTransport {
  readonly name = 'redis-streams';
  readonly capabilities: TransportCapabilities;
  
  private redis: Redis;
  private connectionPool: Redis[] = [];
  private poolSemaphore: { available: number; waiting: Array<() => void> } = { available: 0, waiting: [] };
  private connected = false;
  private config: RedisStreamsConfig;
  private subscriptions: Map<string, StreamSubscription> = new Map();
  private ensuredStreams: Set<string> = new Set(); // Track which streams have been ensured
  private startTime: number;
  
  // Stale consumer detection and cleanup
  private staleConsumerDetector?: StaleConsumerDetector;
  private consumerHealthMonitor?: ConsumerHealthMonitor;
  private consumerCleanupManager?: ConsumerCleanupManager;
  private staleConsumerMetrics?: StaleConsumerMetrics;
  private heartbeatInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private metrics: {
    messagesPublished: number;
    messagesReceived: number;
    publishLatency: number[];
    receiveLatency: number[];
    errorRate: number;
    throughput: number;
    memoryUsage: number;
    cpuUsage: number;
    lastUpdated: Date;
  };

  // Enterprise feature managers
  private orderingManager?: MessageOrderingManager;
  private partitioningManager?: PartitioningManager;
  private schemaManager?: SchemaManager;
  private replayManager?: MessageReplayManager;
  
  constructor(redis: Redis, config: RedisStreamsConfig = {}) {
    this.redis = redis;
    this.config = {
      groupId: 'default-group',
      consumerId: `consumer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
      skipStreamGroupCheck: false,
      enableMetrics: true,
      staleConsumerDetection: {
        enabled: false,
        heartbeatInterval: 30000,        // 30 seconds
        staleThreshold: 60000,           // 1 minute
        cleanupInterval: 120000,         // 2 minutes
        maxStaleConsumers: 100,
        enableHeartbeat: true,
        enablePingPong: true,
        cleanupStrategy: 'conservative',
        preserveConsumerHistory: true
      },
      connectionPool: {
        enabled: false,
        size: 5,
        maxConcurrentPublishers: 10
      },
      ...config
    };
    
    // Initialize connection pool if enabled
    if (this.config.connectionPool?.enabled) {
      this.initializeConnectionPool();
    }
    
    this.startTime = Date.now();
    this.metrics = {
      messagesPublished: 0,
      messagesReceived: 0,
      publishLatency: [],
      receiveLatency: [],
      errorRate: 0,
      throughput: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      lastUpdated: new Date()
    };
    
    // Initialize enterprise feature managers
    this.initializeEnterpriseFeatures();
    
    // Initialize stale consumer detection and cleanup
    this.initializeStaleConsumerDetection();
    
    // Set capabilities based on configuration
    this.capabilities = this.buildCapabilities();
  }

  /**
   * Initialize enterprise feature managers
   */
  private initializeEnterpriseFeatures(): void {
    // Initialize message ordering manager
    if (this.config.ordering?.enabled) {
      this.orderingManager = new MessageOrderingManager(this.redis, this.config.ordering);
    }

    // Initialize partitioning manager
    if (this.config.partitioning?.enabled) {
      this.partitioningManager = new PartitioningManager(this.redis, this.config.partitioning);
    }

    // Initialize schema manager
    if (this.config.schema?.enabled) {
      this.schemaManager = new SchemaManager(this.redis, this.config.schema);
      // Load existing schemas from Redis
      this.schemaManager.loadSchemasFromRedis().catch(console.error);
    }

    // Initialize replay manager
    if (this.config.replay?.enabled) {
      this.replayManager = new MessageReplayManager(this.redis, this.config.replay);
    }
  }

  /**
   * Initialize stale consumer detection and cleanup
   */
  private initializeStaleConsumerDetection(): void {
    if (this.config.staleConsumerDetection?.enabled) {
      this.staleConsumerDetector = new StaleConsumerDetector(this.redis, this.config.staleConsumerDetection);
      this.consumerHealthMonitor = new ConsumerHealthMonitor(this.redis, this.config.staleConsumerDetection);
      this.consumerCleanupManager = new ConsumerCleanupManager(this.redis, this.config.staleConsumerDetection);
      this.staleConsumerMetrics = {
        totalConsumers: 0,
        healthyConsumers: 0,
        staleConsumers: 0,
        deadConsumers: 0,
        cleanupOperations: 0,
        lastCleanupAt: new Date(),
        averageCleanupTime: 0,
        totalCleanupTime: 0
      };

      // Start heartbeat and cleanup intervals
      this.startHeartbeatInterval();
      this.startCleanupInterval();
    }
  }

  /**
   * Initialize connection pool for concurrent publishing
   */
  private initializeConnectionPool(): void {
    const poolSize = this.config.connectionPool?.size || 5;
    const maxConcurrent = this.config.connectionPool?.maxConcurrentPublishers || 10;
    
    // Create additional Redis connections for the pool
    for (let i = 0; i < poolSize; i++) {
      let connection: Redis;
      if (this.config.url) {
        connection = new Redis(this.config.url);
      } else {
        connection = new Redis({
          host: this.config.host || 'localhost',
          port: this.config.port || 6379,
          db: this.config.db || 0,
          password: this.config.password,
          lazyConnect: true
        });
      }
      this.connectionPool.push(connection);
    }
    
    // Initialize semaphore
    this.poolSemaphore.available = maxConcurrent;
  }

  /**
   * Acquire a connection from the pool
   */
  private async acquireConnection(): Promise<Redis> {
    if (!this.config.connectionPool?.enabled) {
      return this.redis; // Use main connection if pooling is disabled
    }

    // Wait for available slot
    while (this.poolSemaphore.available <= 0) {
      const waitPromise = new Promise<void>(resolve => {
        this.poolSemaphore.waiting.push(resolve);
      });
      await waitPromise;
    }

    this.poolSemaphore.available--;
    
    // Return a random connection from the pool
    const randomIndex = Math.floor(Math.random() * this.connectionPool.length);
    return this.connectionPool[randomIndex];
  }

  /**
   * Release a connection back to the pool
   */
  private releaseConnection(): void {
    if (!this.config.connectionPool?.enabled) {
      return;
    }

    this.poolSemaphore.available++;
    
    // Resolve waiting promises if any
    if (this.poolSemaphore.waiting.length > 0) {
      const resolve = this.poolSemaphore.waiting.shift();
      if (resolve) resolve();
    }
  }

  /**
   * Build transport capabilities based on configuration
   */
  private buildCapabilities(): TransportCapabilities {
    const baseCapabilities = {
      supportsPublishing: true,
      supportsSubscription: true,
      supportsBatching: true,
      supportsPartitioning: false,
      supportsOrdering: false,
      supportsPatternRouting: true,
      supportsConsumerGroups: true,
      supportsDeadLetterQueues: true,
      supportsMessageRetention: true,
      supportsMessageCompression: false,
      maxMessageSize: 512 * 1024 * 1024,
      maxBatchSize: Math.max(this.config.pipelineSize || 5000, 5000),
      maxTopics: 10000,
      maxPartitions: 1,
      maxConsumerGroups: 1000,
      supportsPersistence: true,
      supportsReplication: true,
      supportsFailover: true,
      supportsTransactions: false,
      supportsMetrics: true,
      supportsTracing: false,
      supportsHealthChecks: true
    };

    // Update capabilities based on enterprise features
    if (this.orderingManager) {
      baseCapabilities.supportsOrdering = true;
      const orderingGuarantees = this.orderingManager.getOrderingGuarantees();
      if (orderingGuarantees.globalOrdering) {
        baseCapabilities.maxPartitions = 1000; // Support multiple partitions for global ordering
      }
    }

    if (this.partitioningManager) {
      baseCapabilities.supportsPartitioning = true;
      const partitioningStrategy = this.partitioningManager.getPartitioningStrategy();
      if (partitioningStrategy.dynamicPartitioning) {
        baseCapabilities.maxPartitions = 10000; // Support dynamic partitioning
      }
    }

    if (this.schemaManager) {
      // Schema management enhances message validation
      baseCapabilities.supportsMessageRetention = true;
    }

    if (this.replayManager) {
      // Message replay enhances reliability
      baseCapabilities.supportsMessageRetention = true;
    }

    return baseCapabilities;
  }
  
  async connect(): Promise<void> {
    if (this.connected) return;
    
    try {
      await this.redis.ping();
      
      // Connect all pool connections if enabled
      if (this.config.connectionPool?.enabled) {
        for (const connection of this.connectionPool) {
          await connection.ping();
        }
      }
      
      this.connected = true;
    } catch (error) {
      throw new Error(`Failed to connect to Redis: ${error}`);
    }
  }
  
  /**
   * Get stale consumer metrics
   */
  async getStaleConsumerMetrics(): Promise<StaleConsumerMetrics | undefined> {
    return this.staleConsumerMetrics;
  }

  /**
   * Manually trigger stale consumer cleanup
   */
  async triggerStaleConsumerCleanup(): Promise<void> {
    if (this.config.staleConsumerDetection?.enabled) {
      await this.performStaleConsumerCleanup();
    }
  }

  /**
   * Get consumer health information for a specific stream
   */
  async getConsumerHealth(streamName: string, groupId: string): Promise<ConsumerHealthInfo[]> {
    if (!this.config.staleConsumerDetection?.enabled || !this.staleConsumerDetector) {
      return [];
    }
    return await this.staleConsumerDetector.detectStaleConsumers(streamName, groupId);
  }

  /**
   * Manually remove a specific consumer from a group
   */
  async removeConsumer(streamName: string, groupId: string, consumerId: string): Promise<boolean> {
    if (!this.config.staleConsumerDetection?.enabled || !this.consumerCleanupManager) {
      return false;
    }
    
    try {
      const consumers = await this.staleConsumerDetector?.detectStaleConsumers(streamName, groupId);
      if (consumers) {
        const targetConsumer = consumers.find(c => c.consumerId === consumerId);
        if (targetConsumer) {
          const cleanedCount = await this.consumerCleanupManager.cleanupStaleConsumers(streamName, groupId, [targetConsumer]);
          return cleanedCount > 0;
        }
      }
      return false;
    } catch (error) {
      console.warn(`Failed to remove consumer ${consumerId}:`, error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    // Stop all consumer loops
    for (const subscription of this.subscriptions.values()) {
      subscription.running = false;
    }
    
    // Clear intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    
    // Close Redis connection if quit method exists
    if (this.redis && typeof this.redis.quit === 'function') {
      try {
        await this.redis.quit();
      } catch (error) {
        console.warn('Failed to quit Redis connection:', error);
      }
    }
    
    this.connected = false;
  }
  
  async close(): Promise<void> {
    // Clean up enterprise feature managers
    if (this.orderingManager) {
      await this.orderingManager.cleanup();
    }
    if (this.partitioningManager) {
      await this.partitioningManager.cleanup();
    }
    if (this.schemaManager) {
      await this.schemaManager.cleanup();
    }
    if (this.replayManager) {
      await this.replayManager.cleanup();
    }
    
    // Clean up all subscriptions
    for (const [streamName, subscription] of this.subscriptions.entries()) {
      subscription.running = false;
    }
    this.subscriptions.clear();
    
    // Close all connection pool connections
    if (this.config.connectionPool?.enabled) {
      for (const connection of this.connectionPool) {
        await connection.disconnect();
      }
      this.connectionPool = [];
    }
    
    await this.disconnect();
  }
  
  isConnected(): boolean {
    return this.connected;
  }
  
  async publish(topic: string, message: any, options?: PublishOptions): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }
    
    const startTime = Date.now();
    
    // Validate message against schema if enabled
    if (this.schemaManager) {
      const validation = await this.schemaManager.validateMessage(topic, message);
      if (!validation.valid && this.config.schema?.validationMode === 'strict') {
        throw new Error(`Schema validation failed: ${validation.errors.join(', ')}`);
      }
    }
    
    // Get partition if partitioning is enabled
    let partition = 0;
    if (this.partitioningManager) {
      partition = await this.partitioningManager.getPartition(message, options?.partitionKey);
    }
    
    // Generate sequence number if ordering is enabled
    let sequence: any = null;
    if (this.orderingManager) {
      sequence = await this.orderingManager.generateSequenceNumber(topic, options?.partitionKey);
    }
    
    
    const streamName = `${this.config.streamPrefix}${topic}`;
    
    // Acquire connection from pool
    const connection = await this.acquireConnection();
    
    try {
      await this.ensureStreamAndGroup(streamName);
      
      // Add sequence information to message if ordering is enabled
      const messageFields = ['data', JSON.stringify(message), 'timestamp', Date.now().toString(), 'topic', topic];
      if (sequence) {
        messageFields.push('sequence', JSON.stringify(sequence));
      }
      if (partition > 0) {
        messageFields.push('partition', partition.toString());
      }
      
      const messageId = await connection.xadd(streamName, '*', ...messageFields);
      
      if (this.config.maxLen) {
        if (this.config.trimStrategy === 'MAXLEN') {
          await connection.xtrim(streamName, 'MAXLEN', this.config.maxLen);
        } else if (this.config.trimStrategy === 'MINID') {
          await connection.xtrim(streamName, 'MINID', this.config.maxLen);
        }
      }
      
      // Update partition metrics if partitioning is enabled
      if (this.partitioningManager) {
        await this.partitioningManager.updatePartitionMetrics(partition, 1, 0);
      }
      
      const totalTime = Date.now() - startTime;      
      
      if (this.config.enableMetrics) {
        this.metrics.messagesPublished++;
        this.metrics.publishLatency.push(totalTime);
        if (this.metrics.publishLatency.length > 100) {
          this.metrics.publishLatency.shift();
        }
      }
      
    } catch (error) {
      throw new Error(`Failed to publish to Redis stream: ${error}`);
    } finally {
      // Release connection back to pool
      this.releaseConnection();
    }
  }
  
  async subscribe(topic: string, handler: MessageHandler, options?: SubscribeOptions, eventType?: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }
    
    // Auto-detect if this is a pattern subscription
    const isPattern = this.isPattern(topic);
    const actualEventType = isPattern ? undefined : eventType;
    const pattern = isPattern ? topic : undefined;
    
    // For pattern subscriptions, determine stream name based on pattern
    let streamName: string;
    if (isPattern) {
      // Convert pattern to stream name (e.g., 'user.*' -> 'user-events')
      streamName = `${this.config.streamPrefix}${this.patternToStreamName(topic)}`;
    } else {
      // Use topic as-is for exact subscriptions
      streamName = `${this.config.streamPrefix}${topic}`;
    }
    
    const groupId = options?.groupId || this.config.groupId!;
    const consumerId = options?.consumerId || this.config.consumerId!;
    
    // Ensure stream and consumer group exist before subscribing
    await this.ensureStreamAndGroup(streamName, groupId);
    
    // Wait a bit for the group to be fully created
    await this.sleep(100);
    
    const subscription: StreamSubscription = {
      streamName,
      groupId,
      consumerId,
      handler,
      eventType: actualEventType,    // For exact subscriptions
      isPattern,                      // Auto-detected
      pattern,                        // For pattern subscriptions
      options,
      running: true,
      lastProcessedId: '0',
      retryCount: new Map(),
      metrics: {
        messagesProcessed: 0,
        messagesFailed: 0,
        lastProcessedAt: new Date(),
        averageProcessingTime: 0
      },
      // Initialize stale consumer detection fields
      lastHeartbeat: new Date(),
      lastPingResponse: new Date(),
      healthStatus: 'healthy',
      consecutiveFailures: 0,
      lastHealthCheck: new Date()
    };
    
    this.subscriptions.set(streamName, subscription);
    this.startConsumer(subscription);
  }
  
  /**
   * Detect if a topic string contains pattern wildcards
   */
  private isPattern(topic: string): boolean {
    return topic.includes('*');
  }
  
  /**
   * Convert a pattern to a stream name for Redis
   * This groups related patterns into logical streams
   */
  private patternToStreamName(pattern: string): string {
    // Extract the base namespace from the pattern
    // e.g., 'user.*' -> 'user-events', '*.created' -> 'events', 'eu.de.user.*' -> 'eu-de-user-events'
    const segments = pattern.split('.');
    
    if (segments.length === 1) {
      // Single segment like 'user' -> 'user-events'
      return `${segments[0]}-events`;
    } else if (segments[0] === '*') {
      // Pattern starts with wildcard like '*.created' -> 'events'
      return 'events';
    } else {
      // Multi-segment pattern like 'eu.de.user.*' -> 'eu-de-user-events'
      const baseSegments = segments.filter(segment => segment !== '*');
      return `${baseSegments.join('-')}-events`;
    }
  }
  
  async unsubscribe(topic: string): Promise<void> {
    // Check if this is a pattern subscription
    const isPattern = this.isPattern(topic);
    
    if (isPattern) {
      // For pattern subscriptions, find by pattern
      for (const [streamName, subscription] of this.subscriptions.entries()) {
        if (subscription.isPattern && subscription.pattern === topic) {
          subscription.running = false;
          this.subscriptions.delete(streamName);
          return;
        }
      }
    } else {
      // For exact subscriptions, find by stream name
      const streamName = `${this.config.streamPrefix}${topic}`;
      const subscription = this.subscriptions.get(streamName);
      if (subscription) {
        subscription.running = false;
        this.subscriptions.delete(streamName);
      }
    }
  }
  
  async unsubscribePattern(pattern: string): Promise<void> {
    // This is now just an alias for unsubscribe since patterns are auto-detected
    await this.unsubscribe(pattern);
  }
  
  async getStatus(): Promise<TransportStatus> {
    const connected = this.connected;
    const uptime = Date.now() - this.startTime;
    
    // Check enterprise feature health
    const enterpriseHealth = {
      ordering: this.orderingManager ? 'healthy' : 'disabled',
      partitioning: this.partitioningManager ? 'healthy' : 'disabled',
      schema: this.schemaManager ? 'healthy' : 'disabled',
      replay: this.replayManager ? 'healthy' : 'disabled'
    };
    
    // Check stale consumer detection health
    const staleConsumerHealth = this.config.staleConsumerDetection?.enabled ? {
      enabled: true,
      heartbeat: this.heartbeatInterval ? 'active' : 'inactive',
      cleanup: this.cleanupInterval ? 'active' : 'inactive',
      metrics: this.staleConsumerMetrics || {
        totalConsumers: 0,
        healthyConsumers: 0,
        staleConsumers: 0,
        deadConsumers: 0,
        cleanupOperations: 0,
        lastCleanupAt: new Date(),
        averageCleanupTime: 0,
        totalCleanupTime: 0
      }
    } : { enabled: false };
    
    return {
      connected,
      healthy: connected && this.redis.status === 'ready' && Object.values(enterpriseHealth).every(h => h === 'healthy' || h === 'disabled'),
      uptime,
      version: '3.2.0'
    };
  }
  
  async getMetrics(): Promise<TransportMetrics> {
    // Update metrics on-demand instead of continuously
    await this.updateMetrics();
    
    const now = Date.now();
    const uptime = now - this.startTime;
    
    const avgPublishLatency = this.metrics.publishLatency.length > 0 
      ? this.metrics.publishLatency.reduce((a, b) => a + b, 0) / this.metrics.publishLatency.length 
      : 0;
    
    const avgReceiveLatency = this.metrics.receiveLatency.length > 0 
      ? this.metrics.receiveLatency.reduce((a, b) => a + b, 0) / this.metrics.receiveLatency.length 
      : 0;
    
    const throughput = uptime > 0 ? (this.metrics.messagesPublished + this.metrics.messagesReceived) / (uptime / 1000) : 0;
    const totalMessages = this.metrics.messagesPublished + this.metrics.messagesReceived;
    const errorRate = totalMessages > 0 ? this.metrics.errorRate / totalMessages : 0;
    
    return {
      messagesPublished: this.metrics.messagesPublished,
      messagesReceived: this.metrics.messagesReceived,
      publishLatency: avgPublishLatency,
      receiveLatency: avgReceiveLatency,
      errorRate,
      throughput,
      memoryUsage: this.metrics.memoryUsage,
      cpuUsage: this.metrics.cpuUsage
    };
  }
  
  // Fixed publishBatch signature to match the interface but maintain user-friendly API
  async publishBatch(topic: string, messages: any[], options?: PublishOptions & BatchOptions): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }
    
    const streamName = `${this.config.streamPrefix}${topic}`;
    await this.ensureStreamAndGroup(streamName);
    
    if (this.config.enablePipelining) {
      // Use connection pool for batch publishing to support concurrency
      const connection = await this.acquireConnection();
      
      try {
        // ULTRA-EFFICIENT BATCHING: Create multiple batch envelopes and pipeline them together
        // This combines the benefits of batching AND pipelining for maximum performance
        const batchSize = this.config.pipelineSize || 1000; // Size of each batch envelope
        const pipelineSize = 10; // Number of batch envelopes to pipeline together
        const timestamp = Date.now().toString();
        
        // Process messages in pipeline batches of batch envelopes
        for (let i = 0; i < messages.length; i += batchSize * pipelineSize) {
          const pipeline = connection.pipeline();
          let batchEnvelopesInPipeline = 0;
          
          // Create multiple batch envelopes for this pipeline
          for (let j = 0; j < pipelineSize && i + j * batchSize < messages.length; j++) {
            const startIdx = i + j * batchSize;
            const endIdx = Math.min(startIdx + batchSize, messages.length);
            const batch = messages.slice(startIdx, endIdx);
            
            if (batch.length > 0) {
              // Create batch envelope for this batch
              const batchEnvelope = {
                data: batch, // Array of messages in this batch envelope
                metadata: {
                  batch: true,
                  count: batch.length,
                  timestamp: Date.now(),
                  topic: topic
                }
              };
              
              const serializedBatch = JSON.stringify(batchEnvelope);
              
              // Add batch envelope to pipeline
              pipeline.xadd(
                streamName,
                '*',
                'data', serializedBatch,
                'timestamp', timestamp,
                'topic', topic,
                'batch', 'true',
                'count', batch.length.toString()
              );
              
              batchEnvelopesInPipeline++;
            }
          }
          
          if (batchEnvelopesInPipeline > 0) {
            // Execute the pipeline (single network round-trip for multiple batch envelopes)
            await pipeline.exec();
          }
        }
        
        if (this.config.enableMetrics) {
          this.metrics.messagesPublished += messages.length;
        }
      } catch (error) {
        throw new Error(`Failed to publish batch to Redis stream: ${error}`);
      } finally {
        this.releaseConnection();
      }
    } else {
      for (const message of messages) {
        await this.publish(topic, message, options);
      }
    }
  }
  
  // Private methods
  
  private async ensureStreamAndGroup(streamName: string, groupId?: string): Promise<void> {
    // Skip if we've already ensured this stream
    if (this.ensuredStreams.has(streamName)) {
      return;
    }
    
    const targetGroupId = groupId || this.config.groupId!;
    
    try {
      await this.redis.xgroup('CREATE', streamName, targetGroupId, '$', 'MKSTREAM');
      // Mark this stream as ensured
      this.ensuredStreams.add(streamName);
    } catch (error: any) {
      if (!error.message.includes('BUSYGROUP')) {
        throw error;
      }
      // Even if group already exists, mark stream as ensured
      this.ensuredStreams.add(streamName);
    }
  }
  
  /**
   * Respond to ping requests for health monitoring
   */
  private async respondToPing(streamName: string, groupId: string, consumerId: string): Promise<void> {
    if (!this.config.staleConsumerDetection?.enabled || !this.config.staleConsumerDetection.enablePingPong) {
      return;
    }

    try {
      const pingKey = `ping:${streamName}:${groupId}:${consumerId}`;
      const pongKey = `pong:${streamName}:${groupId}:${consumerId}`;
      
      // Check if we have a ping request
      const ping = await this.redis.get(pingKey);
      if (ping) {
        // Respond with pong
        await this.redis.set(pongKey, Date.now().toString(), 'PX', 5000);
        await this.redis.del(pingKey);
        
        // Update subscription health
        const subscription = this.subscriptions.get(streamName);
        if (subscription) {
          subscription.lastPingResponse = new Date();
          subscription.healthStatus = 'healthy';
          subscription.consecutiveFailures = 0;
        }
      }
    } catch (error) {
      console.warn(`Failed to respond to ping for consumer ${consumerId}:`, error);
    }
  }

  private async startConsumer(subscription: StreamSubscription): Promise<void> {
    const consume = async () => {
      while (subscription.running) {
        try {
          // Check for ping requests first
          await this.respondToPing(subscription.streamName, subscription.groupId, subscription.consumerId);
          
          const messages = await this.redis.xreadgroup(
            'GROUP', subscription.groupId, subscription.consumerId,
            'COUNT', this.config.batchSize!,
            'BLOCK', this.config.blockTime!,
            'STREAMS', subscription.streamName, '>'
          );
          
          if (messages && messages.length > 0) {
            for (const [streamName, streamMessages] of messages as any[]) {
              for (const [id, fields] of streamMessages as any[]) {
                if (!subscription.running) break;
                await this.processMessage(subscription, id, fields);
              }
            }
          } 
        } catch (error) {
          console.error(`Error consuming from stream ${subscription.streamName}:`, error);
          
          // Update health status
          subscription.consecutiveFailures++;
          if (subscription.consecutiveFailures > 3) {
            subscription.healthStatus = 'degraded';
          }
          if (subscription.consecutiveFailures > 10) {
            subscription.healthStatus = 'stale';
          }
          
          await this.sleep(this.config.retryDelay!);
        }
      }
    };
    
    consume().catch(error => {
      console.error(`Consumer error for stream ${subscription.streamName}:`, error);
    });
  }
  
  private async processMessage(subscription: StreamSubscription, id: string, fields: any[]): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Extract message data - fields is a flat array [key1, value1, key2, value2, ...]
      let dataValue = null;
      for (let i = 0; i < fields.length; i += 2) {
        if (fields[i] === 'data') {
          dataValue = fields[i + 1];
          break;
        }
      }
      
      if (!dataValue) {
        console.warn(`Message ${id} has no data field. Fields:`, fields);
        await this.ackMessage(subscription.streamName, subscription.groupId, id);
        return;
      }
      
      const envelope = JSON.parse(dataValue) as EventEnvelope;
      const metadata: MessageMetadata = {
        topic: subscription.streamName,
        offset: id,
        timestamp: Date.now()
      };
      
      // ✅ IMPLEMENT EVENT TYPE FILTERING
      const shouldProcessMessage = this.shouldProcessMessage(subscription, envelope);
      
      if (!shouldProcessMessage) {
        // Skip this message - it doesn't match the subscription criteria
        // Don't ack - let other handlers process it
        return;
      }
      
      // Call handler only if message matches subscription criteria
      await subscription.handler(envelope, metadata);
      
      // Only ack if we actually processed the message
      await this.ackMessage(subscription.streamName, subscription.groupId, id);
      
      const processingTime = Date.now() - startTime;
      subscription.metrics.messagesProcessed++;
      subscription.metrics.lastProcessedAt = new Date();
      subscription.metrics.averageProcessingTime = 
        (subscription.metrics.averageProcessingTime * (subscription.metrics.messagesProcessed - 1) + processingTime) / 
        subscription.metrics.messagesProcessed;
      
      if (this.config.enableMetrics) {
        this.metrics.messagesReceived++;
        this.metrics.receiveLatency.push(processingTime);
        if (this.metrics.receiveLatency.length > 100) {
          this.metrics.receiveLatency.shift();
        }
      }
      
    } catch (error) {
      console.error(`Error processing message ${id}:`, error);
      
      const retryCount = subscription.retryCount.get(id) || 0;
      
      if (retryCount < this.config.maxRetries!) {
        subscription.retryCount.set(id, retryCount + 1);
        await this.sleep(this.config.retryDelay! * Math.pow(2, retryCount));
      } else {
        if (this.config.enableDLQ) {
          await this.moveToDLQ(subscription.streamName, id, fields, error);
        }
        
        await this.ackMessage(subscription.streamName, subscription.groupId, id);
        subscription.metrics.messagesFailed++;
        if (this.config.enableMetrics) {
          this.metrics.errorRate++;
        }
      }
    }
  }
  
  private async ackMessage(streamName: string, groupId: string, id: string): Promise<void> {
    try {
      await this.redis.xack(streamName, groupId, id);
    } catch (error) {
      console.error(`Error acknowledging message ${id}:`, error);
    }
  }
  
  private async moveToDLQ(streamName: string, id: string, fields: any[], error: any): Promise<void> {
    const dlqStreamName = `${this.config.dlqStreamPrefix}${streamName}`;
    
    try {
      await this.redis.xadd(
        dlqStreamName,
        '*',
        'originalId', id,
        'originalStream', streamName,
        'error', error.message,
        'timestamp', Date.now().toString(),
        ...fields.flat()
      );
    } catch (dlqError) {
      console.error(`Error moving message ${id} to DLQ:`, dlqError);
    }
  }
  
  private async discoverMatchingStreams(pattern: string): Promise<string[]> {
    const keys = await this.redis.keys(`${this.config.streamPrefix}*`);
    return keys.filter(key => this.matchesPattern(key, pattern));
  }
  
  private matchesPattern(streamName: string, pattern: string): boolean {
    const topic = streamName.replace(this.config.streamPrefix!, '');
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\./g, '\\.'));
    return regex.test(topic);
  }
  
  /**
   * Determine if a message should be processed by this subscription
   * based on event type and pattern matching
   */
  private shouldProcessMessage(subscription: StreamSubscription, envelope: EventEnvelope): boolean {
    const messageEventType = envelope.header.type;
    
    if (!messageEventType) {
      // If message has no event type, skip it
      return false;
    }
    
    if (subscription.isPattern && subscription.pattern) {
      // Pattern subscription - check if message matches pattern
      return this.matchesEventPattern(messageEventType, subscription.pattern);
    } else if (subscription.eventType) {
      // Exact subscription - check if event types match exactly
      return messageEventType === subscription.eventType;
    }
    
    // If no filtering criteria specified, process all messages
    // This maintains backward compatibility
    return true;
  }
  
  /**
   * Check if an event type matches a pattern
   * Supports wildcard patterns like 'user.*', '*.created', 'user.*.updated'
   */
  private matchesEventPattern(eventType: string, pattern: string): boolean {
    // Convert pattern to regex
    const regexPattern = this.patternToRegex(pattern);
    const regex = new RegExp(regexPattern);
    
    return regex.test(eventType);
  }
  
  /**
   * Convert a pattern string to a regex string
   * Supports wildcards: * matches any segment, .* matches any characters within a segment
   */
  private patternToRegex(pattern: string): string {
    // Escape special regex characters except * and .
    let regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
      .replace(/\*/g, '.*');                   // Convert * to .*
    
    // Ensure the pattern matches the entire string
    return `^${regexPattern}$`;
  }
  
  
  private async updateMetrics(): Promise<void> {
    if (!this.config.enableMetrics) {
      return;
    }
    
    try {
      this.metrics.memoryUsage = process.memoryUsage().heapUsed;
      this.metrics.lastUpdated = new Date();
    } catch (error) {
      console.error('Error updating metrics:', error);
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Start heartbeat interval for stale consumer detection
   */
  private startHeartbeatInterval(): void {
    if (!this.config.staleConsumerDetection?.enabled || !this.config.staleConsumerDetection.enableHeartbeat) {
      return;
    }

    const interval = this.config.staleConsumerDetection.heartbeatInterval || 30000; // Default to 30s
    this.heartbeatInterval = setInterval(() => {
      this.checkAndSendHeartbeats();
    }, interval);
    console.log(`Stale consumer heartbeat interval started (${interval}ms)`);
  }

  /**
   * Start cleanup interval for stale consumer detection
   */
  private startCleanupInterval(): void {
    if (!this.config.staleConsumerDetection?.enabled || !this.config.staleConsumerDetection.cleanupInterval) {
      return;
    }

    const interval = this.config.staleConsumerDetection.cleanupInterval || 60000; // Default to 60s
    this.cleanupInterval = setInterval(() => {
      this.performStaleConsumerCleanup();
    }, interval);
    console.log(`Stale consumer cleanup interval started (${interval}ms)`);
  }

  /**
   * Check and send heartbeats for all active consumers
   */
  private async checkAndSendHeartbeats(): Promise<void> {
    if (!this.config.staleConsumerDetection?.enabled || !this.config.staleConsumerDetection.enableHeartbeat) {
      return;
    }

    for (const subscription of this.subscriptions.values()) {
      if (subscription.running) {
        await this.consumerHealthMonitor?.sendHeartbeat(subscription.streamName, subscription.groupId, subscription.consumerId);
      }
    }
  }

  /**
   * Perform cleanup of stale consumers
   */
  private async performStaleConsumerCleanup(): Promise<void> {
    if (!this.config.staleConsumerDetection?.enabled || !this.config.staleConsumerDetection.cleanupInterval) {
      return;
    }

    const maxStaleConsumers = this.config.staleConsumerDetection.maxStaleConsumers || 100;
    const staleThreshold = this.config.staleConsumerDetection.staleThreshold || 30000; // 30s
    const cleanupStrategy = this.config.staleConsumerDetection.cleanupStrategy || 'aggressive';

    let totalConsumers = 0;
    let healthyConsumers = 0;
    let staleConsumers = 0;
    let deadConsumers = 0;
    let cleanupOperations = 0;
    let totalCleanupTime = 0;

    // Only proceed if we have active subscriptions
    if (this.subscriptions.size === 0) {
      return;
    }

    for (const subscription of this.subscriptions.values()) {
      if (subscription.running) {
        const streamName = subscription.streamName;
        const groupId = subscription.groupId;
        const consumerId = subscription.consumerId;

        try {
          const consumers = await this.staleConsumerDetector?.detectStaleConsumers(streamName, groupId);
          if (consumers) {
            totalConsumers += consumers.length;
            consumers.forEach(consumer => {
              if (consumer.healthStatus === 'healthy') {
                healthyConsumers++;
              } else if (consumer.healthStatus === 'stale') {
                staleConsumers++;
              } else if (consumer.healthStatus === 'dead') {
                deadConsumers++;
              }
            });

            if (consumers.length > 0) {
              const startTime = Date.now();
              const cleanedCount = await this.consumerCleanupManager?.cleanupStaleConsumers(streamName, groupId, consumers);
              cleanupOperations++;
              totalCleanupTime += Date.now() - startTime;
              console.log(`Cleaned up ${cleanedCount} stale consumers from group ${groupId} on stream ${streamName}`);
            }
          }
        } catch (error) {
          console.warn(`Failed to perform stale consumer cleanup for stream ${streamName}:`, error);
        }
      }
    }

    // Only update metrics if we had operations
    if (cleanupOperations > 0) {
      this.staleConsumerMetrics = {
        totalConsumers,
        healthyConsumers,
        staleConsumers,
        deadConsumers,
        cleanupOperations,
        lastCleanupAt: new Date(),
        averageCleanupTime: totalCleanupTime / cleanupOperations,
        totalCleanupTime
      };

      console.log(`Stale consumer cleanup complete. Total Consumers: ${totalConsumers}, Healthy: ${healthyConsumers}, Stale: ${staleConsumers}, Dead: ${deadConsumers}, Operations: ${cleanupOperations}, Avg Cleanup Time: ${this.staleConsumerMetrics.averageCleanupTime}ms`);
    }
  }

  /**
   * Get enterprise feature managers
   */
  getOrderingManager(): MessageOrderingManager | undefined {
    return this.orderingManager;
  }

  getPartitioningManager(): PartitioningManager | undefined {
    return this.partitioningManager;
  }

  getSchemaManager(): SchemaManager | undefined {
    return this.schemaManager;
  }

  getReplayManager(): MessageReplayManager | undefined {
    return this.replayManager;
  }

  /**
   * Get extended status including stale consumer detection information
   */
  async getExtendedStatus(): Promise<{
    connected: boolean;
    healthy: boolean;
    uptime: number;
    version: string;
    subscriptions: number;
    enterpriseFeatures: any;
    staleConsumerDetection: any;
  }> {
    const connected = this.connected;
    const uptime = Date.now() - this.startTime;
    
    // Check enterprise feature health
    const enterpriseHealth = {
      ordering: this.orderingManager ? 'healthy' : 'disabled',
      partitioning: this.partitioningManager ? 'healthy' : 'disabled',
      schema: this.schemaManager ? 'healthy' : 'disabled',
      replay: this.replayManager ? 'healthy' : 'disabled'
    };
    
    // Check stale consumer detection health
    const staleConsumerHealth = this.config.staleConsumerDetection?.enabled ? {
      enabled: true,
      heartbeat: this.heartbeatInterval ? 'active' : 'inactive',
      cleanup: this.cleanupInterval ? 'active' : 'inactive',
      metrics: this.staleConsumerMetrics || {
        totalConsumers: 0,
        healthyConsumers: 0,
        staleConsumers: 0,
        deadConsumers: 0,
        cleanupOperations: 0,
        lastCleanupAt: new Date(),
        averageCleanupTime: 0,
        totalCleanupTime: 0
      }
    } : { enabled: false };
    
    return {
      connected,
      healthy: connected && this.redis.status === 'ready' && Object.values(enterpriseHealth).every(h => h === 'healthy' || h === 'disabled'),
      uptime,
      version: '3.2.0',
      subscriptions: this.subscriptions.size,
      enterpriseFeatures: enterpriseHealth,
      staleConsumerDetection: staleConsumerHealth
    };
  }
}
