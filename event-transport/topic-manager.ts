import { Redis } from 'ioredis';
import { createHash } from 'crypto';

export interface TopicConfig {
  name: string;
  partitions: number; // Number of Redis streams for this topic
  retention: {
    maxAge: number; // milliseconds
    maxSize: number; // messages
  };
  ordering: 'strict' | 'per-partition' | 'none';
  replication?: number; // For future Redis cluster support
}

export interface TopicMetadata {
  partitions?: number;
  retention?: RetentionConfig;
  ordering?: 'strict' | 'per-partition' | 'none';
  createdAt?: number;
}

export interface RetentionConfig {
  maxAge: number; // milliseconds
  maxSize: number; // messages
}

export class TopicManager {
  private topics: Map<string, TopicConfig> = new Map();
  private redis: Redis;
  
  constructor(redis: Redis) {
    this.redis = redis;
  }
  
  // Create a topic (maps to multiple streams)
  async createTopic(name: string, config: TopicConfig): Promise<void> {
    this.topics.set(name, config);
    
    // Store topic metadata in Redis for persistence
    await this.redis.hset('topic:metadata', name, JSON.stringify({
      ...config,
      createdAt: Date.now()
    }));
  }
  
  // Get topic configuration
  getTopicConfig(topic: string): TopicConfig | undefined {
    return this.topics.get(topic);
  }
  
  // Check if topic exists
  topicExists(topic: string): boolean {
    return this.topics.has(topic);
  }
  
  // Get stream name for topic + partition
  getStreamName(topic: string, partition: number): string {
    return `topic:${topic}:partition:${partition}`;
  }
  
  // Get all streams for a topic
  getStreamsForTopic(topic: string): string[] {
    const config = this.topics.get(topic);
    if (!config) throw new Error(`Topic ${topic} not found`);
    
    const streams: string[] = [];
    for (let partition = 0; partition < config.partitions; partition++) {
      streams.push(this.getStreamName(topic, partition));
    }
    return streams;
  }
  
  // Get partition for a message
  getPartition(topic: string, message: any, options?: { partitionKey?: string; partition?: number }): number {
    const config = this.topics.get(topic);
    if (!config) throw new Error(`Topic ${topic} not found`);
    
    if (options?.partitionKey) {
      // Hash-based partitioning for consistent ordering
      return this.hashPartition(options.partitionKey, config.partitions);
    }
    
    if (options?.partition !== undefined) {
      // Explicit partition assignment
      return options.partition % config.partitions;
    }
    
    // Round-robin partitioning
    return Math.floor(Math.random() * config.partitions);
  }
  
  // Hash-based partitioning for consistent ordering
  private hashPartition(key: string, partitions: number): number {
    const hash = createHash('md5').update(key).digest('hex');
    const hashNum = parseInt(hash.substring(0, 8), 16);
    return hashNum % partitions;
  }
  
  // List all topics
  async listTopics(): Promise<string[]> {
    return Array.from(this.topics.keys());
  }
  
  // Delete a topic
  async deleteTopic(name: string): Promise<void> {
    const config = this.topics.get(name);
    if (!config) throw new Error(`Topic ${name} not found`);
    
    // Delete all streams for this topic
    const streams = this.getStreamsForTopic(name);
    for (const stream of streams) {
      await this.redis.del(stream);
    }
    
    // Remove from topics map
    this.topics.delete(name);
    
    // Remove from Redis metadata
    await this.redis.hdel('topic:metadata', name);
  }
  
  // Load topics from Redis on startup
  async loadTopicsFromRedis(): Promise<void> {
    const topicMetadata = await this.redis.hgetall('topic:metadata');
    
    for (const [name, metadataStr] of Object.entries(topicMetadata)) {
      try {
        const metadata = JSON.parse(metadataStr);
        this.topics.set(name, metadata as TopicConfig);
      } catch (error) {
        console.error(`Failed to load topic metadata for ${name}:`, error);
      }
    }
  }
  
  // Get topic statistics
  async getTopicStats(topic: string): Promise<TopicStats> {
    const config = this.topics.get(topic);
    if (!config) throw new Error(`Topic ${topic} not found`);
    
    const streams = this.getStreamsForTopic(topic);
    const stats: TopicStats = {
      topic,
      partitions: streams.length,
      totalMessages: 0,
      totalSize: 0,
      oldestMessage: null,
      newestMessage: null
    };
    
    for (const stream of streams) {
      try {
        const streamInfo = await this.redis.xinfo('STREAM', stream) as any[];
        stats.totalMessages += streamInfo[1] as number; // length
        
        if ((streamInfo[1] as number) > 0) {
          const firstMessage = await this.redis.xrange(stream, '-', '+', 'COUNT', 1);
          const lastMessage = await this.redis.xrevrange(stream, '+', '-', 'COUNT', 1);
          
          if (firstMessage.length > 0) {
            const firstId = firstMessage[0][0];
            const firstTime = this.parseMessageId(firstId);
            if (!stats.oldestMessage || firstTime < stats.oldestMessage) {
              stats.oldestMessage = firstTime;
            }
          }
          
          if (lastMessage.length > 0) {
            const lastId = lastMessage[0][0];
            const lastTime = this.parseMessageId(lastId);
            if (!stats.newestMessage || lastTime > stats.newestMessage) {
              stats.newestMessage = lastTime;
            }
          }
        }
      } catch (error) {
        // Stream might not exist yet
        console.debug(`Stream ${stream} not found for topic ${topic}`);
      }
    }
    
    return stats;
  }
  
  private parseMessageId(id: string): number {
    return parseInt(id.split('-')[0], 10);
  }
}

export interface TopicStats {
  topic: string;
  partitions: number;
  totalMessages: number;
  totalSize: number;
  oldestMessage: number | null;
  newestMessage: number | null;
}
