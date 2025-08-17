import { Transport, TransportCapabilities, EventEnvelope, MessageHandler, PatternHandler, SubscribeOptions } from '../event-transport/transport.interface';
import { EventRouter } from '../event-routing';
import { EventValidator } from '../event-types';

// Consumer configuration interface
export interface ConsumerConfig {
  transports: Map<string, Transport>;
  router: EventRouter;
  validator: EventValidator;
  consumerId?: string;
  groupId?: string;
  originPrefix?: string;
  origins?: string[];
  
  // Pattern routing configuration
  enablePatternRouting?: boolean;
  
  // Consumer groups configuration
  enableConsumerGroups?: boolean;
  
  // Poison message handling
  poisonMessageHandler?: (message: any, error: Error, metadata: any) => Promise<void>;
  
  // Validation mode
  validationMode?: 'strict' | 'warn' | 'ignore';
};

export interface ConsumerStats {
  totalMessagesReceived: number;
  totalMessagesReceivedByType: Record<string, number>;
  totalMessagesReceivedByTransport: Record<string, number>;
  totalMessagesReceivedByTopic: Record<string, number>;
  failedMessages: number;
  poisonMessages: number;
  averageProcessingTime: number;
  lastError?: string;
  lastErrorTime?: string;
  lastMessageTime?: string;
}

export interface SubscriptionInfo {
  eventType: string;
  resolvedTopic: string;
  transport: string;
  handler: MessageHandler | PatternHandler;
  options?: SubscribeOptions;
  isPattern: boolean;
  createdAt: string;
  messageCount: number;
}

export class EventConsumer {
  private transports: Map<string, Transport>;
  private router: EventRouter;
  private validator: EventValidator;
  private config: ConsumerConfig;
  
  private subscriptions: Map<string, SubscriptionInfo> = new Map();
  private patternSubscriptions: Map<string, SubscriptionInfo> = new Map();
  
  private stats: ConsumerStats = {
    totalMessagesReceived: 0,
    totalMessagesReceivedByType: {},
    totalMessagesReceivedByTransport: {},
    totalMessagesReceivedByTopic: {},
    failedMessages: 0,
    poisonMessages: 0,
    averageProcessingTime: 0
  };
  
  constructor(config: ConsumerConfig) {
    this.config = config;
    this.transports = config.transports;
    this.router = config.router;
    this.validator = config.validator;
  }
  
  // Core subscription method
  async subscribe<T>(
    eventType: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions
  ): Promise<void> {
    const resolvedTopic = this.router.resolveTopic(eventType);
    const transport = this.getTransportForEvent(eventType);
    
    // Find the transport name by comparing the transport instance
    let transportName = 'default';
    for (const [name, t] of this.transports.entries()) {
      if (t === transport) {
        transportName = name;
        break;
      }
    }
    
    const finalOptions: SubscribeOptions = {
      groupId: options?.groupId || this.config.groupId,
      consumerId: options?.consumerId || this.config.consumerId,
      autoOffsetReset: options?.autoOffsetReset || 'latest',
      enableAutoCommit: options?.enableAutoCommit ?? true,
      autoCommitInterval: options?.autoCommitInterval || 5000,
      ...options
    };
    
    // Wrap the handler to add statistics tracking and validation
    const wrappedHandler = this.wrapHandler(eventType, handler, transportName);
    
    // Subscribe to the transport
    await transport.subscribe(resolvedTopic, wrappedHandler, finalOptions);
    
    // Record subscription
    const subscriptionInfo: SubscriptionInfo = {
      eventType,
      resolvedTopic,
      transport: transportName,
      handler: wrappedHandler,
      options: finalOptions,
      isPattern: false,
      createdAt: new Date().toISOString(),
      messageCount: 0
    };
    
    this.subscriptions.set(eventType, subscriptionInfo);
  }
  
