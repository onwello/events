import { MessageMetadata } from './transport.interface';

export interface PoisonMessage {
  id: string;
  topic: string;
  group: string;
  eventType: string;
  payload: any;
  error: string;
  retryCount: number;
  firstFailureTime: Date;
  lastFailureTime: Date;
  totalProcessingTime: number;
  metadata?: MessageMetadata;
}

export interface PoisonMessageConfig {
  enabled: boolean;
  maxRetries: number;
  deadLetterTopic: string;
  retryDelayMs: number;
  retryBackoff?: 'linear' | 'exponential';
  poisonMessageHandlers?: {
    onPoisonMessage?: (message: PoisonMessage) => void;
    onMaxRetriesExceeded?: (message: PoisonMessage) => void;
  };
}

export interface PoisonMessageStats {
  totalPoisonMessages: number;
  messagesByEventType: Record<string, number>;
  messagesByTopic: Record<string, number>;
  averageRetryCount: number;
  oldestPoisonMessage: Date | null;
  retryDistribution: Record<number, number>; // retryCount -> count
}

export class PoisonMessageMonitor {
  private redis: any; // Redis client
  private config: PoisonMessageConfig;
  private poisonMessages: Map<string, PoisonMessage> = new Map();
  private stats: PoisonMessageStats = {
    totalPoisonMessages: 0,
    messagesByEventType: {},
    messagesByTopic: {},
    averageRetryCount: 0,
    oldestPoisonMessage: null,
    retryDistribution: {}
  };

  constructor(redis: any, config: PoisonMessageConfig) {
    this.redis = redis;
    this.config = config;
  }

  /**
   * Track a failed message
   */
  async trackFailedMessage(
    messageId: string,
    topic: string,
    group: string,
    eventType: string,
    payload: any,
    error: Error,
    metadata?: MessageMetadata
  ): Promise<void> {
    const existing = this.poisonMessages.get(messageId);
    
    if (existing) {
      // Update existing poison message
      existing.retryCount++;
      existing.lastFailureTime = new Date();
      existing.error = error.message;
      existing.totalProcessingTime = Date.now() - existing.firstFailureTime.getTime();
      
      if (existing.retryCount >= this.config.maxRetries) {
        await this.handleMaxRetriesExceeded(existing);
      } else {
        this.config.poisonMessageHandlers?.onPoisonMessage?.(existing);
      }
    } else {
      // Create new poison message
      const poisonMessage: PoisonMessage = {
        id: messageId,
        topic,
        group,
        eventType,
        payload,
        error: error.message,
        retryCount: 1,
        firstFailureTime: new Date(),
        lastFailureTime: new Date(),
        totalProcessingTime: 0,
        metadata
      };
      
      this.poisonMessages.set(messageId, poisonMessage);
      this.config.poisonMessageHandlers?.onPoisonMessage?.(poisonMessage);
    }

    // Update statistics
    this.updateStats();
  }

  /**
   * Handle message that has exceeded max retries
   */
  private async handleMaxRetriesExceeded(message: PoisonMessage): Promise<void> {
    try {
      // Send to dead letter topic
      await this.sendToDeadLetterTopic(message);
      
      // Call max retries exceeded handler
      this.config.poisonMessageHandlers?.onMaxRetriesExceeded?.(message);
      
      // Remove from active poison messages (it's now in DLQ)
      this.poisonMessages.delete(message.id);
      
    } catch (error) {
      console.error('Error handling max retries exceeded:', error);
    }
  }

  /**
   * Send message to dead letter topic
   */
  private async sendToDeadLetterTopic(message: PoisonMessage): Promise<void> {
    const deadLetterMessage = {
      originalMessage: message,
      timestamp: new Date(),
      reason: 'max_retries_exceeded'
    };

    // Use Redis streams to send to dead letter topic
    await this.redis.xadd(
      `topic:${this.config.deadLetterTopic}:partition:0`,
      '*',
      'message', JSON.stringify(deadLetterMessage)
    );
  }

  /**
   * Get poison message by ID
   */
  getPoisonMessage(messageId: string): PoisonMessage | undefined {
    return this.poisonMessages.get(messageId);
  }

  /**
   * Get all poison messages
   */
  getAllPoisonMessages(): PoisonMessage[] {
    return Array.from(this.poisonMessages.values());
  }

  /**
   * Get poison messages by topic
   */
  getPoisonMessagesByTopic(topic: string): PoisonMessage[] {
    return Array.from(this.poisonMessages.values()).filter(msg => msg.topic === topic);
  }

  /**
   * Get poison messages by event type
   */
  getPoisonMessagesByEventType(eventType: string): PoisonMessage[] {
    return Array.from(this.poisonMessages.values()).filter(msg => msg.eventType === eventType);
  }

  /**
   * Get poison message statistics
   */
  getPoisonMessageStats(): PoisonMessageStats {
    return { ...this.stats };
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    const messages = Array.from(this.poisonMessages.values());
    
    // Count by event type
    const eventTypeCounts: Record<string, number> = {};
    const topicCounts: Record<string, number> = {};
    const retryDistribution: Record<number, number> = {};
    
    messages.forEach(msg => {
      eventTypeCounts[msg.eventType] = (eventTypeCounts[msg.eventType] || 0) + 1;
      topicCounts[msg.topic] = (topicCounts[msg.topic] || 0) + 1;
      retryDistribution[msg.retryCount] = (retryDistribution[msg.retryCount] || 0) + 1;
    });
    
    this.stats = {
      totalPoisonMessages: messages.length,
      messagesByEventType: eventTypeCounts,
      messagesByTopic: topicCounts,
      averageRetryCount: messages.length > 0 ? 
        messages.reduce((sum, msg) => sum + msg.retryCount, 0) / messages.length : 0,
      oldestPoisonMessage: messages.length > 0 ? 
        new Date(Math.min(...messages.map(msg => msg.firstFailureTime.getTime()))) : null,
      retryDistribution
    };
  }

  /**
   * Clear poison message history
   */
  clearPoisonMessages(): void {
    this.poisonMessages.clear();
    this.updateStats();
  }

  /**
   * Remove a specific poison message
   */
  removePoisonMessage(messageId: string): boolean {
    const removed = this.poisonMessages.delete(messageId);
    if (removed) {
      this.updateStats();
    }
    return removed;
  }

  /**
   * Get retry delay for a message
   */
  getRetryDelay(retryCount: number): number {
    if (this.config.retryBackoff === 'exponential') {
      return this.config.retryDelayMs * Math.pow(2, retryCount - 1);
    }
    return this.config.retryDelayMs;
  }

  /**
   * Check if a message should be retried
   */
  shouldRetry(messageId: string): boolean {
    const message = this.poisonMessages.get(messageId);
    return message ? message.retryCount < this.config.maxRetries : false;
  }

  /**
   * Get configuration
   */
  getConfiguration(): PoisonMessageConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfiguration(updates: Partial<PoisonMessageConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
