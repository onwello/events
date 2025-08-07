import { EventConsumer, EventHandler, EventConsumerOptions } from './consumer';
import { EventValidator, EventEnvelope } from '../event-types';
import { BatchEnvelope, BatchMessage } from '../event-publisher/batched-publisher';
import { createHash } from 'crypto';

export interface BatchedEventConsumerOptions extends EventConsumerOptions {
  // Additional options specific to batch processing
  processBatchInOrder?: boolean; // Default: true
  maxConcurrentBatches?: number; // Default: 5
}

export class BatchedEventConsumer {
  private baseConsumer: EventConsumer;
  private batchHandlers: Map<string, EventHandler> = new Map();
  private config: BatchedEventConsumerOptions;
  private activeBatches = 0;
  private maxConcurrentBatches: number;

  constructor(options: BatchedEventConsumerOptions) {
    this.config = options;
    this.maxConcurrentBatches = options.maxConcurrentBatches || 5;
    
    // Create base consumer with batch handler
    this.baseConsumer = new EventConsumer({
      ...options,
      handlers: {
        ...options.handlers,
        'batch': this.handleBatch.bind(this), // Register batch handler
      },
    });
  }

  private async handleBatch(body: any, header: any, raw?: any): Promise<void> {
    if (this.activeBatches >= this.maxConcurrentBatches) {
      throw new Error('Too many concurrent batches being processed');
    }

    this.activeBatches++;

    try {
      const batchEnvelope = raw as BatchEnvelope;
      const messages = batchEnvelope.body.messages;

      if (this.config.processBatchInOrder !== false) {
        // Process messages in order
        await this.processBatchInOrder(messages);
      } else {
        // Process messages concurrently (use with caution)
        await this.processBatchConcurrently(messages);
      }
    } finally {
      this.activeBatches--;
    }
  }

  private async processBatchInOrder(messages: BatchMessage[]): Promise<void> {
    for (const message of messages) {
      try {
        await this.processIndividualMessage(message);
      } catch (error) {
        console.error(`Failed to process message ${message.originalId} in batch:`, error);
        // Continue processing other messages in the batch
        // Failed messages can be handled by the client code
      }
    }
  }

  private async processBatchConcurrently(messages: BatchMessage[]): Promise<void> {
    const promises = messages.map(async (message) => {
      try {
        await this.processIndividualMessage(message);
      } catch (error) {
        console.error(`Failed to process message ${message.originalId} in batch:`, error);
        // Continue processing other messages in the batch
      }
    });

    await Promise.allSettled(promises);
  }

  private async processIndividualMessage(message: BatchMessage): Promise<void> {
    const handler = this.baseConsumer['handlers'][message.eventType];
    
    if (!handler) {
      if (this.baseConsumer['logUnregisteredEvents'] !== 'none') {
        console[this.baseConsumer['logUnregisteredEvents']](
          `[BatchedEventConsumer] No handler registered for event type: ${message.eventType}, ignoring message`
        );
      }
      return;
    }

    // Use the original envelope that was created at operation time
    await handler(message.body, message.envelope.header, message.envelope);
  }

  // Expose base consumer methods
  async handleMessage(rawMessage: any): Promise<void> {
    // Check if this is a batch envelope
    if (rawMessage && rawMessage.header && rawMessage.header.type === 'batch') {
      // Handle as batch envelope
      const batchEnvelope = rawMessage as BatchEnvelope;
      return this.handleBatch(batchEnvelope.body, batchEnvelope.header, batchEnvelope);
    } else {
      // Handle as regular event envelope
      return this.baseConsumer.handleMessage(rawMessage);
    }
  }

  get handlers(): Record<string, EventHandler> {
    return this.baseConsumer['handlers'];
  }

  get validator(): EventValidator {
    return this.baseConsumer['validator'];
  }

  get activeBatchCount(): number {
    return this.activeBatches;
  }
}