  // Pattern-based subscription
  async subscribePattern<T>(
    pattern: string,
    handler: PatternHandler<T>,
    options?: SubscribeOptions
  ): Promise<void> {
    if (!this.config.enablePatternRouting) {
      throw new Error('Pattern routing is not enabled for this consumer');
    }
    
    const transport = this.getTransportForEvent(pattern);
    
    // Find the transport name
    let transportName = 'default';
    for (const [name, t] of this.transports.entries()) {
      if (t === transport) {
        transportName = name;
        break;
      }
    }
    
    const finalOptions: SubscribeOptions = {
      groupId: options?.groupId || this.config.groupId,
      consumerId: options?.consumerId || this.config.consumerId,
      autoOffsetReset: options?.autoOffsetReset || 'latest',
      enableAutoCommit: options?.enableAutoCommit ?? true,
      autoCommitInterval: options?.autoCommitInterval || 5000,
      ...options
    };
    
    // Wrap the handler to add statistics tracking and validation
    const wrappedHandler = this.wrapPatternHandler(pattern, handler, transportName);
    
    // Check if transport supports pattern routing
    if (this.isAdvancedTransport(transport) && transport.subscribePattern) {
      await transport.subscribePattern(pattern, wrappedHandler, finalOptions);
    } else {
      throw new Error(`Transport ${transportName} does not support pattern routing`);
    }
    
    // Record pattern subscription
    const subscriptionInfo: SubscriptionInfo = {
      eventType: pattern,
      resolvedTopic: pattern,
      transport: transportName,
      handler: wrappedHandler,
      options: finalOptions,
      isPattern: true,
      createdAt: new Date().toISOString(),
      messageCount: 0
    };
    
    this.patternSubscriptions.set(pattern, subscriptionInfo);
  }
  
  // Unsubscribe from events
  async unsubscribe(eventType: string): Promise<void> {
    const subscription = this.subscriptions.get(eventType);
    if (!subscription) {
      return;
    }
    
    const transport = this.getTransportForEvent(eventType);
    await transport.unsubscribe(subscription.resolvedTopic);
    this.subscriptions.delete(eventType);
  }
  
  // Unsubscribe from pattern
  async unsubscribePattern(pattern: string): Promise<void> {
    const subscription = this.patternSubscriptions.get(pattern);
    if (!subscription) {
      return;
    }
    
    const transport = this.getTransportForEvent(pattern);
    if (this.isAdvancedTransport(transport) && transport.unsubscribePattern) {
      await transport.unsubscribePattern(pattern);
    }
    this.patternSubscriptions.delete(pattern);
  }
  
  // Get subscription information
  getSubscriptions(): SubscriptionInfo[] {
    return [
      ...Array.from(this.subscriptions.values()),
      ...Array.from(this.patternSubscriptions.values())
    ];
  }
  
  // Get statistics
  getStats(): ConsumerStats {
    return { ...this.stats };
  }
  
  // Connect to all transports
  async connect(): Promise<void> {
    for (const transport of this.transports.values()) {
      await transport.connect();
    }
  }
  
  // Close all connections
  async close(): Promise<void> {
    for (const transport of this.transports.values()) {
      await transport.close();
    }
  }
  
  // Private methods
  
  private getTransportForEvent(eventType: string): Transport {
    // For now, use the first available transport
    // In the future, this could be enhanced with more sophisticated routing
    const transport = this.transports.values().next().value;
    if (!transport) {
      throw new Error('No transport available');
    }
    return transport;
  }
  
  private isAdvancedTransport(transport: Transport): transport is Transport & { 
    subscribePattern?: Function;
    unsubscribePattern?: Function;
  } {
    return 'subscribePattern' in transport;
  }
  
  private updateStats(eventType: string, transport: string, topic: string, processingTime: number): void {
    this.stats.totalMessagesReceived++;
    this.stats.totalMessagesReceivedByType[eventType] = (this.stats.totalMessagesReceivedByType[eventType] || 0) + 1;
    this.stats.totalMessagesReceivedByTransport[transport] = (this.stats.totalMessagesReceivedByTransport[transport] || 0) + 1;
    this.stats.totalMessagesReceivedByTopic[topic] = (this.stats.totalMessagesReceivedByTopic[topic] || 0) + 1;
    
    // Update average processing time - handle first message case
    if (this.stats.totalMessagesReceived === 1) {
      this.stats.averageProcessingTime = processingTime;
    } else {
      const totalTime = this.stats.averageProcessingTime * (this.stats.totalMessagesReceived - 1) + processingTime;
      this.stats.averageProcessingTime = totalTime / this.stats.totalMessagesReceived;
    }
    
    this.stats.lastMessageTime = new Date().toISOString();
  }
  
  private handleError(error: any, eventType: string): void {
    this.stats.failedMessages++;
    this.stats.lastError = error.message;
    this.stats.lastErrorTime = new Date().toISOString();
    
    if (this.config.validationMode === 'strict') {
      console.error(`Failed to process event ${eventType}:`, error);
    }
  }
  
  private handlePoisonMessage(message: any, error: Error, metadata: any): void {
    this.stats.poisonMessages++;
    
    if (this.config.poisonMessageHandler) {
      this.config.poisonMessageHandler(message, error, metadata).catch(handlerError => {
        console.error('Error in poison message handler:', handlerError);
      });
    } else {
      console.error('Poison message received:', { message, error, metadata });
    }
  }

