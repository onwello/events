import { Redis } from 'ioredis';
import { TopicWarning } from './enhanced-topic-configuration';

export interface TrimStrategy {
  enabled: boolean;
  maxLength: number;
  trimPolicy: 'maxlen' | 'minid';
  trimThreshold: number; // 0.0 to 1.0, when to trigger trim
  trimBatchSize: number;
  trimInterval: number; // milliseconds
  trimOnPublish?: boolean; // Trim immediately on publish
  warnings?: {
    ineffectiveTrimThreshold?: number; // Warn when trimming doesn't reduce size significantly
    onIneffectiveTrim?: (topic: string, beforeLength: number, afterLength: number) => void;
  };
}

export interface TrimEvent {
  topic: string;
  originalLength: number;
  targetLength: number;
  trimmedAmount: number;
  effectiveness: number;
  timestamp: number;
}

export class TopicTrimManager {
  private redis: Redis;
  private trimConfig: TrimStrategy;
  private trimIntervals: Map<string, NodeJS.Timeout> = new Map();
  private topicLengths: Map<string, number> = new Map();
  private trimEvents: TrimEvent[] = [];

  constructor(redis: Redis, trimConfig: TrimStrategy) {
    this.redis = redis;
    this.trimConfig = trimConfig;
  }

  /**
   * Check and trim a topic if needed
   */
  async checkAndTrim(topicName: string): Promise<void> {
    if (!this.trimConfig.enabled) return;

    try {
      const streams = this.getStreamsForTopic(topicName);
      let totalLength = 0;

      // Calculate total length across all partitions
      for (const stream of streams) {
        const streamLength = await this.redis.xlen(stream);
        totalLength += streamLength;
      }

      this.topicLengths.set(topicName, totalLength);
      
      const threshold = this.trimConfig.maxLength * this.trimConfig.trimThreshold;
      
      if (totalLength > threshold) {
        await this.trimTopic(topicName, totalLength);
      }
    } catch (error) {
      console.error(`Error trimming topic ${topicName}:`, error);
    }
  }

