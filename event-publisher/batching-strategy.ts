import { EventEnvelope } from '../event-types';

export interface BatchMessage<T = any> {
  eventType: string;
  body: T;
  originalId: string;
  timestamp: string;
  envelope: EventEnvelope<T>;
}

export interface BatchEnvelope {
  header: {
    type: string;
    messageCount: number;
    batchId: string;
    timestamp: string;
  };
  body: {
    messages: BatchMessage[];
  };
}

export type BatchingTypeStrategy = 'exact' | number;

export interface BatchingStrategy {
  /**
   * Determines if messages can be batched together
   */
  canBatchTogether(message1: BatchMessage, message2: BatchMessage): boolean;

  /**
   * Creates a batch envelope for the given messages
   */
  createBatchEnvelope(messages: BatchMessage[]): BatchEnvelope;

  /**
   * Sends the batch envelope using the transport
   */
  sendBatch(transport: any, batchEnvelope: BatchEnvelope): Promise<void>;

  /**
   * Sends individual messages as fallback
   */
  sendIndividualMessages(basePublisher: any, messages: BatchMessage[]): Promise<void>;

  /**
   * Gets the stream/queue name for this batch type
   */
  getBatchStreamName(): string;

  /**
   * Gets the batching key for an event type based on the strategy
   */
  getBatchingKey(eventType: string): string;
}

export interface BatchConfig {
  maxSize: number;
  maxWaitMs: number;
  maxConcurrentBatches: number;
  batchingTypeStrategy?: BatchingTypeStrategy;
}
