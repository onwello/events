import { Redis } from 'ioredis';

export interface ConsumerGroupInfo {
  name: string;
  consumers: number;
  pending: number;
  lastDeliveredId: string;
  entriesRead: number;
  lag: number;
}

export interface ConsumerGroupConfig {
  autoCreateGroup?: boolean;
  groupNamingStrategy?: 'service-name' | 'custom' | 'explicit';
  customGroupName?: string;
  groupValidation?: boolean;
  resumeUnackedMessages?: true | false | 'only-if-stale';
  staleMessageThreshold?: number; // milliseconds
  poisonQueue?: {
    enabled: boolean;
    maxRetries: number;
    deadLetterTopic: string;
    retryDelayMs: number;
  };
}

export interface GroupManagementCLI {
  cleanupUnusedGroups(topic: string, maxAgeHours: number): Promise<void>;
  listGroups(topic: string): Promise<ConsumerGroupInfo[]>;
  resetGroup(topic: string, group: string, offset: string): Promise<void>;
  reprocessPEL(topic: string, group: string): Promise<void>;
}

export class ConsumerGroupManager {
  private redis: Redis;
  private config: ConsumerGroupConfig;
  private groupCache: Map<string, boolean> = new Map();

  constructor(redis: Redis, config: ConsumerGroupConfig) {
    this.redis = redis;
    this.config = config;
  }

  /**
   * Create consumer group for a topic
   */
  async createConsumerGroup(topic: string, groupName: string, startId: string = '0'): Promise<void> {
    try {
      // Get all streams for the topic
      const streams = this.getStreamsForTopic(topic);
      
      for (const stream of streams) {
        try {
          await this.redis.xgroup('CREATE', stream, groupName, startId, 'MKSTREAM');
          console.log(`Created consumer group '${groupName}' for stream '${stream}'`);
        } catch (error: any) {
          if (error.message.includes('BUSYGROUP')) {
            console.log(`Consumer group '${groupName}' already exists for stream '${stream}'`);
          } else {
            throw error;
          }
        }
      }
      
      this.groupCache.set(`${topic}:${groupName}`, true);
    } catch (error) {
      console.error(`Error creating consumer group '${groupName}' for topic '${topic}':`, error);
      throw error;
    }
  }

  /**
   * Get or create consumer group name
   */
  getConsumerGroupName(topic: string, serviceName?: string): string {
    switch (this.config.groupNamingStrategy) {
      case 'service-name':
        return serviceName ? `${serviceName}-${topic}-group` : `${topic}-group`;
      
      case 'custom':
        return this.config.customGroupName || `${topic}-group`;
      
      case 'explicit':
        return this.config.customGroupName || `${topic}-group`;
      
      default:
        return `${topic}-group`;
    }
  }

  /**
   * Ensure consumer group exists
   */
  async ensureConsumerGroup(topic: string, groupName: string): Promise<void> {
    if (!this.config.autoCreateGroup) return;

    const cacheKey = `${topic}:${groupName}`;
    if (this.groupCache.has(cacheKey)) return;

    try {
      await this.createConsumerGroup(topic, groupName);
    } catch (error) {
      console.error(`Failed to create consumer group '${groupName}' for topic '${topic}':`, error);
      throw error;
    }
  }

  /**
   * Validate consumer group exists
   */
  async validateConsumerGroup(topic: string, groupName: string): Promise<boolean> {
    if (!this.config.groupValidation) return true;

    try {
      const streams = this.getStreamsForTopic(topic);
      for (const stream of streams) {
        const groups = await this.redis.xinfo('GROUPS', stream) as any[];
        const groupExists = groups.some((group: any) => group[1] === groupName);
        if (!groupExists) {
          return false;
        }
      }
      return true;
    } catch (error) {
      console.error(`Error validating consumer group '${groupName}' for topic '${topic}':`, error);
      return false;
    }
  }

  /**
   * Handle unacknowledged messages after failover
   */
  async handleFailoverRecovery(topic: string, groupName: string): Promise<void> {
    if (!this.config.resumeUnackedMessages) return;

    try {
      const streams = this.getStreamsForTopic(topic);
      
      for (const stream of streams) {
        await this.recoverUnackedMessages(stream, groupName);
      }
    } catch (error) {
      console.error(`Error during failover recovery for topic '${topic}' group '${groupName}':`, error);
    }
  }

  /**
   * Recover unacknowledged messages for a stream
   */
  private async recoverUnackedMessages(stream: string, groupName: string): Promise<void> {
    try {
      const pending = await this.redis.xpending(stream, groupName);
      const pendingCount = pending[0];
      
      if (pendingCount === 0) return;
      
      console.log(`[FailoverRecovery] Found ${pendingCount} unacknowledged messages in ${stream}:${groupName}`);
      
      if (this.config.resumeUnackedMessages === 'only-if-stale') {
        const staleMessages = await this.getStaleMessages(stream, groupName);
        if (staleMessages.length > 0) {
          console.log(`[FailoverRecovery] Reprocessing ${staleMessages.length} stale messages`);
          await this.reprocessMessages(stream, groupName, staleMessages);
        }
      } else if (this.config.resumeUnackedMessages === true) {
        console.log(`[FailoverRecovery] Reprocessing all ${pendingCount} unacknowledged messages`);
        await this.reprocessAllMessages(stream, groupName);
      }
    } catch (error) {
      console.error(`Error recovering unacknowledged messages for ${stream}:${groupName}:`, error);
    }
  }

