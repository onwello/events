import { Redis } from 'ioredis';
import { PoisonMessage } from './poison-message-handler';

export interface BackpressureConfig {
  backpressureThreshold: number; // Alert when PEL > threshold
  slowConsumerThreshold: number; // Alert when lag > threshold (ms)
  recoveryStrategy: 'exponential-backoff' | 'linear-backoff' | 'immediate';
  maxRetries: number;
  monitoring?: {
    enabled: boolean;
    metricsInterval: number; // milliseconds
    alertCallbacks?: {
      onBackpressure?: (topic: string, group: string, pendingCount: number) => void;
      onSlowConsumer?: (topic: string, group: string, lag: number) => void;
      onPoisonMessage?: (message: PoisonMessage) => void;
    };
  };
  poisonMessageConfig?: {
    enabled: boolean;
    maxRetries: number;
    deadLetterTopic: string;
    retryDelayMs: number;
  };
}

export interface BackpressureMetrics {
  topic: string;
  group: string;
  pendingCount: number;
  lag: number; // milliseconds
  consumerCount: number;
  lastDeliveredId: string;
  entriesRead: number;
  isBackpressured: boolean;
  isSlowConsumer: boolean;
}

export interface BackpressureAlert {
  type: 'backpressure' | 'slow_consumer' | 'poison_message';
  topic: string;
  group: string;
  message: string;
  metrics: BackpressureMetrics;
  timestamp: Date;
}

export class EnhancedBackpressureMonitor {
  private redis: Redis;
  private config: BackpressureConfig;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private metrics: Map<string, BackpressureMetrics> = new Map();
  private alerts: BackpressureAlert[] = [];
  private poisonMonitor?: any; // PoisonMessageMonitor

  constructor(redis: Redis, config: BackpressureConfig) {
    this.redis = redis;
    this.config = config;
  }

  /**
   * Start monitoring a topic/group for backpressure
   */
  startMonitoring(topic: string, group: string): void {
    if (!this.config.monitoring?.enabled) return;

    const key = `${topic}:${group}`;
    if (this.monitoringIntervals.has(key)) return;

    const interval = setInterval(async () => {
      await this.checkBackpressure(topic, group);
    }, this.config.monitoring.metricsInterval);

    this.monitoringIntervals.set(key, interval);
  }

