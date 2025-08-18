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
  BatchOptions
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
}

interface StreamSubscription {
  streamName: string;
  groupId: string;
  consumerId: string;
  handler: MessageHandler;
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
}

export class EnhancedRedisStreamsTransport implements Transport {
  readonly name = 'redis-streams';
  readonly capabilities: TransportCapabilities;
  
  private redis: Redis;
  private connectionPool: Redis[] = [];
  private poolSemaphore: { available: number; waiting: Array<() => void> } = { available: 0, waiting: [] };
  private connected = false;
  private config: RedisStreamsConfig;
  private subscriptions: Map<string, StreamSubscription> = new Map();
  private ensuredStreams: Set<string> = new Set(); // Track which streams have been ensured
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
  private startTime: number;

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
      maxBatchSize: Math.max(this.config.pipelineSize || 1000, 1000),
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
  
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    
    for (const subscription of this.subscriptions.values()) {
      subscription.running = false;
    }
    // Don't disconnect the Redis instance, just mark as disconnected
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
    
    // Use the envelope passed from EventPublisher, don't create a new one
    const envelope = message;
    
    const streamName = `${this.config.streamPrefix}${topic}`;
    
    // Acquire connection from pool
    const connection = await this.acquireConnection();
    
    try {
      await this.ensureStreamAndGroup(streamName);
      
      // Add sequence information to message if ordering is enabled
      const messageFields = ['data', JSON.stringify(envelope), 'timestamp', Date.now().toString(), 'topic', topic];
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
  
  async subscribe(topic: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }
    
    const streamName = `${this.config.streamPrefix}${topic}`;
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
      options,
      running: true,
      lastProcessedId: '0',
      retryCount: new Map(),
      metrics: {
        messagesProcessed: 0,
        messagesFailed: 0,
        lastProcessedAt: new Date(),
        averageProcessingTime: 0
      }
    };
    
    this.subscriptions.set(streamName, subscription);
    this.startConsumer(subscription);
  }
  
  async unsubscribe(topic: string): Promise<void> {
    const streamName = `${this.config.streamPrefix}${topic}`;
    const subscription = this.subscriptions.get(streamName);
    
    if (subscription) {
      subscription.running = false;
      this.subscriptions.delete(streamName);
    }
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
    
    // Log enterprise feature health for monitoring
    console.log('Enterprise features health:', enterpriseHealth);
    
    return {
      connected,
      healthy: connected && this.redis.status === 'ready' && Object.values(enterpriseHealth).every(h => h === 'healthy' || h === 'disabled'),
      uptime,
      version: '2.0.0'
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
      const pipeline = this.redis.pipeline();
      
      for (const message of messages) {
        const envelope = createEventEnvelope(topic, 'redis-streams', message);
        pipeline.xadd(
          streamName,
          '*',
          'data', JSON.stringify(envelope),
          'timestamp', Date.now().toString(),
          'topic', topic
        );
      }
      
      try {
        await pipeline.exec();
        if (this.config.enableMetrics) {
        this.metrics.messagesPublished += messages.length;
      }
      } catch (error) {
        throw new Error(`Failed to publish batch to Redis stream: ${error}`);
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
  
  private async startConsumer(subscription: StreamSubscription): Promise<void> {
    const consume = async () => {
      while (subscription.running) {
        try {
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
      
      await subscription.handler(envelope, metadata);
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
}
