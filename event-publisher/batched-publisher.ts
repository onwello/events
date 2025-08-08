import { EventPublisher, EventPublisherOptions, EventPublisherInterface } from './index';
import { EventEnvelope, createEventEnvelope, EventValidator } from '../event-types';
import { BatchingStrategy, BatchMessage, BatchConfig, BatchEnvelope, BatchingTypeStrategy } from './batching-strategy';
import { BatchingStrategyFactory, TransportType, StrategyFactoryOptions } from './strategies/strategy-factory';
import { firstValueFrom } from 'rxjs';

// Re-export types for backward compatibility
export { BatchConfig, BatchMessage, BatchEnvelope, BatchingTypeStrategy } from './batching-strategy';

export interface BatchedEventPublisherOptions extends EventPublisherOptions {
  batchConfig?: BatchConfig;
  transportType?: TransportType;
  typePrefix?: string;
  batchingTypeStrategy?: BatchingTypeStrategy;
}

class BatchQueue {
  private messages: BatchMessage[] = [];
  private flushTimeout?: NodeJS.Timeout;
  private isFlushing = false;
  private concurrentBatches = 0;

  constructor(
    private config: BatchConfig,
    private strategy: BatchingStrategy,
    private onFlush: (messages: BatchMessage[]) => Promise<void>,
    private originServiceName: string,
    private eventNamespace?: string
  ) {}

  async addMessage<T>(eventType: string, body: T): Promise<void> {
    const envelope = createEventEnvelope(
      eventType,
      this.originServiceName,
      body,
      this.eventNamespace
    );

    const message: BatchMessage = {
      eventType,
      body,
      originalId: envelope.header.id,
      timestamp: envelope.header.timestamp,
      envelope,
    };

    // Check if this message can be batched with existing messages
    if (this.messages.length > 0 && !this.strategy.canBatchTogether(this.messages[0], message)) {
      // Flush current batch before adding new message
      await this.flush();
    }

    this.messages.push(message);

    // Set timeout for max wait
    if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flush(), this.config.maxWaitMs);
    }

    // Flush if max size reached
    if (this.messages.length >= this.config.maxSize) {
      await this.flush();
    }
  }

  private clearFlushTimeout(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = undefined;
    }
  }

  async flush(): Promise<void> {
    if (this.isFlushing || this.messages.length === 0) {
      return;
    }

    // Clear timeout first to prevent race conditions
    this.clearFlushTimeout();
    this.isFlushing = true;

    try {
      // Check concurrent batch limit
      if (this.concurrentBatches >= this.config.maxConcurrentBatches) {
        throw new Error('Too many concurrent batches');
      }

      this.concurrentBatches++;
      const messagesToSend = [...this.messages];
      this.messages = [];

      await this.onFlush(messagesToSend);
    } finally {
      this.isFlushing = false;
      this.concurrentBatches--;
    }
  }

  async forceFlush(): Promise<void> {
    if (this.messages.length > 0) {
      await this.flush();
    }
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  // Cleanup method for memory management
  cleanup(): void {
    this.clearFlushTimeout();
    this.messages = [];
    this.isFlushing = false;
    this.concurrentBatches = 0;
  }
}

export class BatchedEventPublisher {
  private basePublisher: EventPublisher;
  private batchConfig: BatchConfig;
  private strategy: BatchingStrategy;
  private queues: Map<string, BatchQueue> = new Map();
  private failedMessages: BatchMessage[] = [];
  private activeBatches = 0;

  // Memory management constants
  private readonly MAX_FAILED_MESSAGES = 1000;
  private readonly MAX_QUEUES = 100;
  private readonly QUEUE_CLEANUP_INTERVAL = 60000; // 1 minute
  private lastQueueCleanup = Date.now();

  constructor(
    transports: Record<string, any>,
    options: BatchedEventPublisherOptions
  ) {
    this.basePublisher = new EventPublisher(transports, options);
    this.batchConfig = options.batchConfig || {
      maxSize: 100,
      maxWaitMs: 1000,
      maxConcurrentBatches: 5,
      batchingTypeStrategy: 'exact',
    };

    const transportType = options.transportType || 'console';
    const strategyOptions: StrategyFactoryOptions = {
      typePrefix: options.typePrefix || 'default',
      batchingTypeStrategy: this.batchConfig.batchingTypeStrategy,
    };
    
    this.strategy = BatchingStrategyFactory.createStrategy(transportType, strategyOptions);
  }

  // Expose validator for tests
  get validator(): EventValidator {
    return this.basePublisher['validator'];
  }

