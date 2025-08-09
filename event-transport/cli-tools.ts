import { Redis } from 'ioredis';
import { ConsumerGroupManager } from './consumer-group-manager';
import { TopicTrimManager } from './topic-trim-manager';
import { PoisonMessageMonitor } from './poison-message-handler';
import { EnhancedBackpressureMonitor } from './backpressure-monitor';

export interface CLIToolsConfig {
  redis: Redis;
  groupManager: ConsumerGroupManager;
  trimManager: TopicTrimManager;
  poisonMonitor: PoisonMessageMonitor;
  backpressureMonitor: EnhancedBackpressureMonitor;
}

export class EventCLITools {
  private redis: Redis;
  private groupManager: ConsumerGroupManager;
  private trimManager: TopicTrimManager;
  private poisonMonitor: PoisonMessageMonitor;
  private backpressureMonitor: EnhancedBackpressureMonitor;

  constructor(config: CLIToolsConfig) {
    this.redis = config.redis;
    this.groupManager = config.groupManager;
    this.trimManager = config.trimManager;
    this.poisonMonitor = config.poisonMonitor;
    this.backpressureMonitor = config.backpressureMonitor;
  }

  /**
   * Group Management Commands
   */
  async listGroups(topic: string): Promise<any[]> {
    console.log(`\n📋 Consumer Groups for topic: ${topic}`);
    console.log('='.repeat(50));
    
    try {
      const streams = this.getStreamsForTopic(topic);
      const allGroups: any[] = [];
      
      for (const stream of streams) {
        const groups = await this.redis.xinfo('GROUPS', stream);
        for (const group of groups) {
          const groupName = group[1];
          const pending = await this.redis.xpending(stream, groupName);
          const consumers = await this.redis.xinfo('CONSUMERS', stream, groupName);
          
          allGroups.push({
            stream,
            group: groupName,
            pending: pending[0],
            consumers: consumers.length,
            lastDeliveredId: group[3],
            entriesRead: group[5],
            lag: group[7]
          });
        }
      }
      
      // Display in table format
      console.log('Stream\t\tGroup\t\tPending\tConsumers\tLag\tLast Delivered');
      console.log('-'.repeat(80));
      
      for (const group of allGroups) {
        console.log(`${group.stream}\t${group.group}\t${group.pending}\t${group.consumers}\t\t${group.lag}\t${group.lastDeliveredId}`);
      }
      
      return allGroups;
    } catch (error) {
      console.error(`Error listing groups for topic ${topic}:`, error);
      return [];
    }
  }

