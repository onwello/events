import { Transport, TransportCapabilities, EventEnvelope, PublishOptions, BatchOptions } from '../event-transport/transport.interface';
import { EventRouter, RoutingConfig } from '../event-routing';
import { EventValidator, createEventEnvelope, ValidationResult } from '../event-types';

// Publisher configuration interface
export interface PublisherConfig {
  transports: Map<string, Transport>;
  router: EventRouter;
  validator: EventValidator;
  originServiceName: string;
  originPrefix?: string;
  
  // Batching configuration
  batching?: {
    enabled: boolean;
    maxSize: number;
    maxWaitMs: number;
    maxConcurrentBatches: number;
    strategy: 'time' | 'size' | 'partition';
    compression?: boolean;
  };
  
  // Retry configuration
  retry?: {
    maxRetries: number;
    backoffStrategy: 'fixed' | 'exponential' | 'fibonacci';
    baseDelay: number;
    maxDelay: number;
  };
  
  // Rate limiting configuration
  rateLimiting?: {
    maxRequests: number;
    timeWindow: number;
    strategy: 'sliding-window' | 'token-bucket';
  };
  
  // Validation mode
  validationMode?: 'strict' | 'warn' | 'ignore';
};

export interface PublisherStats {
  totalMessagesSent: number;
  totalMessagesSentByType: Record<string, number>;
  totalMessagesSentByTransport: Record<string, number>;
  totalBatchesSent: number;
  failedMessages: number;
  averageLatency: number;
  lastError?: string;
  lastErrorTime?: string;
}

// Batch queue implementation
class BatchQueue {
  private messages: Array<{ eventType: string; body: any }> = [];
  private flushTimeout?: NodeJS.Timeout;
  private isFlushing = false;
  
  constructor(
    private config: NonNullable<PublisherConfig['batching']>,
    private onFlush: (messages: Array<{ eventType: string; body: any }>) => Promise<void>
  ) {}
  
  async addMessage(eventType: string, body: any): Promise<void> {
    this.messages.push({ eventType, body });
    
    if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flush(), this.config.maxWaitMs);
    }
    
    if (this.messages.length >= this.config.maxSize) {
      await this.flush();
    }
  }
  
  async flush(): Promise<void> {
    if (this.isFlushing || this.messages.length === 0) return;
    
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = undefined;
    }
    
    this.isFlushing = true;
    
    try {
      const messagesToSend = [...this.messages];
      this.messages = [];
      await this.onFlush(messagesToSend);
    } finally {
      this.isFlushing = false;
    }
  }
  
  async forceFlush(): Promise<void> {
    if (this.messages.length > 0) {
      await this.flush();
    }
  }
  
  cleanup(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = undefined;
    }
  }
}

export class EventPublisher {
  private transports: Map<string, Transport>;
  private router: EventRouter;
  private validator: EventValidator;
  private config: PublisherConfig;
  private batchQueue?: BatchQueue;
  private stats: PublisherStats = {
    totalMessagesSent: 0,
    totalMessagesSentByType: {},
    totalMessagesSentByTransport: {},
    totalBatchesSent: 0,
    failedMessages: 0,
    averageLatency: 0
  };
  
  constructor(config: PublisherConfig) {
    this.config = config;
    this.transports = config.transports;
    this.router = config.router;
    this.validator = config.validator;
    
    // Initialize batching if enabled
    if (config.batching?.enabled) {
      this.batchQueue = new BatchQueue(config.batching, this.flushBatch.bind(this));
    }
  }
  
  async publish<T>(eventType: string, data: T, options?: PublishOptions): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Validate event data if validation is enabled
      if (this.config.validationMode !== 'ignore') {
        const validation = this.validator.validate(eventType, data);
        if (!validation.valid && this.config.validationMode === 'strict') {
          throw new Error(`Event validation failed: ${validation.error}`);
        }
      }
      
      // Create event envelope
      const envelope = createEventEnvelope(eventType, this.config.originServiceName, data, this.config.originPrefix);
      
      // Route to appropriate transport
      const topic = this.router.resolveTopic(eventType);
      const transport = this.getTransportForEvent(eventType);
      
      // Publish to transport with retry logic if configured
      if (this.config.retry) {
        await this.publishWithRetry(topic, envelope, options);
      } else {
        await transport.publish(topic, envelope, options);
      }
      
