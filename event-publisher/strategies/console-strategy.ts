import { BatchingStrategy, BatchMessage, BatchEnvelope, BatchingTypeStrategy } from '../batching-strategy';
import { createHash } from 'crypto';
import { EventPublisherInterface } from '../index';

export class ConsoleBatchingStrategy implements BatchingStrategy {
  private batchingTypeStrategy: BatchingTypeStrategy;

  constructor(batchingTypeStrategy: BatchingTypeStrategy = 'exact') {
    this.batchingTypeStrategy = batchingTypeStrategy;
  }

  canBatchTogether(message1: BatchMessage, message2: BatchMessage): boolean {
    // Console transport can batch any messages together by default
    // But can be configured to use specific batching strategies
    if (this.batchingTypeStrategy === 'exact') {
      return message1.eventType === message2.eventType;
    }
    
    if (typeof this.batchingTypeStrategy === 'number') {
      const key1 = this.getBatchingKey(message1.eventType);
      const key2 = this.getBatchingKey(message2.eventType);
      return key1 === key2;
    }
    
    // Default: batch any messages together
    return true;
  }

  createBatchEnvelope(messages: BatchMessage[]): BatchEnvelope {
    const batchId = createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex');

    return {
      header: {
        type: 'batch',
        messageCount: messages.length,
        batchId,
        timestamp: new Date().toISOString(),
      },
      body: {
        messages,
      },
    };
  }

  async sendBatch(transport: any, batchEnvelope: BatchEnvelope): Promise<void> {
    if (typeof (transport as any).dispatchEvent === 'function') {
      await (transport as any).dispatchEvent(
        { pattern: batchEnvelope.header.type, data: batchEnvelope },
        { stream: 'console' }
      );
    } else {
      await transport.emit(batchEnvelope.header.type, batchEnvelope);
    }
  }

  async sendIndividualMessages(basePublisher: EventPublisherInterface, messages: BatchMessage[]): Promise<void> {
    const results = await Promise.allSettled(messages.map(async (message) => {
      try {
        const { transport, prefix } = basePublisher.getTransportForEvent(message.eventType);
        
        // Debug logging
        if (!transport) {
          console.error(`Transport is undefined for event type: ${message.eventType}`);
          throw new Error(`No transport found for event type: ${message.eventType}`);
        }
        
        const finalEventType = prefix ? `${prefix}${message.eventType}` : message.eventType;
        
        // Use the same approach as EventPublisher
        if (typeof (transport as any).dispatchEvent === 'function') {
          await (transport as any).dispatchEvent(
            { pattern: finalEventType, data: message.envelope },
            { stream: 'console' }
          );
        } else if (typeof transport.emit === 'function') {
          await transport.emit(finalEventType, message.envelope);
        } else {
          throw new Error('Transport does not support dispatchEvent or emit');
        }
      } catch (error) {
        console.error(`Failed to send individual message ${message.originalId}:`, error);
        throw error;
      }
    }));

    // Check if any messages failed
    const failedResults = results.filter(result => result.status === 'rejected');
    if (failedResults.length > 0) {
      throw new Error(`${failedResults.length} individual messages failed to send`);
    }
  }

  getBatchStreamName(): string {
    return 'console';
  }

  getBatchingKey(eventType: string): string {
    const parts = eventType.split('.');
    
    if (this.batchingTypeStrategy === 'exact') {
      return eventType;
    }
    
    if (typeof this.batchingTypeStrategy === 'number') {
      const position = this.batchingTypeStrategy;
      if (position >= parts.length) {
        // If position is beyond the available parts, use the full event type
        return eventType;
      }
      // Join parts up to the specified position
      return parts.slice(0, position + 1).join('.');
    }
    
    // Default to exact matching
    return eventType;
  }
}
