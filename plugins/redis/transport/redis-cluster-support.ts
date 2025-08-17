import { Redis, Cluster } from 'ioredis';

export interface RedisClusterConfig {
  sentinels?: Array<{ host: string; port: number }>;
  sentinelName?: string;
  clusterNodes?: Array<{ host: string; port: number }>;
  failoverStrategy: 'retry' | 'failfast' | 'round-robin';
  maxRetries: number;
  retryDelay: number;
  connectionTimeout: number;
  commandTimeout: number;
  failoverRecovery?: {
    enabled: boolean;
    resumeUnackedMessages: true | false | 'only-if-stale';
    staleMessageThreshold: number; // milliseconds
    recoveryTimeout: number; // milliseconds
  };
}

export interface FailoverEvent {
  type: 'failover_start' | 'failover_complete' | 'recovery_start' | 'recovery_complete';
  timestamp: Date;
  details?: any;
}

export class RedisClusterManager {
  private redis: Redis | Cluster;
  private config: RedisClusterConfig;
  private failoverEvents: FailoverEvent[] = [];
  private isRecovering: boolean = false;
  private recoveryTimeout?: NodeJS.Timeout;

  constructor(config: RedisClusterConfig) {
    this.config = config;
    this.redis = this.createRedisConnection();
  }

  /**
   * Create Redis connection based on configuration
   */
  private createRedisConnection(): Redis | Cluster {
    if (this.config.sentinels && this.config.sentinels.length > 0) {
      // Sentinel mode
      return new Redis({
        sentinels: this.config.sentinels,
        name: this.config.sentinelName || 'mymaster',
        connectTimeout: this.config.connectionTimeout,
        commandTimeout: this.config.commandTimeout,
        lazyConnect: true
      });
    } else if (this.config.clusterNodes && this.config.clusterNodes.length > 0) {
      // Cluster mode
      return new Cluster(this.config.clusterNodes, {
        lazyConnect: true
      });
    } else {
      // Single node mode
      return new Redis({
        connectTimeout: this.config.connectionTimeout,
        commandTimeout: this.config.commandTimeout,
        lazyConnect: true
      });
    }
  }

  /**
   * Initialize failover event listeners
   */
  initializeFailoverHandling(): void {
    this.redis.on('failover', async () => {
      this.emitFailoverEvent('failover_start', { timestamp: new Date() });
      
      if (this.config.failoverRecovery?.enabled) {
        await this.handleFailoverRecovery();
      }
    });

    this.redis.on('ready', () => {
      this.emitFailoverEvent('failover_complete', { timestamp: new Date() });
    });

    this.redis.on('error', (error) => {
      console.error('Redis connection error:', error);
    });
  }

