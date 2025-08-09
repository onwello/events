import { Redis } from 'ioredis';
import { Observable } from 'rxjs';
import { 
  Transport, 
  MessageHandler, 
  PublishOptions, 
  SubscribeOptions, 
  TransportCapabilities,
  MessageMetadata 
} from './transport.interface';
import { TopicManager, TopicConfig } from './topic-manager';
import { TopicRouter, TopicRegistry } from './pattern-router';

export class RedisTopicTransport implements Transport {
  name = 'redis';
  private redis: Redis;
  private topicManager: TopicManager;
  private topicRegistry: TopicRegistry;
  private router: TopicRouter;
  private consumerGroups: Map<string, ConsumerGroup> = new Map();
  
  constructor(redis: Redis) {
    this.redis = redis;
    this.topicManager = new TopicManager(redis);
    this.topicRegistry = new TopicRegistry(redis);
    this.router = new TopicRouter(redis, this.topicRegistry);
  }
  
  // Transport interface implementation
  async publish(topic: string, message: any, options?: PublishOptions): Promise<void> {
    // Auto-register the topic if it doesn't exist
    await this.topicRegistry.ensureTopicExists(topic);
    
    // Create topic if it doesn't exist
    await this.ensureTopicExists(topic);
    
    const partition = this.topicManager.getPartition(topic, message, options);
    const streamName = this.topicManager.getStreamName(topic, partition);
    
    const envelope = {
      topic,
      partition,
      message,
      timestamp: Date.now(),
      headers: options?.headers || {}
    };
    
    await this.redis.xadd(streamName, '*', 'data', JSON.stringify(envelope));
  }
  
  async subscribe(topic: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void> {
    // Ensure topic exists
    await this.ensureTopicExists(topic);
    
    const streams = this.topicManager.getStreamsForTopic(topic);
    const groupId = options?.groupId || `consumer-group-${topic}`;
    const consumerId = options?.consumerId || `consumer-${Date.now()}`;
    
    // Create consumer group for each partition
    for (const stream of streams) {
      await this.createConsumerGroup(stream, groupId);
    }
    
    // Start consuming from all partitions
    const consumerGroup = new ConsumerGroup(this.redis, streams, groupId, consumerId, handler);
    this.consumerGroups.set(`${topic}:${consumerId}`, consumerGroup);
    
    await consumerGroup.start();
  }
  
  // Pattern-based subscription
  async subscribePattern(pattern: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void> {
    // Register the pattern with the router
    const consumerId = options?.consumerId || `consumer-${Date.now()}`;
    this.router.registerRoute(pattern, handler, consumerId);
    
    // Get all topics that match this pattern
    const topics = await this.getTopicsForPattern(pattern);
    
    // Subscribe to each matching topic
    for (const topic of topics) {
      await this.subscribe(topic, handler, options);
    }
  }
  
  // NestJS microservices compatibility
  emit(pattern: string, data: any): Observable<any> {
    return new Observable(observer => {
      this.publish(pattern, data)
        .then(() => {
          observer.next(data);
          observer.complete();
        })
        .catch(error => observer.error(error));
    });
  }
  
  send(pattern: string, data: any): Observable<any> {
    // Request-response pattern
    return new Observable(observer => {
      this.publish(pattern, data)
        .then(() => {
          observer.next(data);
          observer.complete();
        })
        .catch(error => observer.error(error));
    });
  }
  
  async connect(): Promise<void> {
    // Load existing topics from Redis
    await this.topicManager.loadTopicsFromRedis();
  }
  
  async close(): Promise<void> {
    // Stop all consumer groups
    for (const consumerGroup of this.consumerGroups.values()) {
      await consumerGroup.stop();
    }
    this.consumerGroups.clear();
    
    // Close Redis connection
    await this.redis.quit();
  }
  
  getCapabilities(): TransportCapabilities {
    return {
      supportsPartitioning: true,
      supportsOrdering: true,
      supportsDeadLetterQueues: true,
      supportsConsumerGroups: true,
      supportsPatternRouting: true,
      maxMessageSize: 512 * 1024 * 1024, // 512MB
      maxTopics: 10000
    };
  }
  
  // Helper methods
  private async ensureTopicExists(topic: string): Promise<void> {
    const exists = this.topicManager.topicExists(topic);
    if (!exists) {
      await this.topicManager.createTopic(topic, {
        name: topic,
        partitions: 1, // Default to 1 partition
        retention: { maxAge: 24 * 60 * 60 * 1000, maxSize: 10000 },
        ordering: 'per-partition'
      });
    }
  }
  
  private async createConsumerGroup(stream: string, groupId: string): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', stream, groupId, '$', 'MKSTREAM');
    } catch (error: any) {
      if (!error.message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }
  
  private async getTopicsForPattern(pattern: string): Promise<string[]> {
    // For now, return the pattern as a topic
    // In a real implementation, you'd query existing topics that match
    return [pattern];
  }
  
  // Topic management methods
  async createTopic(name: string, config: TopicConfig): Promise<void> {
    await this.topicManager.createTopic(name, config);
    await this.topicRegistry.registerTopic(name, {
      partitions: config.partitions,
      retention: config.retention,
      ordering: config.ordering
    });
  }
  
  async getTopicStats(topic: string): Promise<any> {
    return this.topicManager.getTopicStats(topic);
  }
  
  async listTopics(): Promise<string[]> {
    return this.topicManager.listTopics();
  }
}

// Consumer group for managing multiple streams
class ConsumerGroup {
  private redis: Redis;
  private streams: string[];
  private groupId: string;
  private consumerId: string;
  private handler: MessageHandler;
  private running: boolean = false;
  
  constructor(
    redis: Redis, 
    streams: string[], 
    groupId: string, 
    consumerId: string, 
    handler: MessageHandler
  ) {
    this.redis = redis;
    this.streams = streams;
    this.groupId = groupId;
    this.consumerId = consumerId;
    this.handler = handler;
  }
  
  async start(): Promise<void> {
    this.running = true;
    
    // Start polling from all streams
    const promises = this.streams.map(stream => this.pollStream(stream));
    await Promise.all(promises);
  }
  
  private async pollStream(stream: string): Promise<void> {
    while (this.running) {
      try {
        const messages = await this.redis.xreadgroup(
          'GROUP', this.groupId, this.consumerId,
          'COUNT', 10,
          'BLOCK', 1000,
          'STREAMS', stream, '>'
        );
        
        if (messages && messages.length > 0) {
          for (const [streamName, streamMessages] of messages as any[]) {
            for (const [id, fields] of streamMessages as any[]) {
              try {
                const envelope = JSON.parse(fields.data);
                const metadata: MessageMetadata = {
                  topic: envelope.topic,
                  partition: envelope.partition,
                  offset: id,
                  timestamp: envelope.timestamp,
                  headers: envelope.headers
                };
                
                await this.handler(envelope.message, metadata);
                await this.redis.xack(streamName, this.groupId, id);
              } catch (error) {
                // Handle poison messages
                await this.handlePoisonMessage(streamName, id, fields, error as any);
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error polling stream ${stream}:`, error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  private async handlePoisonMessage(stream: string, id: string, fields: any, error: Error): Promise<void> {
    // Move to dead letter queue
    const dlqStream = `${stream}:dlq`;
    await this.redis.xadd(dlqStream, '*', 'data', JSON.stringify({
      originalStream: stream,
      originalId: id,
      originalData: fields.data,
      error: error.message,
      timestamp: Date.now()
    }));
    
    // Acknowledge the original message
    await this.redis.xack(stream, this.groupId, id);
  }
  
  async stop(): Promise<void> {
    this.running = false;
  }
}
