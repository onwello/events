import { MessageBroker, createMessageBroker } from '../event-transport/transport-factory';
import { TransportConfig, MessageHandler, MessageMetadata } from '../event-transport/transport.interface';
import { EventEnvelope } from '../event-types';

export interface EnhancedConsumerConfig {
  transport: TransportConfig;
  consumerId?: string;
  groupId?: string;
  autoOffsetReset?: 'earliest' | 'latest' | 'specific';
  enableAutoCommit?: boolean;
  autoCommitInterval?: number;
  enablePatternRouting?: boolean;
  poisonMessageHandler?: (message: any, error: Error) => Promise<void>;
}

export interface ConsumerOptions {
  groupId?: string;
  consumerId?: string;
  autoOffsetReset?: 'earliest' | 'latest' | 'specific';
  enableAutoCommit?: boolean;
  autoCommitInterval?: number;
}

export class EnhancedEventConsumer {
  private broker: MessageBroker;
  private config: EnhancedConsumerConfig;
  private handlers: Map<string, MessageHandler> = new Map();
  private patternHandlers: Map<string, MessageHandler> = new Map();
  
  constructor(config: EnhancedConsumerConfig) {
    this.config = config;
    this.broker = createMessageBroker(config.transport);
  }
  
  // Subscribe to a specific topic
  async subscribe(topic: string, handler: (event: any, metadata: MessageMetadata) => Promise<void>, options?: ConsumerOptions): Promise<void> {
    const wrappedHandler = this.wrapHandler(handler);
    this.handlers.set(topic, wrappedHandler);
    
    await this.broker.subscribe(topic, wrappedHandler, {
      groupId: options?.groupId || this.config.groupId,
      consumerId: options?.consumerId || this.config.consumerId,
      autoOffsetReset: options?.autoOffsetReset || this.config.autoOffsetReset,
      enableAutoCommit: options?.enableAutoCommit ?? this.config.enableAutoCommit,
      autoCommitInterval: options?.autoCommitInterval || this.config.autoCommitInterval
    });
  }
  
  // Subscribe to a pattern (wildcard routing)
  async subscribePattern(pattern: string, handler: (event: any, metadata: MessageMetadata) => Promise<void>, options?: ConsumerOptions): Promise<void> {
    if (!this.config.enablePatternRouting) {
      throw new Error('Pattern routing is not enabled');
    }
    
    const wrappedHandler = this.wrapHandler(handler);
    this.patternHandlers.set(pattern, wrappedHandler);
    
    await this.broker.subscribePattern(pattern, wrappedHandler, {
      groupId: options?.groupId || this.config.groupId,
      consumerId: options?.consumerId || this.config.consumerId,
      autoOffsetReset: options?.autoOffsetReset || this.config.autoOffsetReset,
      enableAutoCommit: options?.enableAutoCommit ?? this.config.enableAutoCommit,
      autoCommitInterval: options?.autoCommitInterval || this.config.autoCommitInterval
    });
  }
  
  // Subscribe to multiple topics
  async subscribeToTopics(topics: string[], handler: (event: any, metadata: MessageMetadata) => Promise<void>, options?: ConsumerOptions): Promise<void> {
    const promises = topics.map(topic => this.subscribe(topic, handler, options));
    await Promise.all(promises);
  }
  
  // Subscribe to multiple patterns
  async subscribeToPatterns(patterns: string[], handler: (event: any, metadata: MessageMetadata) => Promise<void>, options?: ConsumerOptions): Promise<void> {
    const promises = patterns.map(pattern => this.subscribePattern(pattern, handler, options));
    await Promise.all(promises);
  }
  
  // Unsubscribe from a topic
  async unsubscribe(topic: string): Promise<void> {
    this.handlers.delete(topic);
    // Note: Transport-level unsubscribe would be implemented here
  }
  
  // Unsubscribe from a pattern
  async unsubscribePattern(pattern: string): Promise<void> {
    this.patternHandlers.delete(pattern);
    // Note: Transport-level unsubscribe would be implemented here
  }
  
  // Connect to the message broker
  async connect(): Promise<void> {
    await this.broker.connect();
  }
  
  // Close the connection
  async close(): Promise<void> {
    await this.broker.close();
  }
  
  // Get broker capabilities
  getCapabilities() {
    return this.broker.getCapabilities();
  }
  
  // Get subscribed topics
  getSubscribedTopics(): string[] {
    return Array.from(this.handlers.keys());
  }
  
  // Get subscribed patterns
  getSubscribedPatterns(): string[] {
    return Array.from(this.patternHandlers.keys());
  }
  
  // Check if subscribed to a topic
  isSubscribedToTopic(topic: string): boolean {
    return this.handlers.has(topic);
  }
  
  // Check if subscribed to a pattern
  isSubscribedToPattern(pattern: string): boolean {
    return this.patternHandlers.has(pattern);
  }
  
  // Helper methods
  private wrapHandler(handler: (event: any, metadata: MessageMetadata) => Promise<void>): MessageHandler {
    return async (message: any, metadata: MessageMetadata) => {
      try {
        // Extract event from envelope if it's wrapped
        let event = message;
        if (message && typeof message === 'object' && message.data) {
          event = message.data;
        }
        
        await handler(event, metadata);
      } catch (error) {
        await this.handlePoisonMessage(message, error as Error, metadata);
      }
    };
  }
  
  private async handlePoisonMessage(message: any, error: Error, metadata: MessageMetadata): Promise<void> {
    try {
      if (this.config.poisonMessageHandler) {
        await this.config.poisonMessageHandler(message, error);
      } else {
        console.error('Poison message detected:', {
          message,
          error: error.message,
          metadata
        });
      }
    } catch (poisonHandlerError) {
      // Don't let poison message handler errors propagate
      console.error('Poison message handler failed:', poisonHandlerError);
    }
  }
}

// Factory function for easy creation
export function createEnhancedConsumer(config: EnhancedConsumerConfig): EnhancedEventConsumer {
  return new EnhancedEventConsumer(config);
}

// Example usage patterns
export class ConsumerBuilder {
  private config: EnhancedConsumerConfig;
  
  constructor(transport: TransportConfig) {
    this.config = {
      transport,
      consumerId: `consumer-${Date.now()}`,
      groupId: 'default-group',
      autoOffsetReset: 'latest',
      enableAutoCommit: true,
      autoCommitInterval: 5000,
      enablePatternRouting: true
    };
  }
  
  withConsumerId(consumerId: string): ConsumerBuilder {
    this.config.consumerId = consumerId;
    return this;
  }
  
  withGroupId(groupId: string): ConsumerBuilder {
    this.config.groupId = groupId;
    return this;
  }
  
  withAutoOffsetReset(reset: 'earliest' | 'latest' | 'specific'): ConsumerBuilder {
    this.config.autoOffsetReset = reset;
    return this;
  }
  
  withPatternRouting(enabled: boolean): ConsumerBuilder {
    this.config.enablePatternRouting = enabled;
    return this;
  }
  
  withPoisonMessageHandler(handler: (message: any, error: Error) => Promise<void>): ConsumerBuilder {
    this.config.poisonMessageHandler = handler;
    return this;
  }
  
  build(): EnhancedEventConsumer {
    return createEnhancedConsumer(this.config);
  }
}
