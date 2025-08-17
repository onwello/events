import { EventPublisher, createPublisher } from './event-publisher';
import { EventConsumer, createConsumer } from './event-consumer';
import { TransportFactory, createTransportFactory } from './event-transport';
import { TransportFactoryConfig } from './event-transport/factory';
import { EventRouter, createEventRouter, RoutingConfig, createBasicRoutingConfig } from './event-routing';
import { EventValidator, createEventValidator, DefaultEventValidator } from './event-types';
import { Transport, TransportCapabilities } from './event-transport/transport.interface';

// Consolidated configuration interface
export interface EventSystemConfig {
  service: string;
  transports: Map<string, Transport>;
  routing?: RoutingConfig;
  
  // Publisher configuration
  publisher?: {
    batching?: {
      enabled: boolean;
      maxSize: number;
      maxWaitMs: number;
      maxConcurrentBatches: number;
      strategy: 'time' | 'size' | 'partition';
      compression?: boolean;
    };
    retry?: {
      maxRetries: number;
      backoffStrategy: 'fixed' | 'exponential' | 'fibonacci';
      baseDelay: number;
      maxDelay: number;
    };
    rateLimiting?: {
      maxRequests: number;
      timeWindow: number;
      strategy: 'sliding-window' | 'token-bucket';
    };
    validationMode?: 'strict' | 'warn' | 'ignore';
  };
  
  // Consumer configuration
  consumer?: {
    enablePatternRouting?: boolean;
    enableConsumerGroups?: boolean;
    poisonMessageHandler?: (message: any, error: Error, metadata: any) => Promise<void>;
    validationMode?: 'strict' | 'warn' | 'ignore';
  };
  
  // Global configuration
  validationMode?: 'strict' | 'warn' | 'ignore';
  originPrefix?: string;
  origins?: string[];
}

// Legacy type aliases for backward compatibility
export type PublisherConfig = NonNullable<EventSystemConfig['publisher']>;
export type ConsumerConfig = NonNullable<EventSystemConfig['consumer']>;

export interface EventSystem {
  readonly publisher: EventPublisher;
  readonly consumer: EventConsumer;
  readonly transports: Map<string, Transport>;
  readonly router: EventRouter;
  readonly validator: EventValidator;
  
  connect(): Promise<void>;
  close(): Promise<void>;
  isConnected(): boolean;
  getStatus(): Promise<EventSystemStatus>;
}

export interface EventSystemStatus {
  connected: boolean;
  healthy: boolean;
  transports: Map<string, TransportStatus>;
  publisher: PublisherStatus;
  consumer: ConsumerStatus;
  uptime: number;
  version: string;
}

export interface PublisherStatus {
  totalMessagesSent: number;
  totalBatchesSent: number;
  failedMessages: number;
  averageLatency: number;
  lastError?: string;
  lastErrorTime?: string;
}

export interface ConsumerStatus {
  totalMessagesReceived: number;
  failedMessages: number;
  poisonMessages: number;
  averageProcessingTime: number;
  lastError?: string;
  lastErrorTime?: string;
}

export interface TransportStatus {
  connected: boolean;
  healthy: boolean;
  lastError?: string;
  lastErrorTime?: string;
  uptime: number;
  version: string;
}

export class EventSystemBuilder {
  private config: Partial<EventSystemConfig> = {};
  private transports: Map<string, Transport> = new Map();
  private transportFactory: TransportFactory;
  
  constructor() {
    this.transportFactory = createTransportFactory();
  }
  
  service(name: string): EventSystemBuilder {
    this.config.service = name;
    return this;
  }
  
  originPrefix(prefix: string): EventSystemBuilder {
    this.config.originPrefix = prefix;
    return this;
  }
  
  origins(origins: string[]): EventSystemBuilder {
    this.config.origins = origins;
    return this;
  }
  
  addTransport(name: string, transport: Transport): EventSystemBuilder {
    this.transports.set(name, transport);
    return this;
  }
  
  addTransportFromFactory(name: string, type: string, config: any): EventSystemBuilder {
    const transport = this.transportFactory.createTransport({ type, options: config });
    this.transports.set(name, transport);
    return this;
  }
  
  routing(config: RoutingConfig): EventSystemBuilder {
    this.config.routing = config;
    return this;
  }
  
  enablePublisherBatching(config: NonNullable<EventSystemConfig['publisher']>['batching']): EventSystemBuilder {
    if (!this.config.publisher) this.config.publisher = {};
    this.config.publisher.batching = config;
    return this;
  }
  
  enablePublisherRetry(config: NonNullable<EventSystemConfig['publisher']>['retry']): EventSystemBuilder {
    if (!this.config.publisher) this.config.publisher = {};
    this.config.publisher.retry = config;
    return this;
  }
  
  enablePublisherRateLimiting(config: NonNullable<EventSystemConfig['publisher']>['rateLimiting']): EventSystemBuilder {
    if (!this.config.publisher) this.config.publisher = {};
    this.config.publisher.rateLimiting = config;
    return this;
  }
  
  enableConsumerPatternRouting(): EventSystemBuilder {
    if (!this.config.consumer) this.config.consumer = {};
    this.config.consumer.enablePatternRouting = true;
    return this;
  }
  
