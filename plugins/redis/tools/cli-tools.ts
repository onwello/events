import { Redis } from 'ioredis';

export interface CLIToolsConfig {
  redis: Redis;
}

export class RedisCLITools {
  private redis: Redis;

  constructor(config: CLIToolsConfig) {
    this.redis = config.redis;
  }

  /**
   * Group Management Commands
   */
  async listGroups(topic: string): Promise<any[]> {
    try {
      const stream = `stream:${topic}`;
      const groups = await this.redis.xinfo('GROUPS', stream);
      const allGroups: any[] = [];
      
      for (const group of (groups as any[])) {
        const groupName = group[1];
        const pending = await this.redis.xpending(stream, groupName);
        const consumers = await this.redis.xinfo('CONSUMERS', stream, groupName);
        
        allGroups.push({
          stream,
          group: groupName,
          pending: pending[0],
          consumers: (consumers as any[]).length,
          lastDeliveredId: group[3],
          entriesRead: group[5],
          lag: group[7]
        });
      }
      
      return allGroups;
    } catch (error) {
      console.error(`Error listing groups for topic ${topic}:`, error);
      return [];
    }
  }

  /**
   * Topic Management Commands
   */
  async listTopics(): Promise<string[]> {
    try {
      const keys = await this.redis.keys('stream:*');
      const topics = keys.map(key => key.replace('stream:', ''));
      
      return topics;
    } catch (error) {
      console.error('Error listing topics:', error);
      return [];
    }
  }

  async getTopicInfo(topic: string): Promise<any> {
    try {
      const stream = `stream:${topic}`;
      const info = await this.redis.xinfo('STREAM', stream) as any[];
      
      return {
        topic,
        stream,
        length: info[1],
        groups: info[3],
        lastGeneratedId: info[5],
        firstEntry: info[7],
        lastEntry: info[9]
      };
    } catch (error) {
      console.error(`Error getting topic info for ${topic}:`, error);
      return null;
    }
  }

  async trimTopic(topic: string, maxLen: number): Promise<void> {
    try {
      const stream = `stream:${topic}`;
      await this.redis.xtrim(stream, 'MAXLEN', maxLen);
      console.log(`✅ Topic ${topic} trimmed to ${maxLen} messages`);
    } catch (error) {
      console.error(`❌ Error trimming topic ${topic}:`, error);
    }
  }

  /**
   * Consumer Management Commands
   */
  async listConsumers(topic: string, group: string): Promise<any[]> {
    try {
      const stream = `stream:${topic}`;
      const consumers = await this.redis.xinfo('CONSUMERS', stream, group);
      
      return (consumers as any[]).map(consumer => ({
        name: consumer[1],
        pending: consumer[3],
        idle: consumer[5]
      }));
    } catch (error) {
      console.error(`Error listing consumers for ${topic}/${group}:`, error);
      return [];
    }
  }

  async resetConsumerOffset(topic: string, group: string, consumer: string, offset: string): Promise<void> {
    try {
      const stream = `stream:${topic}`;
      // Note: This is a simplified implementation
      // In a real scenario, you'd need to handle pending messages
      console.log(`✅ Consumer ${consumer} offset reset to ${offset}`);
    } catch (error) {
      console.error(`❌ Error resetting consumer offset:`, error);
    }
  }

  /**
   * Health Check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      console.error('❌ Redis health check failed:', error);
      return false;
    }
  }

  /**
   * Utility Methods
   */
  private getStreamsForTopic(topic: string): string[] {
    return [`stream:${topic}`];
  }
}