  async cleanupUnusedGroups(topic: string, maxAgeHours: number): Promise<void> {
    console.log(`\n🧹 Cleaning up unused groups for topic: ${topic} (max age: ${maxAgeHours}h)`);
    console.log('='.repeat(60));
    
    try {
      await this.groupManager.cleanupUnusedGroups(topic, maxAgeHours);
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }

  async resetGroup(topic: string, group: string, offset: string): Promise<void> {
    console.log(`\n🔄 Resetting group ${group} for topic ${topic} to offset ${offset}`);
    console.log('='.repeat(60));
    
    try {
      await this.groupManager.resetGroupOffset(topic, group, offset);
      console.log('✅ Group reset completed');
    } catch (error) {
      console.error('❌ Error resetting group:', error);
    }
  }

  async reprocessPEL(topic: string, group: string): Promise<void> {
    console.log(`\n🔄 Reprocessing PEL for topic ${topic}, group ${group}`);
    console.log('='.repeat(60));
    
    try {
      await this.groupManager.handleFailoverRecovery(topic, group);
      console.log('✅ PEL reprocessing completed');
    } catch (error) {
      console.error('❌ Error reprocessing PEL:', error);
    }
  }

  /**
   * Topic Management Commands
   */
  async listTopics(): Promise<string[]> {
    console.log('\n📋 Available Topics');
    console.log('='.repeat(30));
    
    try {
      const keys = await this.redis.keys('topic:*:partition:0');
      const topics = keys.map(key => key.replace('topic:', '').replace(':partition:0', ''));
      
      for (const topic of topics) {
        console.log(`- ${topic}`);
      }
      
      return topics;
    } catch (error) {
      console.error('Error listing topics:', error);
      return [];
    }
  }

  async getTopicStats(topic: string): Promise<void> {
    console.log(`\n📊 Statistics for topic: ${topic}`);
    console.log('='.repeat(40));
    
    try {
      const stats = await this.trimManager.getTopicLengthStats(topic);
      const memoryStats = await this.trimManager.getMemoryStats(topic);
      
      console.log(`Current Length: ${stats.currentLength}`);
      console.log(`Max Length: ${stats.maxLength}`);
      console.log(`Threshold: ${stats.threshold}`);
      console.log(`Needs Trimming: ${stats.needsTrimming ? 'Yes' : 'No'}`);
      console.log(`Estimated Memory: ${(memoryStats.estimatedMemoryUsage / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Memory Usage: ${memoryStats.memoryUsagePercentage.toFixed(2)}%`);
    } catch (error) {
      console.error(`Error getting stats for topic ${topic}:`, error);
    }
  }

  async trimTopic(topic: string, maxLength: number, policy: 'maxlen' | 'minid' = 'maxlen'): Promise<void> {
    console.log(`\n✂️  Trimming topic ${topic} to maxLength ${maxLength} (policy: ${policy})`);
    console.log('='.repeat(60));
    
    try {
      await this.trimManager.manualTrim(topic, maxLength, policy);
      console.log('✅ Topic trimming completed');
    } catch (error) {
      console.error('❌ Error trimming topic:', error);
    }
  }

  /**
   * Poison Message Commands
   */
  async listPoisonMessages(topic?: string): Promise<void> {
    console.log('\n☠️  Poison Messages');
    console.log('='.repeat(30));
    
    try {
      const allMessages = this.poisonMonitor.getAllPoisonMessages();
      const messages = topic ? 
        allMessages.filter(msg => msg.topic === topic) : 
        allMessages;
      
      if (messages.length === 0) {
        console.log('No poison messages found');
        return;
      }
      
      console.log('ID\t\tTopic\t\tEvent Type\tRetry Count\tError');
      console.log('-'.repeat(100));
      
      for (const msg of messages) {
        console.log(`${msg.id}\t${msg.topic}\t${msg.eventType}\t${msg.retryCount}\t\t${msg.error.substring(0, 50)}...`);
      }
    } catch (error) {
      console.error('Error listing poison messages:', error);
    }
  }

  async getPoisonStats(): Promise<void> {
    console.log('\n📊 Poison Message Statistics');
    console.log('='.repeat(40));
    
    try {
      const stats = this.poisonMonitor.getPoisonMessageStats();
      
      console.log(`Total Poison Messages: ${stats.totalPoisonMessages}`);
      console.log(`Average Retry Count: ${stats.averageRetryCount.toFixed(2)}`);
      console.log(`Oldest Poison Message: ${stats.oldestPoisonMessage?.toISOString() || 'N/A'}`);
      
      console.log('\nBy Event Type:');
      for (const [eventType, count] of Object.entries(stats.messagesByEventType)) {
        console.log(`  ${eventType}: ${count}`);
      }
      
      console.log('\nBy Topic:');
      for (const [topic, count] of Object.entries(stats.messagesByTopic)) {
        console.log(`  ${topic}: ${count}`);
      }
      
      console.log('\nRetry Distribution:');
      for (const [retryCount, count] of Object.entries(stats.retryDistribution)) {
        console.log(`  ${retryCount} retries: ${count} messages`);
      }
    } catch (error) {
      console.error('Error getting poison stats:', error);
    }
  }

  async clearPoisonMessages(): Promise<void> {
    console.log('\n🧹 Clearing all poison messages');
    console.log('='.repeat(40));
    
    try {
      this.poisonMonitor.clearPoisonMessages();
      console.log('✅ Poison messages cleared');
    } catch (error) {
      console.error('❌ Error clearing poison messages:', error);
    }
  }

  /**
   * Backpressure Monitoring Commands
   */
  async getBackpressureMetrics(topic?: string, group?: string): Promise<void> {
    console.log('\n📊 Backpressure Metrics');
    console.log('='.repeat(30));
    
    try {
      const allMetrics = this.backpressureMonitor.getAllMetrics();
      const metrics = topic && group ? 
        [this.backpressureMonitor.getMetrics(topic, group)].filter(Boolean) :
        allMetrics;
      
      if (metrics.length === 0) {
        console.log('No metrics available');
        return;
      }
      
      console.log('Topic\t\tGroup\t\tPending\tLag\tConsumers\tBackpressured\tSlow Consumer');
      console.log('-'.repeat(100));
      
      for (const metric of metrics) {
        console.log(`${metric.topic}\t${metric.group}\t${metric.pendingCount}\t${metric.lag}ms\t${metric.consumerCount}\t\t${metric.isBackpressured ? 'Yes' : 'No'}\t\t${metric.isSlowConsumer ? 'Yes' : 'No'}`);
      }
    } catch (error) {
      console.error('Error getting backpressure metrics:', error);
    }
  }

  async getBackpressureAlerts(): Promise<void> {
    console.log('\n🚨 Backpressure Alerts');
    console.log('='.repeat(30));
    
    try {
      const alerts = this.backpressureMonitor.getAllAlerts();
      
      if (alerts.length === 0) {
        console.log('No alerts');
        return;
      }
      
      for (const alert of alerts) {
        console.log(`[${alert.timestamp.toISOString()}] ${alert.type.toUpperCase()}: ${alert.message}`);
        console.log(`  Topic: ${alert.topic}, Group: ${alert.group}`);
      }
    } catch (error) {
      console.error('Error getting backpressure alerts:', error);
    }
  }

  async getSummaryStats(): Promise<void> {
    console.log('\n📈 Summary Statistics');
    console.log('='.repeat(30));
    
    try {
      const stats = this.backpressureMonitor.getSummaryStats();
      
      console.log(`Total Topics: ${stats.totalTopics}`);
      console.log(`Total Groups: ${stats.totalGroups}`);
      console.log(`Backpressured Topics: ${stats.backpressuredTopics}`);
      console.log(`Slow Consumers: ${stats.slowConsumers}`);
      console.log(`Total Alerts: ${stats.totalAlerts}`);
    } catch (error) {
      console.error('Error getting summary stats:', error);
    }
  }

  /**
   * Utility Commands
   */
  async healthCheck(): Promise<void> {
    console.log('\n🏥 Health Check');
    console.log('='.repeat(20));
    
    try {
      // Check Redis connection
      await this.redis.ping();
      console.log('✅ Redis connection: OK');
      
      // Check topic count
      const topics = await this.listTopics();
      console.log(`✅ Topics: ${topics.length} found`);
      
      // Check poison messages
      const poisonStats = this.poisonMonitor.getPoisonMessageStats();
      console.log(`✅ Poison messages: ${poisonStats.totalPoisonMessages} total`);
      
      // Check backpressure
      const backpressureStats = this.backpressureMonitor.getSummaryStats();
      console.log(`✅ Backpressure: ${backpressureStats.backpressuredTopics} topics affected`);
      
      console.log('\n🎉 All systems operational!');
    } catch (error) {
      console.error('❌ Health check failed:', error);
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
}