      // Update stats
      const latency = Date.now() - startTime;
      this.updateStats(eventType, 'default', latency);
      
    } catch (error) {
      this.handleError(error, eventType);
      throw error;
    }
  }
  
  // Retry logic for publishing
  private async publishWithRetry(topic: string, envelope: EventEnvelope, options?: PublishOptions): Promise<void> {
    const maxRetries = this.config.retry?.maxRetries || 3;
    const transport = this.getTransportForEvent(envelope.header.type);
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await transport.publish(topic, envelope, options);
        return; // Success, exit retry loop
      } catch (error) {
        if (attempt === maxRetries) {
          throw error; // Final attempt failed
        }
        
        // Calculate delay for next attempt
        const delay = this.calculateBackoffDelay(attempt);
        await this.delay(delay);
      }
    }
  }
  
  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = this.config.retry?.baseDelay || 1000;
    const maxDelay = this.config.retry?.maxDelay || 30000;
    const strategy = this.config.retry?.backoffStrategy || 'exponential';
    
    let delay: number;
    switch (strategy) {
      case 'exponential':
        delay = baseDelay * Math.pow(2, attempt);
        break;
      case 'fibonacci':
        delay = baseDelay * this.fibonacci(attempt + 1);
        break;
      default: // 'fixed'
        delay = baseDelay;
    }
    
    return Math.min(delay, maxDelay);
  }
  
  private fibonacci(n: number): number {
    if (n <= 1) return n;
    return this.fibonacci(n - 1) + this.fibonacci(n - 2);
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async publishBatch<T>(eventType: string, data: T[], options?: PublishOptions & BatchOptions): Promise<void> {
    if (!this.batchQueue) {
      // If batching is not enabled, publish individually
      for (const item of data) {
        await this.publish(eventType, item, options);
      }
      return;
    }
    
    // Add messages to batch queue
    for (const item of data) {
      await this.batchQueue.addMessage(eventType, item);
    }
  }
  
  async forceFlush(): Promise<void> {
    if (this.batchQueue) {
      await this.batchQueue.forceFlush();
    }
  }
  
  async connect(): Promise<void> {
    // Connect to all transports
    for (const transport of this.transports.values()) {
      await transport.connect();
    }
  }
  
  async close(): Promise<void> {
    // Flush any remaining batches
    if (this.batchQueue) {
      await this.batchQueue.forceFlush();
      this.batchQueue.cleanup();
    }
    
    // Close all transports
    for (const transport of this.transports.values()) {
      await transport.close();
    }
  }
  
  getStats(): PublisherStats {
    return { ...this.stats };
  }
  
  private async flushBatch(messages: Array<{ eventType: string; body: any }>): Promise<void> {
    if (messages.length === 0) return;
    
    try {
      // Group messages by event type
      const messagesByType = new Map<string, any[]>();
      for (const message of messages) {
        if (!messagesByType.has(message.eventType)) {
          messagesByType.set(message.eventType, []);
        }
        messagesByType.get(message.eventType)!.push(message.body);
      }
      
      // Publish each group as a batch
      for (const [eventType, bodies] of messagesByType) {
        const topic = this.router.resolveTopic(eventType);
        const transport = this.getTransportForEvent(eventType);
        
        // Create envelopes for the batch
        const envelopes = bodies.map(body => 
          createEventEnvelope(eventType, this.config.originServiceName, body, this.config.originPrefix)
        );
        
        // Check if transport supports batching
        if (this.isAdvancedTransport(transport) && transport.publishBatch) {
          await transport.publishBatch(topic, envelopes, this.config.batching);
        } else {
          // Fallback to individual publishing
          for (const envelope of envelopes) {
            await transport.publish(topic, envelope);
          }
        }
        
        // Update stats
        this.updateStats(eventType, 'default', 0);
        this.stats.totalBatchesSent++;
      }
      
    } catch (error) {
      this.handleError(error, 'batch');
      throw error;
    }
  }
  
  private getTransportForEvent(eventType: string): Transport {
    // For now, use the first available transport
    // In the future, this could be enhanced with more sophisticated routing
    const transport = this.transports.values().next().value;
    if (!transport) {
      throw new Error('No transport available');
    }
    return transport;
  }
  
  private isAdvancedTransport(transport: Transport): transport is Transport & { publishBatch?: Function } {
    return 'publishBatch' in transport;
  }
  
  private updateStats(eventType: string, transport: string, latency: number): void {
    this.stats.totalMessagesSent++;
    this.stats.totalMessagesSentByType[eventType] = (this.stats.totalMessagesSentByType[eventType] || 0) + 1;
    this.stats.totalMessagesSentByTransport[transport] = (this.stats.totalMessagesSentByTransport[transport] || 0) + 1;
    
    // Update average latency
    const totalLatency = this.stats.averageLatency * (this.stats.totalMessagesSent - 1) + latency;
    this.stats.averageLatency = totalLatency / this.stats.totalMessagesSent;
  }
  
  private handleError(error: any, eventType: string): void {
    this.stats.failedMessages++;
    this.stats.lastError = error.message;
    this.stats.lastErrorTime = new Date().toISOString();
    
    if (this.config.validationMode === 'strict') {
      console.error(`Failed to publish event ${eventType}:`, error);
    }
  }
}

// Factory function
export function createPublisher(config: PublisherConfig): EventPublisher {
  return new EventPublisher(config);
}