  async addMessage<T>(eventType: string, body: T): Promise<void> {
    // Validate the message before adding to queue
    const validationResult = this.basePublisher['validator'].validate(eventType, body);
    if (!validationResult.valid) {
      throw new Error(`Invalid event body for type ${eventType}: ${validationResult.error}`);
    }

    const batchingKey = this.strategy.getBatchingKey(eventType);
    
    // Check queue limit to prevent memory leaks
    if (!this.queues.has(batchingKey) && this.queues.size >= this.MAX_QUEUES) {
      this.cleanupEmptyQueues();
      if (this.queues.size >= this.MAX_QUEUES) {
        throw new Error(`Too many unique event types (${this.MAX_QUEUES}). Consider using more specific batching strategies.`);
      }
    }
    
    if (!this.queues.has(batchingKey)) {
      this.queues.set(batchingKey, new BatchQueue(
        this.batchConfig,
        this.strategy,
        (messages) => this.sendBatch(messages),
        this.basePublisher['options'].originServiceName,
        this.basePublisher['eventNamespace']
      ));
    }

    const queue = this.queues.get(batchingKey)!;
    await queue.addMessage(eventType, body);
  }

  async publishBatch<T>(eventType: string, bodies: T[]): Promise<void> {
    const promises = bodies.map(body => this.addMessage(eventType, body));
    await Promise.all(promises);
    await this.flush();
  }

  async flush(): Promise<void> {
    const promises = Array.from(this.queues.values()).map(queue => queue.forceFlush());
    await Promise.all(promises);
  }

  getFailedMessages(): BatchMessage[] {
    return [...this.failedMessages];
  }

  clearFailedMessages(): void {
    this.failedMessages = [];
  }

  // Memory management methods
  private addToFailedMessages(messages: BatchMessage[]): void {
    this.failedMessages.push(...messages);
    
    // Keep only the most recent failed messages to prevent memory leaks
    if (this.failedMessages.length > this.MAX_FAILED_MESSAGES) {
      this.failedMessages = this.failedMessages.slice(-this.MAX_FAILED_MESSAGES);
    }
  }

  private cleanupEmptyQueues(): void {
    const now = Date.now();
    
    // Only cleanup periodically to avoid performance impact
    if (now - this.lastQueueCleanup < this.QUEUE_CLEANUP_INTERVAL) {
      return;
    }
    
    this.lastQueueCleanup = now;
    
    for (const [key, queue] of this.queues.entries()) {
      if (queue.getMessageCount() === 0) {
        queue.cleanup();
        this.queues.delete(key);
      }
    }
  }

  // Cleanup method for memory management
  cleanup(): void {
    // Cleanup all queues
    for (const queue of this.queues.values()) {
      queue.cleanup();
    }
    this.queues.clear();
    
    // Clear failed messages
    this.failedMessages = [];
    
    // Reset counters
    this.activeBatches = 0;
  }

  // Close method for proper resource cleanup
  async close(): Promise<void> {
    // Flush all pending batches
    await this.flush();
    
    // Cleanup all resources
    this.cleanup();
    
    // Close the base publisher
    if (this.basePublisher && typeof this.basePublisher.close === 'function') {
      await this.basePublisher.close();
    }
  }

  // Memory monitoring methods
  getMemoryStats(): {
    queueCount: number;
    totalMessages: number;
    failedMessageCount: number;
    activeBatches: number;
  } {
    let totalMessages = 0;
    for (const queue of this.queues.values()) {
      totalMessages += queue.getMessageCount();
    }

    return {
      queueCount: this.queues.size,
      totalMessages,
      failedMessageCount: this.failedMessages.length,
      activeBatches: this.activeBatches,
    };
  }

  // Force cleanup of old failed messages
  cleanupOldFailedMessages(maxAgeMs: number = 3600000): void { // Default 1 hour
    const now = Date.now();
    this.failedMessages = this.failedMessages.filter(message => {
      const messageTime = new Date(message.timestamp).getTime();
      return now - messageTime < maxAgeMs;
    });
  }

  private async sendBatch(messages: BatchMessage[]): Promise<void> {
    // Check concurrent batch limit
    if (this.activeBatches >= this.batchConfig.maxConcurrentBatches) {
      throw new Error('Too many concurrent batches');
    }

    this.activeBatches++;

    try {
      const batchEnvelope = this.strategy.createBatchEnvelope(messages);
      const transport = this.getTransportForBatch();
      
      await this.strategy.sendBatch(transport, batchEnvelope);
    } catch (error) {
      // Retry once as individual messages using their original envelopes
      try {
        await this.strategy.sendIndividualMessages(
          this.basePublisher as EventPublisherInterface,
          messages
        );
      } catch (individualError) {
        // If individual messages also fail, add them to failed messages
        this.addToFailedMessages(messages);
        // Don't re-throw the error, just log it and continue
      }
    } finally {
      this.activeBatches--;
    }
  }

  private getEventTypePrefix(eventType: string): string {
    const parts = eventType.split('.');
    return parts.length > 1 ? `${parts[0]}.` : 'default.';
  }

  private getTransportForBatch(): any {
    // Try to get transport for 'batch' event type, fallback to first available transport
    try {
      const { transport } = this.basePublisher.getTransportForEvent('batch');
      return transport;
    } catch (error) {
      // If no specific route for 'batch', use the first available transport
      const transports = this.basePublisher['transports'];
      return Object.values(transports)[0];
    }
  }
}