  /**
   * Stop monitoring a topic/group
   */
  stopMonitoring(topic: string, group: string): void {
    const key = `${topic}:${group}`;
    const interval = this.monitoringIntervals.get(key);
    
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(key);
    }
  }

  /**
   * Stop all monitoring
   */
  stopAllMonitoring(): void {
    for (const [key, interval] of this.monitoringIntervals) {
      clearInterval(interval);
    }
    this.monitoringIntervals.clear();
  }

  /**
   * Check backpressure for a specific topic/group
   */
  async checkBackpressure(topic: string, group: string): Promise<void> {
    try {
      const streams = this.getStreamsForTopic(topic);
      let totalPending = 0;
      let totalLag = 0;
      let totalConsumers = 0;
      let lastDeliveredId = '0-0';
      let totalEntriesRead = 0;

      for (const stream of streams) {
        const metrics = await this.getStreamMetrics(stream, group);
        totalPending += metrics.pendingCount;
        totalLag = Math.max(totalLag, metrics.lag);
        totalConsumers += metrics.consumerCount;
        if (metrics.lastDeliveredId !== '0-0') {
          lastDeliveredId = metrics.lastDeliveredId;
        }
        totalEntriesRead += metrics.entriesRead;
      }

      const backpressureMetrics: BackpressureMetrics = {
        topic,
        group,
        pendingCount: totalPending,
        lag: totalLag,
        consumerCount: totalConsumers,
        lastDeliveredId,
        entriesRead: totalEntriesRead,
        isBackpressured: totalPending > this.config.backpressureThreshold,
        isSlowConsumer: totalLag > this.config.slowConsumerThreshold
      };

      this.metrics.set(`${topic}:${group}`, backpressureMetrics);

      // Check for alerts
      if (backpressureMetrics.isBackpressured) {
        this.emitBackpressureAlert(topic, group, backpressureMetrics);
      }

      if (backpressureMetrics.isSlowConsumer) {
        this.emitSlowConsumerAlert(topic, group, backpressureMetrics);
      }

    } catch (error) {
      console.error(`Error checking backpressure for ${topic}:${group}:`, error);
    }
  }

  /**
   * Get metrics for a specific stream and group
   */
  private async getStreamMetrics(stream: string, group: string): Promise<{
    pendingCount: number;
    lag: number;
    consumerCount: number;
    lastDeliveredId: string;
    entriesRead: number;
  }> {
    try {
      const pending = await this.redis.xpending(stream, group);
      const groups = await this.redis.xinfo('GROUPS', stream);
      const groupInfo = groups.find((g: any) => g[1] === group);

      if (!groupInfo) {
        return {
          pendingCount: 0,
          lag: 0,
          consumerCount: 0,
          lastDeliveredId: '0-0',
          entriesRead: 0
        };
      }

      const consumers = await this.redis.xinfo('CONSUMERS', stream, group);
      
      return {
        pendingCount: pending[0] || 0,
        lag: parseInt(groupInfo[7]) || 0,
        consumerCount: consumers.length,
        lastDeliveredId: groupInfo[3] || '0-0',
        entriesRead: parseInt(groupInfo[5]) || 0
      };
    } catch (error) {
      console.error(`Error getting stream metrics for ${stream}:${group}:`, error);
      return {
        pendingCount: 0,
        lag: 0,
        consumerCount: 0,
        lastDeliveredId: '0-0',
        entriesRead: 0
      };
    }
  }

  /**
   * Emit backpressure alert
   */
  private emitBackpressureAlert(topic: string, group: string, metrics: BackpressureMetrics): void {
    const alert: BackpressureAlert = {
      type: 'backpressure',
      topic,
      group,
      message: `High backpressure detected: ${metrics.pendingCount} pending messages`,
      metrics,
      timestamp: new Date()
    };

    this.alerts.push(alert);
    this.config.monitoring?.alertCallbacks?.onBackpressure?.(topic, group, metrics.pendingCount);
  }

  /**
   * Emit slow consumer alert
   */
  private emitSlowConsumerAlert(topic: string, group: string, metrics: BackpressureMetrics): void {
    const alert: BackpressureAlert = {
      type: 'slow_consumer',
      topic,
      group,
      message: `Slow consumer detected: ${metrics.lag}ms lag`,
      metrics,
      timestamp: new Date()
    };

    this.alerts.push(alert);
    this.config.monitoring?.alertCallbacks?.onSlowConsumer?.(topic, group, metrics.lag);
  }

  /**
   * Get recovery strategy for a failed message
   */
  getRecoveryStrategy(retryCount: number): {
    shouldRetry: boolean;
    delay: number;
    strategy: string;
  } {
    if (retryCount >= this.config.maxRetries) {
      return { shouldRetry: false, delay: 0, strategy: 'max_retries_exceeded' };
    }

    let delay: number;
    switch (this.config.recoveryStrategy) {
      case 'exponential-backoff':
        delay = this.config.poisonMessageConfig?.retryDelayMs || 1000 * Math.pow(2, retryCount);
        break;
      case 'linear-backoff':
        delay = (this.config.poisonMessageConfig?.retryDelayMs || 1000) * (retryCount + 1);
        break;
      case 'immediate':
        delay = 0;
        break;
      default:
        delay = this.config.poisonMessageConfig?.retryDelayMs || 1000;
    }

    return { shouldRetry: true, delay, strategy: this.config.recoveryStrategy };
  }

  /**
   * Handle graceful degradation
   */
  async handleGracefulDegradation(topic: string, group: string, error: Error): Promise<void> {
    console.warn(`Graceful degradation for ${topic}:${group} due to: ${error.message}`);

    // Implement graceful degradation strategies
    // 1. Reduce batch size
    // 2. Increase timeouts
    // 3. Switch to fallback handlers
    // 4. Alert operators

    if (this.config.poisonMessageConfig?.enabled && this.poisonMonitor) {
      // Track as poison message
      await this.poisonMonitor.trackFailedMessage(
        'degradation-' + Date.now(),
        topic,
        group,
        'degradation',
        { error: error.message },
        error
      );
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
   * Get all metrics
   */
  getAllMetrics(): BackpressureMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get metrics for a specific topic/group
   */
  getMetrics(topic: string, group: string): BackpressureMetrics | undefined {
    return this.metrics.get(`${topic}:${group}`);
  }

  /**
   * Get all alerts
   */
  getAllAlerts(): BackpressureAlert[] {
    return [...this.alerts];
  }

  /**
   * Get alerts by type
   */
  getAlertsByType(type: BackpressureAlert['type']): BackpressureAlert[] {
    return this.alerts.filter(alert => alert.type === type);
  }

  /**
   * Clear alerts
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * Set poison message monitor
   */
  setPoisonMonitor(poisonMonitor: any): void {
    this.poisonMonitor = poisonMonitor;
  }

  /**
   * Get configuration
   */
  getConfiguration(): BackpressureConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfiguration(updates: Partial<BackpressureConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get summary statistics
   */
  getSummaryStats(): {
    totalTopics: number;
    totalGroups: number;
    backpressuredTopics: number;
    slowConsumers: number;
    totalAlerts: number;
  } {
    const metrics = Array.from(this.metrics.values());
    const backpressuredTopics = new Set(metrics.filter(m => m.isBackpressured).map(m => m.topic)).size;
    const slowConsumers = metrics.filter(m => m.isSlowConsumer).length;

    return {
      totalTopics: new Set(metrics.map(m => m.topic)).size,
      totalGroups: metrics.length,
      backpressuredTopics,
      slowConsumers,
      totalAlerts: this.alerts.length
    };
  }
}