  /**
   * Handle failover recovery
   */
  private async handleFailoverRecovery(): Promise<void> {
    if (this.isRecovering) return;
    
    this.isRecovering = true;
    this.emitFailoverEvent('recovery_start', { timestamp: new Date() });

    try {
      const recovery = this.config.failoverRecovery!;
      
      // Set recovery timeout
      this.recoveryTimeout = setTimeout(() => {
        console.warn('Failover recovery timeout exceeded');
        this.isRecovering = false;
      }, recovery.recoveryTimeout);

      // Check for unacknowledged messages in all known topics
      const topics = await this.getKnownTopics();
      
      for (const topic of topics) {
        const streams = this.getStreamsForTopic(topic);
        
        for (const stream of streams) {
          const groups = await this.getConsumerGroups(stream);
          
          for (const group of groups) {
            await this.recoverUnackedMessages(stream, group, recovery);
          }
        }
      }

      clearTimeout(this.recoveryTimeout);
      this.emitFailoverEvent('recovery_complete', { timestamp: new Date() });
      
    } catch (error) {
      console.error('Error during failover recovery:', error);
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * Recover unacknowledged messages for a stream
   */
  private async recoverUnackedMessages(
    stream: string, 
    group: string, 
    recovery: NonNullable<RedisClusterConfig['failoverRecovery']>
  ): Promise<void> {
    try {
      const pending = await this.redis.xpending(stream, group);
      const pendingCount = pending[0];
      
      if (pendingCount === 0) return;
      
      console.log(`[FailoverRecovery] Found ${pendingCount} unacknowledged messages in ${stream}:${group}`);
      
      if (recovery.resumeUnackedMessages === 'only-if-stale') {
        const staleMessages = await this.getStaleMessages(stream, group, recovery.staleMessageThreshold);
        if (staleMessages.length > 0) {
          console.log(`[FailoverRecovery] Reprocessing ${staleMessages.length} stale messages`);
          await this.reprocessMessages(stream, group, staleMessages);
        }
      } else if (recovery.resumeUnackedMessages === true) {
        console.log(`[FailoverRecovery] Reprocessing all ${pendingCount} unacknowledged messages`);
        await this.reprocessAllMessages(stream, group);
      }
    } catch (error) {
      console.error(`Error recovering unacknowledged messages for ${stream}:${group}:`, error);
    }
  }

  /**
   * Get stale messages (older than threshold)
   */
  private async getStaleMessages(stream: string, group: string, threshold: number): Promise<string[]> {
    try {
      const pending = await this.redis.xpending(stream, group, '-', '+', 1000);
      const staleMessages: string[] = [];
      
      for (const message of pending) {
        const messageId = (message as any[])[0];
        const idleTime = (message as any[])[2];
        
        if (idleTime > threshold) {
          staleMessages.push(messageId);
        }
      }
      
      return staleMessages;
    } catch (error) {
      console.error(`Error getting stale messages for ${stream}:${group}:`, error);
      return [];
    }
  }

  /**
   * Reprocess specific messages
   */
  private async reprocessMessages(stream: string, group: string, messageIds: string[]): Promise<void> {
    try {
      for (const messageId of messageIds) {
        // Claim the message for reprocessing
        await this.redis.xclaim(stream, group, 'recovery-consumer', 0, messageId);
      }
    } catch (error) {
      console.error(`Error reprocessing messages for ${stream}:${group}:`, error);
    }
  }

  /**
   * Reprocess all unacknowledged messages
   */
  private async reprocessAllMessages(stream: string, group: string): Promise<void> {
    try {
      const pending = await this.redis.xpending(stream, group, '-', '+', 1000);
      const messageIds = pending.map((msg: any) => msg[0]);
      
      if (messageIds.length > 0) {
        await this.reprocessMessages(stream, group, messageIds);
      }
    } catch (error) {
      console.error(`Error reprocessing all messages for ${stream}:${group}:`, error);
    }
  }

  /**
   * Get known topics (this would typically come from TopicManager)
   */
  private async getKnownTopics(): Promise<string[]> {
    try {
      const keys = await this.redis.keys('topic:*:partition:0');
      return keys.map(key => key.replace('topic:', '').replace(':partition:0', ''));
    } catch (error) {
      console.error('Error getting known topics:', error);
      return [];
    }
  }

  /**
   * Get streams for a topic
   */
  private getStreamsForTopic(topic: string): string[] {
    // This would typically come from the TopicManager
    // For now, we'll assume single partition
    return [`topic:${topic}:partition:0`];
  }

  /**
   * Get consumer groups for a stream
   */
  private async getConsumerGroups(stream: string): Promise<string[]> {
    try {
      const groups = await this.redis.xinfo('GROUPS', stream);
      return (groups as any[]).map((group: any) => group[1]);
    } catch (error) {
      console.error(`Error getting consumer groups for ${stream}:`, error);
      return [];
    }
  }

  /**
   * Emit failover event
   */
  private emitFailoverEvent(type: FailoverEvent['type'], details?: any): void {
    const event: FailoverEvent = {
      type,
      timestamp: new Date(),
      details
    };
    
    this.failoverEvents.push(event);
    
    // Keep only last 1000 events
    if (this.failoverEvents.length > 1000) {
      this.failoverEvents = this.failoverEvents.slice(-1000);
    }
  }

  /**
   * Get Redis client
   */
  getRedisClient(): Redis | Cluster {
    return this.redis;
  }

  /**
   * Get failover events
   */
  getFailoverEvents(): FailoverEvent[] {
    return [...this.failoverEvents];
  }

  /**
   * Clear failover events
   */
  clearFailoverEvents(): void {
    this.failoverEvents = [];
  }

  /**
   * Check if currently recovering
   */
  isRecoveringFromFailover(): boolean {
    return this.isRecovering;
  }

  /**
   * Get configuration
   */
  getConfiguration(): RedisClusterConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfiguration(updates: Partial<RedisClusterConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    await this.redis.connect();
    this.initializeFailoverHandling();
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.recoveryTimeout) {
      clearTimeout(this.recoveryTimeout);
    }
    await this.redis.disconnect();
  }
}
