import { MessageBroker, createMessageBroker } from '../event-transport/transport-factory';
import { TransportConfig } from '../event-transport/transport.interface';
import { EventEnvelope, createEventEnvelope } from '../event-types';

export interface EnhancedPublisherConfig {
  transport: TransportConfig;
  defaultTopic?: string;
  topicPrefix?: string;
  enablePatternRouting?: boolean;
  autoCreateTopics?: boolean;
  partitionKeyExtractor?: (event: any) => string;
}

export class EnhancedEventPublisher {
  private broker: MessageBroker;
  private config: EnhancedPublisherConfig;
  
  constructor(config: EnhancedPublisherConfig) {
    this.config = config;
    this.broker = createMessageBroker(config.transport);
  }
  
  // Publish event to a specific topic
  async publish(topic: string, event: any, options?: {
    partitionKey?: string;
    headers?: Record<string, string>;
    partition?: number;
  }): Promise<void> {
    const envelope = createEventEnvelope(topic, 'enhanced-publisher', event);
    
    await this.broker.publish(topic, envelope, {
      partitionKey: options?.partitionKey || this.config.partitionKeyExtractor?.(event),
      headers: {
        ...envelope.header,
        ...options?.headers
      },
      partition: options?.partition
    });
  }
  
  // Publish event with automatic topic derivation
  async publishEvent(event: any, options?: {
    topic?: string;
    partitionKey?: string;
    headers?: Record<string, string>;
  }): Promise<void> {
    const topic = options?.topic || this.deriveTopicFromEvent(event);
    await this.publish(topic, event, options);
  }
  
  // Publish to multiple topics
  async publishToTopics(topics: string[], event: any, options?: {
    partitionKey?: string;
    headers?: Record<string, string>;
  }): Promise<void> {
    const promises = topics.map(topic => this.publish(topic, event, options));
    await Promise.all(promises);
  }
  
  // Publish with pattern-based routing
  async publishWithPattern(pattern: string, event: any, options?: {
    partitionKey?: string;
    headers?: Record<string, string>;
  }): Promise<void> {
    if (!this.config.enablePatternRouting) {
      throw new Error('Pattern routing is not enabled');
    }
    
    const envelope = createEventEnvelope(pattern, 'enhanced-publisher', event);
    await this.broker.publish(pattern, envelope, {
      partitionKey: options?.partitionKey || this.config.partitionKeyExtractor?.(event),
      headers: {
        ...envelope.header,
        ...options?.headers
      }
    });
  }
  
  // NestJS microservices compatibility
  emit(pattern: string, data: any) {
    return this.broker.emit(pattern, data);
  }
  
  send(pattern: string, data: any) {
    return this.broker.send(pattern, data);
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
  
  // Helper methods
  private deriveTopicFromEvent(event: any): string {
    if (typeof event === 'object' && event.type) {
      return event.type;
    }
    
    if (typeof event === 'string') {
      return event;
    }
    
    // Try to extract topic from event structure
    if (event && typeof event === 'object') {
      // Look for common topic fields
      const topicFields = ['topic', 'channel', 'stream', 'eventType'];
      for (const field of topicFields) {
        if (event[field]) {
          return event[field];
        }
      }
      
      // Use constructor name as fallback
      if (event.constructor && event.constructor.name !== 'Object') {
        return event.constructor.name.toLowerCase();
      }
    }
    
    return this.config.defaultTopic || 'default';
  }
  
  // Create topic with configuration
  async createTopic(name: string, config?: {
    partitions?: number;
    retention?: {
      maxAge: number;
      maxSize: number;
    };
    ordering?: 'strict' | 'per-partition' | 'none';
  }): Promise<void> {
    // This would be implemented in the transport layer
    // For now, we'll just ensure the broker is connected
    await this.connect();
  }
  
  // Get topic statistics
  async getTopicStats(topic: string): Promise<any> {
    // This would be implemented in the transport layer
    return {};
  }
}

// Factory function for easy creation
export function createEnhancedPublisher(config: EnhancedPublisherConfig): EnhancedEventPublisher {
  return new EnhancedEventPublisher(config);
}