  /**
   * Trim a topic
   */
  private async trimTopic(topicName: string, currentLength: number): Promise<void> {
    const targetLength = this.trimConfig.maxLength;
    const trimAmount = currentLength - targetLength;
    
    if (trimAmount <= 0) return;

    try {
      const streams = this.getStreamsForTopic(topicName);
      let totalTrimmed = 0;

      for (const stream of streams) {
        const streamLength = await this.redis.xlen(stream);
        const streamTargetLength = Math.floor(targetLength / streams.length);
        
        if (streamLength > streamTargetLength) {
          const trimmed = await this.trimStream(stream, streamTargetLength);
          totalTrimmed += trimmed;
        }
      }

      // Check if trimming was effective
      const newLength = await this.getTopicLength(topicName);
      const reduction = currentLength - newLength;
      const effectiveness = reduction / trimAmount;

      if (effectiveness < (this.trimConfig.warnings?.ineffectiveTrimThreshold || 0.5)) {
        this.trimConfig.warnings?.onIneffectiveTrim?.(topicName, currentLength, newLength);
      }

      // Emit trim event
      this.emitTrimEvent(topicName, {
        originalLength: currentLength,
        targetLength,
        trimmedAmount: trimAmount,
        effectiveness,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error(`Failed to trim topic ${topicName}:`, error);
    }
  }

  /**
   * Trim a single stream
   */
  private async trimStream(streamName: string, targetLength: number): Promise<number> {
    try {
      const trimPolicy = this.trimConfig.trimPolicy === 'minid' ? 'MINID' : 'MAXLEN';
      const trimValue = this.trimConfig.trimPolicy === 'minid' ? 
        `~ ${targetLength}` : targetLength;
      
      const result = await this.redis.xtrim(streamName, trimPolicy as any, trimValue);
      return result || 0;
    } catch (error) {
      console.error(`Failed to trim stream ${streamName}:`, error);
      return 0;
    }
  }

  /**
   * Get total length of a topic across all partitions
   */
  private async getTopicLength(topicName: string): Promise<number> {
    const streams = this.getStreamsForTopic(topicName);
    let totalLength = 0;

    for (const stream of streams) {
      const streamLength = await this.redis.xlen(stream);
      totalLength += streamLength;
    }

    return totalLength;
  }

  /**
   * Get streams for a topic
   */
  private getStreamsForTopic(topicName: string): string[] {
    // This would typically come from the TopicManager
    // For now, we'll assume single partition
    return [`topic:${topicName}:partition:0`];
  }

  /**
   * Start periodic trimming for a topic
   */
  startPeriodicTrimming(topicName: string): void {
    if (!this.trimConfig.enabled || this.trimConfig.trimInterval <= 0) return;

    // Clear existing interval if any
    this.stopPeriodicTrimming(topicName);

    const interval = setInterval(async () => {
      await this.checkAndTrim(topicName);
    }, this.trimConfig.trimInterval);

    this.trimIntervals.set(topicName, interval);
  }

  /**
   * Stop periodic trimming for a topic
   */
  stopPeriodicTrimming(topicName: string): void {
    const interval = this.trimIntervals.get(topicName);
    if (interval) {
      clearInterval(interval);
      this.trimIntervals.delete(topicName);
    }
  }

  /**
   * Stop all periodic trimming
   */
  stopAllPeriodicTrimming(): void {
    for (const [topicName] of this.trimIntervals) {
      this.stopPeriodicTrimming(topicName);
    }
  }

  /**
   * Trim on publish (immediate trimming)
   */
  async trimOnPublish(topicName: string): Promise<void> {
    if (!this.trimConfig.trimOnPublish) return;
    await this.checkAndTrim(topicName);
  }

  /**
   * Manual trim with custom parameters
   */
  async manualTrim(topicName: string, maxLength: number, policy: 'maxlen' | 'minid' = 'maxlen'): Promise<void> {
    try {
      const streams = this.getStreamsForTopic(topicName);
      
      for (const stream of streams) {
        const trimPolicy = policy === 'minid' ? 'MINID' : 'MAXLEN';
        const trimValue = policy === 'minid' ? `~ ${maxLength}` : maxLength;
        
        await this.redis.xtrim(stream, trimPolicy as any, trimValue);
      }
      
      console.log(`Manually trimmed topic '${topicName}' to maxLength ${maxLength}`);
    } catch (error) {
      console.error(`Error manually trimming topic '${topicName}':`, error);
      throw error;
    }
  }

  /**
   * Get topic length statistics
   */
  async getTopicLengthStats(topicName: string): Promise<{
    currentLength: number;
    maxLength: number;
    threshold: number;
    needsTrimming: boolean;
  }> {
    const currentLength = await this.getTopicLength(topicName);
    const maxLength = this.trimConfig.maxLength;
    const threshold = maxLength * this.trimConfig.trimThreshold;
    const needsTrimming = currentLength > threshold;

    return {
      currentLength,
      maxLength,
      threshold,
      needsTrimming
    };
  }

  /**
   * Get trim events for a topic
   */
  getTrimEvents(topicName?: string): TrimEvent[] {
    if (topicName) {
      return this.trimEvents.filter(event => event.topic === topicName);
    }
    return [...this.trimEvents];
  }

  /**
   * Clear trim events
   */
  clearTrimEvents(): void {
    this.trimEvents = [];
  }

  /**
   * Emit trim event
   */
  private emitTrimEvent(topicName: string, event: Omit<TrimEvent, 'topic'>): void {
    const trimEvent: TrimEvent = {
      topic: topicName,
      ...event
    };
    
    this.trimEvents.push(trimEvent);
    
    // Keep only last 1000 events
    if (this.trimEvents.length > 1000) {
      this.trimEvents = this.trimEvents.slice(-1000);
    }
  }

  /**
   * Get configuration
   */
  getConfiguration(): TrimStrategy {
    return { ...this.trimConfig };
  }

  /**
   * Update configuration
   */
  updateConfiguration(updates: Partial<TrimStrategy>): void {
    this.trimConfig = { ...this.trimConfig, ...updates };
  }

  /**
   * Get memory usage statistics
   */
  async getMemoryStats(topicName: string): Promise<{
    topicLength: number;
    estimatedMemoryUsage: number; // bytes
    memoryUsagePercentage: number;
  }> {
    const currentLength = await this.getTopicLength(topicName);
    const estimatedMemoryUsage = currentLength * 1024; // Rough estimate: 1KB per message
    const memoryUsagePercentage = (estimatedMemoryUsage / (1024 * 1024 * 100)) * 100; // Percentage of 100MB

    return {
      topicLength: currentLength,
      estimatedMemoryUsage,
      memoryUsagePercentage
    };
  }
}
