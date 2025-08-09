import { Observable } from 'rxjs';

// Transport-agnostic message handler
export type MessageHandler = (message: any, metadata: MessageMetadata) => Promise<void>;

export interface MessageMetadata {
  topic: string;
  partition?: number;
  offset: string;
  timestamp: number;
  headers?: Record<string, string>;
  matchedPattern?: string; // For pattern-based routing
}

// Abstract transport interface
export interface Transport {
  name: string;
  
  // Core transport methods
  publish(topic: string, message: any, options?: PublishOptions): Promise<void>;
  subscribe(topic: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void>;
  
  // NestJS microservices compatibility
  emit(pattern: string, data: any): Observable<any>;
  send(pattern: string, data: any): Observable<any>;
  
  // Pattern-based routing
  subscribePattern(pattern: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void>;
  
  // Lifecycle
  connect(): Promise<void>;
  close(): Promise<void>;
  
  // Transport-specific capabilities
  getCapabilities(): TransportCapabilities;
}

export interface PublishOptions {
  partitionKey?: string;
  partition?: number;
  headers?: Record<string, string>;
}

export interface SubscribeOptions {
  groupId?: string;
  consumerId?: string;
  autoOffsetReset?: 'earliest' | 'latest' | 'specific';
  enableAutoCommit?: boolean;
  autoCommitInterval?: number;
}

export interface TransportCapabilities {
  supportsPartitioning: boolean;
  supportsOrdering: boolean;
  supportsDeadLetterQueues: boolean;
  supportsConsumerGroups: boolean;
  supportsPatternRouting: boolean;
  maxMessageSize: number;
  maxTopics: number;
}

// Transport factory interface
export interface TransportFactory {
  createTransport(config: TransportConfig): Transport;
}

export interface TransportConfig {
  type: 'redis' | 'kafka' | 'rabbitmq';
  options: any;
}

// Unified message broker interface
export interface MessageBroker {
  // NestJS microservices compatible
  emit(pattern: string, data: any): Observable<any>;
  send(pattern: string, data: any): Observable<any>;
  
  // Message broker specific
  publish(topic: string, message: any, options?: PublishOptions): Promise<void>;
  subscribe(topic: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void>;
  
  // Lifecycle
  connect(): Promise<void>;
  close(): Promise<void>;
  
  // Pattern-based routing
  subscribePattern(pattern: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void>;
}