  /**
   * Get stale messages (older than threshold)
   */
  private async getStaleMessages(stream: string, groupName: string): Promise<string[]> {
    const threshold = this.config.staleMessageThreshold || 300000; // 5 minutes default
    const now = Date.now();
    
    try {
      const pending = await this.redis.xpending(stream, groupName, '-', '+', 1000);
      const staleMessages: string[] = [];
      
      for (const message of pending as any[]) {
        const messageId = message[0];
        const consumer = message[1];
        const idleTime = message[2];
        
        if (idleTime > threshold) {
          staleMessages.push(messageId);
        }
      }
      
      return staleMessages;
    } catch (error) {
      console.error(`Error getting stale messages for ${stream}:${groupName}:`, error);
      return [];
    }
  }

  /**
   * Reprocess specific messages
   */
  private async reprocessMessages(stream: string, groupName: string, messageIds: string[]): Promise<void> {
    try {
      for (const messageId of messageIds) {
        // Claim the message for reprocessing
        await this.redis.xclaim(stream, groupName, 'recovery-consumer', 0, messageId);
      }
    } catch (error) {
      console.error(`Error reprocessing messages for ${stream}:${groupName}:`, error);
    }
  }

  /**
   * Reprocess all unacknowledged messages
   */
  private async reprocessAllMessages(stream: string, groupName: string): Promise<void> {
    try {
      const pending = await this.redis.xpending(stream, groupName, '-', '+', 1000);
      const messageIds = pending.map((msg: any) => msg[0]);
      
      if (messageIds.length > 0) {
        await this.reprocessMessages(stream, groupName, messageIds);
      }
    } catch (error) {
      console.error(`Error reprocessing all messages for ${stream}:${groupName}:`, error);
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
   * Get consumer group information
   */
  async getConsumerGroupInfo(topic: string, groupName: string): Promise<ConsumerGroupInfo[]> {
    try {
      const streams = this.getStreamsForTopic(topic);
      const groupInfos: ConsumerGroupInfo[] = [];
      
      for (const stream of streams) {
        try {
                const groups = await this.redis.xinfo('GROUPS', stream) as any[];
      const groupInfo = groups.find((group: any) => group[1] === groupName);
          
          if (groupInfo) {
            const pending = await this.redis.xpending(stream, groupName);
            const consumers = await this.redis.xinfo('CONSUMERS', stream, groupName);
            
            groupInfos.push({
              name: groupName,
              consumers: (consumers as any[]).length,
              pending: (pending as any[])[0],
              lastDeliveredId: groupInfo[3],
              entriesRead: parseInt(groupInfo[5]),
              lag: parseInt(groupInfo[7])
            });
          }
        } catch (error) {
          console.error(`Error getting group info for ${stream}:${groupName}:`, error);
        }
      }
      
      return groupInfos;
    } catch (error) {
      console.error(`Error getting consumer group info for topic '${topic}' group '${groupName}':`, error);
      return [];
    }
  }

  /**
   * Reset consumer group offset
   */
  async resetGroupOffset(topic: string, groupName: string, offset: string): Promise<void> {
    try {
      const streams = this.getStreamsForTopic(topic);
      
      for (const stream of streams) {
        await this.redis.xgroup('SETID', stream, groupName, offset);
        console.log(`Reset group '${groupName}' offset to '${offset}' for stream '${stream}'`);
      }
    } catch (error) {
      console.error(`Error resetting group offset for topic '${topic}' group '${groupName}':`, error);
      throw error;
    }
  }

  /**
   * Clean up unused consumer groups
   */
  async cleanupUnusedGroups(topic: string, maxAgeHours: number): Promise<void> {
    try {
      const streams = this.getStreamsForTopic(topic);
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
      
      for (const stream of streams) {
        const groups = await this.redis.xinfo('GROUPS', stream);
        
        for (const group of groups as any[]) {
          const groupName = group[1];
          const lastDeliveredId = group[3];
          
          // Check if group has been inactive for too long
          if (lastDeliveredId === '0-0') {
            // Group has never consumed messages, check creation time
            const createdAt = parseInt(group[9] || '0');
            if (Date.now() - createdAt > maxAgeMs) {
              await this.redis.xgroup('DESTROY', stream, groupName);
              console.log(`Cleaned up unused group '${groupName}' from stream '${stream}'`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error cleaning up unused groups for topic '${topic}':`, error);
    }
  }

  /**
   * Get configuration
   */
  getConfiguration(): ConsumerGroupConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfiguration(updates: Partial<ConsumerGroupConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