  // Handler wrapping for statistics and validation
  private wrapHandler<T>(
    eventType: string,
    handler: MessageHandler<T>,
    transportName: string
  ): MessageHandler<T> {
    return async (message: EventEnvelope<T>, metadata: any) => {
      const startTime = Date.now();
      
      try {
        // Origin filtering
        if (this.config.originPrefix || this.config.origins) {
          const messageOrigin = message.header?.originPrefix;
          const allowedOrigins = this.config.origins || [this.config.originPrefix];
          
          // Fix: Only filter if we have actual origins to check against
          if (allowedOrigins.length > 0 && (!messageOrigin || !allowedOrigins.includes(messageOrigin))) {
            return;
          }
        }
        
        // Validation
        if (this.config.validationMode !== 'ignore') {
          const validationResult = this.validator.validate(message.header.type, message.body);
          if (!validationResult.valid) {
            if (this.config.validationMode === 'strict') {
              throw new Error(`Validation failed: ${validationResult.error}`);
            } else {
              // In warn mode, call poison message handler if available but continue processing
              if (this.config.poisonMessageHandler) {
                try {
                  await this.config.poisonMessageHandler(message, new Error(`Validation failed: ${validationResult.error}`), metadata);
                  // Increment poison message counter when handler is called
                  this.stats.poisonMessages++;
                } catch (poisonError) {
                  console.error('Error in poison message handler:', poisonError);
                  // Still increment counter even if handler fails
                  this.stats.poisonMessages++;
                }
              } else {
                // No handler but still a poison message
                this.stats.poisonMessages++;
              }
              // Continue processing the message in warn mode
            }
          }
        }
        
        // Call handler
        await handler(message, metadata);
        
        // Update stats
        const processingTime = Date.now() - startTime;
        this.updateStats(message.header.type, transportName, message.header.type, processingTime);
        
        // Update subscription message count
        const subscription = this.subscriptions.get(message.header.type);
        if (subscription) {
          subscription.messageCount++;
        }
        
      } catch (error) {
        // Handle poison messages
        if (this.config.poisonMessageHandler) {
          try {
            await this.config.poisonMessageHandler(message, error as Error, metadata);
          } catch (poisonError) {
            console.error('Error in poison message handler:', poisonError);
          }
        }
        
        this.handleError(error, eventType);
        
        if (this.config.validationMode === 'strict') {
          throw error;
        }
      }
    };
  }
  
  private wrapPatternHandler<T>(
    pattern: string,
    handler: PatternHandler<T>,
    transportName: string
  ): PatternHandler<T> {
    return async (message: EventEnvelope<T>, metadata: any, matchedPattern: string) => {
      const startTime = Date.now();
      
      try {
        // Validation
        if (this.config.validationMode !== 'ignore') {
          const validationResult = this.validator.validate(message.header.type, message.body);
          if (!validationResult.valid) {
            if (this.config.validationMode === 'strict') {
              throw new Error(`Validation failed: ${validationResult.error}`);
            } else {
              // In warn mode, call poison message handler if available but continue processing
              if (this.config.poisonMessageHandler) {
                try {
                  await this.config.poisonMessageHandler(message, new Error(`Validation failed: ${validationResult.error}`), metadata);
                  // Increment poison message counter when handler is called
                  this.stats.poisonMessages++;
                } catch (poisonError) {
                  console.error('Error in poison message handler:', poisonError);
                  // Still increment counter even if handler fails
                  this.stats.poisonMessages++;
                }
              } else {
                // No handler but still a poison message
                this.stats.poisonMessages++;
              }
              // Continue processing the message in warn mode
            }
          }
        }
        
        // Call handler
        await handler(message, metadata, matchedPattern);
        
        // Update stats
        const processingTime = Date.now() - startTime;
        this.updateStats(message.header.type, transportName, message.header.type, processingTime);
        
        // Update subscription message count
        const subscription = this.patternSubscriptions.get(pattern);
        if (subscription) {
          subscription.messageCount++;
        }
        
      } catch (error) {
        // Handle poison messages
        if (this.config.poisonMessageHandler) {
          try {
            await this.config.poisonMessageHandler(message, error as Error, metadata);
          } catch (poisonError) {
            console.error('Error in poison message handler:', poisonError);
          }
        }
        
        this.handleError(error, pattern);
        
        if (this.config.validationMode === 'strict') {
          throw error;
        }
      }
    };
  }
}

// Factory function
export function createConsumer(config: ConsumerConfig): EventConsumer {
  return new EventConsumer(config);
}
