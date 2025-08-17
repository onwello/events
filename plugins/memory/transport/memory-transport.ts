
import { 
  AdvancedTransport, 
  MessageHandler, 
  PatternHandler, 
  SubscribeOptions, 
  PublishOptions,
  EventEnvelope,
  TransportCapabilities,
  MessageMetadata
} from '../../../event-transport/transport.interface';

interface MemoryMessage {
  id: string;
  topic: string;
  envelope: EventEnvelope; // Store the EventEnvelope directly
  timestamp: number;
  headers: Record<string, string>;
  partition?: number;
}

interface TopicSubscription {
  topic: string;
  handler: MessageHandler;
  options?: SubscribeOptions;
}

interface PatternSubscription {
  pattern: RegExp;
  handler: PatternHandler;
  options?: SubscribeOptions;
  originalPattern: string; // Store the original pattern string
}

export class MemoryTransport implements AdvancedTransport {
  readonly name = 'memory';
  readonly capabilities: TransportCapabilities;
  private topics: Map<string, MemoryMessage[]> = new Map();
  private subscriptions: Map<string, TopicSubscription[]> = new Map();
  private patternSubscriptions: PatternSubscription[] = [];
  private running: boolean = false;
  private messageIdCounter: number = 0;
  private originPrefix?: string; // Add origin prefix configuration
  
  constructor(config?: { originPrefix?: string }) {
    this.running = true;
    this.originPrefix = config?.originPrefix;
    this.capabilities = {
      // Core capabilities
      supportsPublishing: true,
      supportsSubscription: true,
      supportsBatching: false,
      supportsPartitioning: false,
      supportsOrdering: true,
      supportsPatternRouting: true,
      supportsConsumerGroups: false,
      supportsDeadLetterQueues: false,
      supportsMessageRetention: false,
      supportsMessageCompression: false,
      
      // Performance characteristics
      maxMessageSize: 100 * 1024 * 1024, // 100MB reasonable limit
      maxBatchSize: 1, // No batching support
      maxTopics: 1000,
      maxPartitions: 1,
      maxConsumerGroups: 0,
      
      // Reliability features
      supportsPersistence: false,
      supportsReplication: false,
      supportsFailover: false,
      supportsTransactions: false,
      
      // Monitoring and observability
      supportsMetrics: false,
      supportsTracing: false,
      supportsHealthChecks: false
    };
  }
  
  // Transport interface implementation
  async publish(topic: string, message: any, options?: PublishOptions): Promise<void> {
    if (!this.running) {
      throw new Error('Transport is not running');
    }
    
    const messageId = `msg_${++this.messageIdCounter}`;
    
    // Check if message is an EventEnvelope
    let eventEnvelope: EventEnvelope;
    
    if (message && typeof message === 'object' && 'header' in message && 'body' in message) {
      // This is an EventEnvelope
      eventEnvelope = message;
    } else {
      // This is just data, wrap it in an envelope
      eventEnvelope = {
        header: {
          id: messageId,
          type: topic, // Assuming topic is the type
          origin: 'memory-transport',
          timestamp: new Date().toISOString(),
          hash: '', // Will be set by the transport
          version: '1.0.0'
        },
        body: message
      };
    }
    
    const memoryMessage: MemoryMessage = {
      id: messageId,
      topic,
      envelope: eventEnvelope,
      timestamp: Date.now(),
      headers: {
        ...options?.headers,
        ...(options?.correlationId && { correlationId: options.correlationId }),
        ...(options?.traceId && { traceId: options.traceId })
      },
      partition: options?.partition
    };
    
    // Store message in topic
    if (!this.topics.has(topic)) {
      this.topics.set(topic, []);
    }
    this.topics.get(topic)!.push(memoryMessage);
    
    // Notify subscribers
    await this.notifySubscribers(topic, memoryMessage);
  }
  
  async subscribe(topic: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void> {
    const subscription: TopicSubscription = {
      topic,
      handler,
      options
    };
    
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
    }
    this.subscriptions.get(topic)!.push(subscription);
    
    // Process existing messages if autoOffsetReset is 'earliest'
    if (options?.autoOffsetReset === 'earliest') {
      const messages = this.topics.get(topic) || [];
      for (const message of messages) {
        await this.processMessage(message, handler);
      }
    }
  }
  