  enableConsumerGroups(): EventSystemBuilder {
    if (!this.config.consumer) this.config.consumer = {};
    this.config.consumer.enableConsumerGroups = true;
    return this;
  }
  
  setPoisonMessageHandler(handler: (message: any, error: Error, metadata: any) => Promise<void>): EventSystemBuilder {
    if (!this.config.consumer) this.config.consumer = {};
    this.config.consumer.poisonMessageHandler = handler;
    return this;
  }
  
  setValidationMode(mode: 'strict' | 'warn' | 'ignore'): EventSystemBuilder {
    this.config.validationMode = mode;
    return this;
  }
  
  build(): EventSystem {
    if (!this.config.service || this.config.service.trim() === '') {
      throw new Error('Service name is required');
    }
    
    if (this.transports.size === 0) {
      throw new Error('At least one transport is required');
    }
    
    // Create default routing if not provided
    if (!this.config.routing) {
      this.config.routing = createBasicRoutingConfig(
        [],
        this.config.validationMode || 'warn',
        this.config.originPrefix
      );
    }
    
    // Create validator
    const validator = createEventValidator();
    
    // Create router
    const transportCapabilities = new Map<string, TransportCapabilities>();
    for (const [name, transport] of this.transports.entries()) {
      transportCapabilities.set(name, transport.capabilities);
    }
    const router = createEventRouter(this.config.routing!, transportCapabilities);
    
    // Create publisher
    const publisher = createPublisher({
      transports: this.transports,
      router,
      validator,
      originServiceName: this.config.service,
      originPrefix: this.config.originPrefix,
      batching: this.config.publisher?.batching,
      retry: this.config.publisher?.retry,
      rateLimiting: this.config.publisher?.rateLimiting,
      validationMode: this.config.publisher?.validationMode || this.config.validationMode
    });
    
    // Create consumer
    const consumer = createConsumer({
      transports: this.transports,
      router,
      validator,
      originPrefix: this.config.originPrefix,
      origins: this.config.origins,
      enablePatternRouting: this.config.consumer?.enablePatternRouting,
      enableConsumerGroups: this.config.consumer?.enableConsumerGroups,
      poisonMessageHandler: this.config.consumer?.poisonMessageHandler,
      validationMode: this.config.consumer?.validationMode || this.config.validationMode
    });
    
    return new EventSystemImpl(
      publisher,
      consumer,
      this.transports,
      router,
      validator,
      this.config.service
    );
  }
}

class EventSystemImpl implements EventSystem {
  constructor(
    public readonly publisher: EventPublisher,
    public readonly consumer: EventConsumer,
    public readonly transports: Map<string, Transport>,
    public readonly router: EventRouter,
    public readonly validator: EventValidator,
    private serviceName: string
  ) {}
  
  async connect(): Promise<void> {
    for (const transport of this.transports.values()) {
      await transport.connect();
    }
  }
  
  async close(): Promise<void> {
    for (const transport of this.transports.values()) {
      await transport.close();
    }
  }
  
  isConnected(): boolean {
    return Array.from(this.transports.values()).every(t => t.isConnected());
  }
  
  async getStatus(): Promise<EventSystemStatus> {
    const transportStatuses = new Map<string, TransportStatus>();
    
    for (const [name, transport] of this.transports.entries()) {
      transportStatuses.set(name, await transport.getStatus());
    }
    
    return {
      connected: this.isConnected(),
      healthy: Array.from(transportStatuses.values()).every(s => s.healthy),
      transports: transportStatuses,
      publisher: await this.publisher.getStats(),
      consumer: await this.consumer.getStats(),
      uptime: Date.now() - Date.now(), // TODO: Implement proper uptime tracking
      version: '3.0.0'
    };
  }
}

// Factory functions
export function createEventSystemBuilder(): EventSystemBuilder {
  return new EventSystemBuilder();
}

export function createEventSystem(config: EventSystemConfig): EventSystem {
  const builder = createEventSystemBuilder()
    .service(config.service)
    .originPrefix(config.originPrefix || '')
    .origins(config.origins || [])
    .routing(config.routing || createBasicRoutingConfig([], config.validationMode || 'warn', config.originPrefix || ''));
  
  // Add transports
  for (const [name, transport] of config.transports.entries()) {
    builder.addTransport(name, transport);
  }
  
  // Apply publisher configuration
  if (config.publisher?.batching) {
    builder.enablePublisherBatching(config.publisher.batching);
  }
  if (config.publisher?.retry) {
    builder.enablePublisherRetry(config.publisher.retry);
  }
  if (config.publisher?.rateLimiting) {
    builder.enablePublisherRateLimiting(config.publisher.rateLimiting);
  }
  
  // Apply consumer configuration
  if (config.consumer?.enablePatternRouting) {
    builder.enableConsumerPatternRouting();
  }
  if (config.consumer?.enableConsumerGroups) {
    builder.enableConsumerGroups();
  }
  if (config.consumer?.poisonMessageHandler) {
    builder.setPoisonMessageHandler(config.consumer.poisonMessageHandler);
  }
  
  // Apply global configuration
  if (config.validationMode) {
    builder.setValidationMode(config.validationMode);
  }
  
  return builder.build();
}