  async subscribePattern(pattern: string, handler: PatternHandler, options?: SubscribeOptions): Promise<void> {
    if (!this.running) {
      throw new Error('Transport is not running');
    }
    
    // Validate the pattern format
    this.validatePattern(pattern);
    
    // Store the original pattern string and create a regex for matching
    // The pattern should already be validated by the router
    let regex: RegExp;
    try {
      // Convert pattern to regex: *.user.* -> ^.*\.user\..*$
      let regexPattern = pattern;
      regexPattern = regexPattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
      regexPattern = `^${regexPattern}$`;
      regex = new RegExp(regexPattern);
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${pattern}`);
    }
    
    const subscription: PatternSubscription = { 
      pattern: regex, 
      handler, 
      options,
      originalPattern: pattern // Store the original pattern string
    };
    this.patternSubscriptions.push(subscription);
    
    // Pattern subscription added successfully
  }
  
  // Pattern validation method
  private validatePattern(pattern: string): void {
    // Only allow alphanumeric characters, dots, and asterisks
    const patternRegex = /^[a-zA-Z0-9.*]+$/;
    if (!patternRegex.test(pattern)) {
      throw new Error(`Invalid pattern '${pattern}': Only alphanumeric characters, dots (.), and asterisks (*) are allowed.`);
    }
    
    // Cannot start or end with a dot
    if (pattern.startsWith('.') || pattern.endsWith('.')) {
      throw new Error(`Invalid pattern '${pattern}': Cannot start or end with a dot.`);
    }
    
    // Cannot have consecutive dots
    if (pattern.includes('..')) {
      throw new Error(`Invalid pattern '${pattern}': Cannot have consecutive dots.`);
    }
    
    // Cannot have consecutive asterisks
    if (pattern.includes('**')) {
      throw new Error(`Invalid pattern '${pattern}': Cannot have consecutive asterisks.`);
    }
  }

  async unsubscribePattern(pattern: string): Promise<void> {
    // Remove pattern subscription by matching the original pattern string
    this.patternSubscriptions = this.patternSubscriptions.filter(sub => sub.originalPattern !== pattern);
  }

  // EventPublisher compatibility
  async dispatchEvent(packet: { pattern: string; data: any }, options?: { stream?: string }): Promise<any> {
    if (!this.running) {
      throw new Error('Transport is not running');
    }
    
    await this.publish(packet.pattern, packet.data);
    return undefined;
  }
  
  async connect(): Promise<void> {
    this.running = true;
  }
  
  async disconnect(): Promise<void> {
    this.running = false;
  }
  
  isConnected(): boolean {
    return this.running;
  }
  
  async unsubscribe(topic: string, handler?: MessageHandler): Promise<void> {
    if (handler) {
      // Remove specific handler from topic
      const subscriptions = this.subscriptions.get(topic);
      if (subscriptions) {
        const filteredSubscriptions = subscriptions.filter(sub => sub.handler !== handler);
        if (filteredSubscriptions.length === 0) {
          this.subscriptions.delete(topic);
        } else {
          this.subscriptions.set(topic, filteredSubscriptions);
        }
      }
    } else {
      // Remove all subscriptions for the topic
      this.subscriptions.delete(topic);
    }
  }
  
  async close(): Promise<void> {
    this.running = false;
    this.subscriptions.clear();
    this.patternSubscriptions = [];
    this.topics.clear();
  }
  
  async getStatus(): Promise<any> {
    return {
      connected: this.running,
      healthy: this.running,
      uptime: Date.now(),
      version: '1.0.0'
    };
  }
  
  async getMetrics(): Promise<any> {
    return {
      messagesPublished: this.messageIdCounter,
      messagesReceived: 0,
      publishLatency: 0,
      receiveLatency: 0,
      errorRate: 0,
      throughput: 0,
      memoryUsage: 0,
      cpuUsage: 0
    };
  }
  
  // Private helper methods
  private async notifySubscribers(topic: string, message: MemoryMessage): Promise<void> {
    // Notify direct topic subscribers
    const subscriptions = this.subscriptions.get(topic) || [];
    for (const subscription of subscriptions) {
      await this.processMessage(message, subscription.handler);
    }
    
    // Notify pattern subscribers
    for (const patternSubscription of this.patternSubscriptions) {
      // Use the same pattern matching logic as the router
      const matches = this.matchesPattern(message.envelope.header.type, patternSubscription.originalPattern);
      if (matches) {
        await this.processPatternMessage(message, patternSubscription.handler, patternSubscription.originalPattern);
      }
    }
  }

  // Pattern matching logic (same as router)
  private matchesPattern(eventType: string, pattern: string): boolean {
    // Convert pattern to regex using the same logic as the router
    const regexPattern = this.patternToRegex(pattern);
    const regex = new RegExp(regexPattern);
    return regex.test(eventType.toLowerCase());
  }

  private patternToRegex(pattern: string): string {
    // Handle special cases for origin prefix patterns
    if (pattern.startsWith('*.')) {
      // Pattern like *.user.* or *.user - matches any origin prefix
      const withoutLeadingStar = pattern.substring(2); // Remove "*. "
      let regexPattern = withoutLeadingStar.replace(/\./g, '\\.').replace(/\*/g, '.*');
      
      // Add optional prefix and make the pattern flexible
      if (pattern.endsWith('.*')) {
        // Pattern like *.user.* - should match user.anything or prefix.user.anything or prefix.user
        const basePattern = withoutLeadingStar.replace(/\.\*$/, ''); // Remove trailing .*
        regexPattern = `^(.*\\.)?${basePattern}(\\.(.*))?$`;
      } else {
        // Pattern like *.user
        regexPattern = `^(.*\\.)?${regexPattern}$`;
      }
      
      return regexPattern;
    } else if (pattern.includes('.*')) {
      // Pattern like user.* - this should match user.anything with origin prefix respect
      const parts = pattern.split('.*');
      if (parts.length === 2 && parts[1] === '') {
        // Pattern ends with .* (e.g., 'user.*')
        const namespace = parts[0];
        
        if (this.originPrefix) {
          // With origin prefix, only match events with the same origin prefix
          return `^${this.originPrefix}\\.${namespace}\\.(.*)$`;
        } else {
          // Without origin prefix, match any user.* pattern
          return `^(.*\\.)?${namespace}\\.(.*)$`;
        }
      }
      
      // Fallback for other patterns
      let regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
      regexPattern = `^${regexPattern}$`;
      return regexPattern;
    } else {
      // Exact match pattern
      if (this.originPrefix) {
        // With origin prefix, match exact pattern with origin prefix
        return `^${this.originPrefix}\\.${pattern}$`;
      } else {
        // Without origin prefix, exact match
        let regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
        regexPattern = `^${regexPattern}$`;
        return regexPattern;
      }
    }
  }

  private async processMessage(message: MemoryMessage, handler: MessageHandler): Promise<void> {
    try {
      const metadata: MessageMetadata = {
        topic: message.topic,
        partition: message.partition,
        offset: message.id,
        timestamp: message.timestamp,
        headers: message.headers
      };
      
      const eventEnvelope: EventEnvelope = message.envelope;
      
      await handler(eventEnvelope, metadata);
    } catch (error) {
      console.error('Error processing message:', error);
    }
  }

  private async processPatternMessage(message: MemoryMessage, handler: PatternHandler, matchedPattern: string): Promise<void> {
    try {
      const metadata: MessageMetadata = {
        topic: message.topic,
        partition: message.partition,
        offset: message.id,
        timestamp: message.timestamp,
        headers: message.headers,
        matchedPattern
      };
      
      const eventEnvelope: EventEnvelope = message.envelope;
      
      await handler(eventEnvelope, metadata, matchedPattern);
    } catch (error) {
      console.error('Error processing pattern message:', error);
    }
  }
  
  // Additional methods for testing and debugging
  getTopics(): string[] {
    return Array.from(this.topics.keys());
  }
  
  getMessages(topic: string): MemoryMessage[] {
    return this.topics.get(topic) || [];
  }
  
  clearTopic(topic: string): void {
    this.topics.delete(topic);
  }
  
  clearAll(): void {
    this.topics.clear();
  }
  
  getSubscriptionCount(): number {
    let count = 0;
    for (const subscriptions of this.subscriptions.values()) {
      count += subscriptions.length;
    }
    return count + this.patternSubscriptions.length;
  }
}
