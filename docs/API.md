# API Reference

## Overview

This document provides a comprehensive reference for all public APIs in the `@logistically/events` library. The library provides a production-ready event-driven architecture with support for multiple transport backends, advanced routing, and enterprise features.

## Quick Start

```typescript
import { createEventSystemBuilder, RedisStreamsPlugin, MemoryTransportPlugin } from '@logistically/events';

// Create an event system with Redis transport
const eventSystem = createEventSystemBuilder()
  .service('user-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    consumerGroup: 'user-service-group',
    batchSize: 100
  })
  .enablePublisherBatching({
    enabled: true,
    maxSize: 1000,
    maxWaitMs: 100,
    maxConcurrentBatches: 5,
    strategy: 'size'
  })
  .enableConsumerPatternRouting()
  .build();

// Connect and start using
await eventSystem.connect();

// Publish events
await eventSystem.publisher.publish('user.created', { userId: '123', email: 'user@example.com' });

// Subscribe to events
await eventSystem.consumer.subscribe('user.created', async (message, metadata) => {
  console.log('User created:', message.body);
});

// Subscribe to patterns
await eventSystem.consumer.subscribePattern('user.*', async (message, metadata, pattern) => {
  console.log('User event:', message.body, 'Pattern:', pattern);
});
```

## Core Exports

### Event System Builder

```typescript
import { createEventSystemBuilder, createEventSystem } from '@logistically/events';
```

**Factory Functions:**
- `createEventSystemBuilder()`: Creates a new EventSystemBuilder instance with fluent API
- `createEventSystem(config)`: Creates an EventSystem directly from configuration

### Event Router

```typescript
import { createEventRouter, createBasicRoutingConfig, defaultRoutingConfig } from '@logistically/events';
```

**Factory Functions:**
- `createEventRouter(config, transportCapabilities)`: Creates a new EventRouter instance
- `createBasicRoutingConfig(...)`: Creates a basic routing configuration
- `defaultRoutingConfig`: Default routing configuration object

### Core Types

```typescript
import { 
  EventSystemConfig, 
  EventRoute, 
  RoutingConfig,
  Transport,
  TransportCapabilities,
  EventEnvelope,
  MessageHandler,
  PatternHandler
} from '@logistically/events';
```

### Plugin Exports

```typescript
import { RedisStreamsPlugin, MemoryTransportPlugin } from '@logistically/events';
```

## EventSystemBuilder API

### Constructor

```typescript
class EventSystemBuilder {
  constructor();
}
```

### Configuration Methods

#### `service(name: string): EventSystemBuilder`

Sets the service name for the event system.

```typescript
const builder = createEventSystemBuilder()
  .service('user-service');
```

**Parameters:**
- `name`: Required service name (string)

**Returns:** EventSystemBuilder instance for chaining

**Throws:** Error if service name is empty or whitespace

#### `addTransport(name: string, transport: Transport): EventSystemBuilder`

Adds a transport instance to the system.

```typescript
const builder = createEventSystemBuilder()
  .service('my-service')
  .addTransport('redis', redisTransport)
  .addTransport('memory', memoryTransport);
```

**Parameters:**
- `name`: Transport identifier (string)
- `transport`: Transport instance implementing Transport interface

**Returns:** EventSystemBuilder instance for chaining

**Throws:** Error if transport name is empty or duplicate

#### `addTransportFromFactory(name: string, type: string, config: any): EventSystemBuilder`

Creates and adds a transport using the transport factory.

```typescript
const builder = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    consumerGroup: 'my-group',
    batchSize: 100
  });
```

**Parameters:**
- `name`: Transport identifier (string)
- `type`: Transport type (e.g., 'redis-streams', 'memory')
- `config`: Transport-specific configuration

**Returns:** EventSystemBuilder instance for chaining

#### `originPrefix(prefix: string): EventSystemBuilder`

Sets the origin prefix for regional isolation.

```typescript
const builder = createEventSystemBuilder()
  .service('my-service')
  .originPrefix('eu.de');
```

**Parameters:**
- `prefix`: Origin prefix (e.g., 'eu.de', 'us.ca')

**Returns:** EventSystemBuilder instance for chaining

#### `origins(origins: string[]): EventSystemBuilder`

Sets allowed origin prefixes for filtering.

```typescript
const builder = createEventSystemBuilder()
  .service('my-service')
  .origins(['eu.de', 'us.ca']);
```

**Parameters:**
- `origins`: Array of allowed origin prefixes

**Returns:** EventSystemBuilder instance for chaining

#### `routing(config: RoutingConfig): EventSystemBuilder`

Sets the routing configuration.

```typescript
const routingConfig = createBasicRoutingConfig(
  [{ pattern: 'user.*', transport: 'redis' }],
  'warn',
  'eu.de'
);

const builder = createEventSystemBuilder()
  .service('my-service')
  .routing(routingConfig);
```

**Parameters:**
- `config`: Routing configuration object

**Returns:** EventSystemBuilder instance for chaining

#### `enablePublisherBatching(config: BatchingConfig): EventSystemBuilder`

Configures publisher batching behavior.

```typescript
const builder = createEventSystemBuilder()
  .service('my-service')
  .enablePublisherBatching({
    enabled: true,
    maxSize: 1000,
    maxWaitMs: 100,
    maxConcurrentBatches: 5,
    strategy: 'size'
  });
```

**Parameters:**
- `config`: Batching configuration object

**Returns:** EventSystemBuilder instance for chaining

#### `enablePublisherRetry(config: RetryConfig): EventSystemBuilder`

Configures publisher retry behavior.

```typescript
const builder = createEventSystemBuilder()
  .service('my-service')
  .enablePublisherRetry({
    maxRetries: 3,
    backoffStrategy: 'exponential',
    baseDelay: 1000,
    maxDelay: 10000
  });
```

**Parameters:**
- `config`: Retry configuration object

**Returns:** EventSystemBuilder instance for chaining

#### `enablePublisherRateLimiting(config: RateLimitingConfig): EventSystemBuilder`

Configures publisher rate limiting.

```typescript
const builder = createEventSystemBuilder()
  .service('my-service')
  .enablePublisherRateLimiting({
    maxRequests: 1000,
    timeWindow: 60000,
    strategy: 'sliding-window'
  });
```

**Parameters:**
- `config`: Rate limiting configuration object

**Returns:** EventSystemBuilder instance for chaining

#### `enableConsumerPatternRouting(): EventSystemBuilder`

Enables consumer pattern routing.

```typescript
const builder = createEventSystemBuilder()
  .service('my-service')
  .enableConsumerPatternRouting();
```

**Returns:** EventSystemBuilder instance for chaining

#### `enableConsumerGroups(): EventSystemBuilder`

Enables consumer groups.

```typescript
const builder = createEventSystemBuilder()
  .service('my-service')
  .enableConsumerGroups();
```

**Returns:** EventSystemBuilder instance for chaining

#### `setPoisonMessageHandler(handler: PoisonMessageHandler): EventSystemBuilder`

Sets the poison message handler for failed message processing.

```typescript
const builder = createEventSystemBuilder()
  .service('my-service')
  .setPoisonMessageHandler(async (message, error, metadata) => {
    console.error('Poison message:', message, error);
    await logToMonitoringSystem(message, error);
  });
```

**Parameters:**
- `handler`: Function to handle poison messages

**Returns:** EventSystemBuilder instance for chaining

#### `setValidationMode(mode: 'strict' | 'warn' | 'ignore'): EventSystemBuilder`

Sets the validation mode for the system.

```typescript
const builder = createEventSystemBuilder()
  .service('my-service')
  .setValidationMode('strict');
```

**Parameters:**
- `mode`: Validation mode ('strict', 'warn', or 'ignore')

**Returns:** EventSystemBuilder instance for chaining

### Building Methods

#### `build(): EventSystem`

Builds and returns the configured EventSystem instance.

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379'
  })
  .build();
```

**Returns:** Configured EventSystem instance

**Throws:** Error if configuration is invalid or incomplete

## EventSystem API

### Properties

```typescript
interface EventSystem {
  readonly publisher: EventPublisher;
  readonly consumer: EventConsumer;
  readonly router: EventRouter;
  readonly validator: EventValidator;
  readonly transports: Map<string, Transport>;
}
```

### Methods

#### `connect(): Promise<void>`

Connects to all configured transports.

```typescript
await eventSystem.connect();
```

**Returns:** Promise that resolves when all transports are connected

**Throws:** Error if any transport fails to connect

#### `close(): Promise<void>`

Closes all transport connections.

```typescript
await eventSystem.close();
```

**Returns:** Promise that resolves when all transports are closed

#### `isConnected(): boolean`

Checks if the system is connected to all transports.

```typescript
if (eventSystem.isConnected()) {
  console.log('All transports connected');
}
```

**Returns:** True if all transports are connected

#### `getStatus(): Promise<EventSystemStatus>`

Gets the current system status.

```typescript
const status = await eventSystem.getStatus();
console.log('System status:', status);
```

**Returns:** Promise that resolves to EventSystemStatus object with connection and health information

## EventPublisher API

### Methods

#### `publish(eventType: string, data: any, options?: PublishOptions): Promise<void>`

Publishes a single event.

```typescript
await eventSystem.publisher.publish('user.created', { userId: '123' });

// With options
await eventSystem.publisher.publish('order.completed', 
  { orderId: '456', total: 99.99 },
  { partition: 1, headers: { priority: 'high' } }
);
```

**Parameters:**
- `eventType`: Type of event to publish
- `data`: Event data payload
- `options`: Optional publishing options

**Returns:** Promise that resolves when event is published

**Throws:** Error if publishing fails or validation fails

#### `publishBatch(events: Array<{ eventType: string; body: any }>): Promise<void>`

Publishes multiple events in a batch.

```typescript
const events = [
  { eventType: 'user.created', body: { userId: '123' } },
  { eventType: 'user.created', body: { userId: '456' } }
];

await eventSystem.publisher.publishBatch(events);
```

**Parameters:**
- `events`: Array of events to publish

**Returns:** Promise that resolves when all events are published

**Throws:** Error if batch publishing fails

#### `getStats(): Promise<PublisherStats>`

Gets publisher statistics.

```typescript
const stats = await eventSystem.publisher.getStats();
console.log('Total published:', stats.totalMessagesSent);
console.log('Failed publishes:', stats.failedMessages);
console.log('Batch count:', stats.totalBatchesSent);
```

**Returns:** Promise that resolves to PublisherStats object with performance metrics

## EventConsumer API

### Methods

#### `subscribe(eventType: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void>`

Subscribes to events of a specific type.

```typescript
await eventSystem.consumer.subscribe('user.created', async (message, metadata) => {
  console.log('User created:', message.body);
});

// With options
await eventSystem.consumer.subscribe('order.*', async (message, metadata) => {
  console.log('Order event:', message.body);
}, {
  groupId: 'order-processors',
  partition: 1
});
```

**Parameters:**
- `eventType`: Event type to subscribe to
- `handler`: Function to handle received messages
- `options`: Optional subscription options

**Returns:** Promise that resolves when subscription is created

**Throws:** Error if subscription fails

#### `subscribePattern(pattern: string, handler: PatternHandler, options?: SubscribeOptions): Promise<void>`

Subscribes to events matching a pattern.

```typescript
await eventSystem.consumer.subscribePattern('user.*', async (message, metadata, pattern) => {
  console.log('User event:', message.body, 'Pattern:', pattern);
});
```

**Parameters:**
- `pattern`: Pattern to match events against
- `handler`: Function to handle matched messages
- `options`: Optional subscription options

**Returns:** Promise that resolves when pattern subscription is created

**Throws:** Error if subscription fails or pattern routing is disabled

#### `unsubscribe(eventType: string): Promise<void>`

Unsubscribes from events of a specific type.

```typescript
await eventSystem.consumer.unsubscribe('user.created');
```

**Parameters:**
- `eventType`: Event type to unsubscribe from

**Returns:** Promise that resolves when unsubscription is complete

#### `unsubscribePattern(pattern: string): Promise<void>`

Unsubscribes from a pattern subscription.

```typescript
await eventSystem.consumer.unsubscribePattern('user.*');
```

**Parameters:**
- `pattern`: Pattern to unsubscribe from

**Returns:** Promise that resolves when unsubscription is complete

#### `getSubscriptions(): SubscriptionInfo[]`

Gets information about all active subscriptions.

```typescript
const subscriptions = eventSystem.consumer.getSubscriptions();
subscriptions.forEach(sub => {
  console.log('Subscription:', sub.eventType, 'Messages:', sub.messageCount);
});
```

**Returns:** Array of subscription information objects

#### `getStats(): Promise<ConsumerStats>`

Gets consumer statistics.

```typescript
const stats = await eventSystem.consumer.getStats();
console.log('Total messages:', stats.totalMessagesReceived);
console.log('Failed messages:', stats.failedMessages);
console.log('Poison messages:', stats.poisonMessages);
console.log('Average processing time:', stats.averageProcessingTime);
```

**Returns:** Promise that resolves to ConsumerStats object with processing metrics

## EventRouter API

### Methods

#### `matchesPattern(eventType: string, pattern: string): boolean`

Checks if an event type matches a pattern.

```typescript
const matches = router.matchesPattern('user.created', 'user.*');
console.log('Matches:', matches); // true

const matchesExact = router.matchesPattern('user.created', 'user.created');
console.log('Exact match:', matchesExact); // true
```

**Parameters:**
- `eventType`: Event type to check
- `pattern`: Pattern to match against

**Returns:** True if event type matches pattern

#### `resolveTopic(eventType: string): string`

Resolves the topic for an event type.

```typescript
const topic = router.resolveTopic('user.created');
console.log('Topic:', topic); // 'user-events'
```

**Parameters:**
- `eventType`: Event type to resolve topic for

**Returns:** Resolved topic name

#### `validateEventType(eventType: string): boolean`

Validates an event type format.

```typescript
const isValid = router.validateEventType('user.created');
console.log('Valid:', isValid); // true

const isInvalid = router.validateEventType('user-created');
console.log('Valid:', isInvalid); // false
```

**Parameters:**
- `eventType`: Event type to validate

**Returns:** True if event type format is valid

#### `validateAndNormalizePattern(pattern: string): string`

Validates and normalizes a pattern string.

```typescript
try {
  const normalized = router.validateAndNormalizePattern('USER.*');
  console.log('Normalized:', normalized); // 'user.*'
} catch (error) {
  console.error('Invalid pattern:', error.message);
}
```

**Parameters:**
- `pattern`: Pattern to validate and normalize

**Returns:** Normalized pattern string

**Throws:** Error if pattern is invalid

#### `validateTransportFeatures(transportName: string, requiredFeatures: string[]): RoutingValidationResult`

Validates transport capabilities against required features.

```typescript
const result = router.validateTransportFeatures('redis', ['patternRouting', 'batching']);
if (result.valid) {
  console.log('Transport supports all required features');
} else {
  console.log('Unsupported features:', result.unsupportedFeatures);
}
```

**Parameters:**
- `transportName`: Name of transport to validate
- `requiredFeatures`: Array of required feature names

**Returns:** RoutingValidationResult with validation details

## Transport Plugins

### Redis Streams Plugin

The Redis Streams plugin provides enterprise-grade Redis-based event streaming with advanced features.

```typescript
import { RedisStreamsPlugin } from '@logistically/events';

const plugin = new RedisStreamsPlugin();
const transport = plugin.createTransport({
  url: 'redis://localhost:6379',
  consumerGroup: 'my-service-group',
  batchSize: 100,
  maxRetries: 3,
  enableDLQ: true,
  dlqStreamPrefix: 'dlq:',
  maxRetriesBeforeDLQ: 3
});
```

**Key Features:**
- **Consumer Groups**: Reliable message consumption with automatic offset management
- **Dead Letter Queues**: Automatic handling of failed messages
- **Batching**: High-performance batch publishing and consumption
- **Partitioning**: Parallel processing support
- **Message Ordering**: Strict ordering guarantees
- **Schema Validation**: Built-in message schema validation
- **Message Replay**: Historical message replay capabilities
- **Redis Cluster**: Support for Redis cluster deployments

**Configuration Options:**
```typescript
interface RedisStreamsConfig {
  // Connection
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  
  // Consumer settings
  consumerGroup: string;
  batchSize?: number;
  blockTime?: number;
  maxRetries?: number;
  retryDelay?: number;
  
  // Dead letter queue
  enableDLQ?: boolean;
  dlqStreamPrefix?: string;
  maxRetriesBeforeDLQ?: number;
  
  // Performance
  pipelineSize?: number;
  maxLen?: number;
  trimStrategy?: 'MAXLEN' | 'MINID';
}
```

### Memory Transport Plugin

The Memory Transport plugin provides an in-memory event transport for testing and development.

```typescript
import { MemoryTransportPlugin } from '@logistically/events';

const plugin = new MemoryTransportPlugin();
const transport = plugin.createTransport({
  enablePatternRouting: true,
  enableBatching: true
});
```

**Key Features:**
- **In-Memory Storage**: Fast, non-persistent event storage
- **Pattern Routing**: Support for wildcard subscriptions
- **Batching**: Batch publishing and consumption
- **Testing**: Ideal for unit tests and development

## Configuration Interfaces

### EventSystemConfig

```typescript
interface EventSystemConfig {
  service: string;
  transports: Map<string, Transport>;
  routing?: RoutingConfig;
  
  // Publisher configuration
  publisher?: {
    batching?: BatchingConfig;
    retry?: RetryConfig;
    rateLimiting?: RateLimitingConfig;
    validationMode?: 'strict' | 'warn' | 'ignore';
  };
  
  // Consumer configuration
  consumer?: {
    enablePatternRouting?: boolean;
    enableConsumerGroups?: boolean;
    poisonMessageHandler?: PoisonMessageHandler;
    validationMode?: 'strict' | 'warn' | 'ignore';
  };
  
  // Global configuration
  validationMode?: 'strict' | 'warn' | 'ignore';
  originPrefix?: string;
  origins?: string[];
}
```

### BatchingConfig

```typescript
interface BatchingConfig {
  enabled: boolean;
  maxSize: number;
  maxWaitMs: number;
  maxConcurrentBatches: number;
  strategy: 'time' | 'size' | 'partition';
  compression?: boolean;
}
```

### RetryConfig

```typescript
interface RetryConfig {
  maxRetries: number;
  backoffStrategy: 'fixed' | 'exponential' | 'fibonacci';
  baseDelay: number;
  maxDelay: number;
}
```

### RateLimitingConfig

```typescript
interface RateLimitingConfig {
  maxRequests: number;
  timeWindow: number;
  strategy: 'sliding-window' | 'token-bucket';
}
```

### RoutingConfig

```typescript
interface RoutingConfig {
  routes: EventRoute[];
  validationMode: 'strict' | 'warn' | 'ignore';
  originPrefix?: string;
  topicMapping: { [pattern: string]: string };
  defaultTopicStrategy: 'namespace' | 'custom';
  customTopicWord?: string;
  enablePatternRouting?: boolean;
  enableBatching?: boolean;
  enablePartitioning?: boolean;
  enableConsumerGroups?: boolean;
}
```

### EventRoute

```typescript
interface EventRoute {
  pattern: string;
  transport: string;
  priority?: number;
  options?: {
    topic?: string;
    partition?: number;
    ordering?: 'strict' | 'per-partition' | 'none';
    retention?: {
      maxAge?: number;
      maxSize?: number;
      maxMessages?: number;
    };
  };
}
```

## Transport Interfaces

### Transport

```typescript
interface Transport {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  
  // Core methods
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // Publishing
  publish(topic: string, message: any, options?: PublishOptions): Promise<void>;
  
  // Subscription
  subscribe(topic: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  
  // Lifecycle
  close(): Promise<void>;
  
  // Health and status
  getStatus(): Promise<TransportStatus>;
  getMetrics(): Promise<TransportMetrics>;
}
```

### AdvancedTransport

```typescript
interface AdvancedTransport extends Transport {
  // Pattern-based routing (optional)
  subscribePattern?(pattern: string, handler: PatternHandler, options?: SubscribeOptions): Promise<void>;
  unsubscribePattern?(pattern: string): Promise<void>;
  
  // Batching (optional)
  publishBatch?(topic: string, messages: any[], options?: PublishOptions & BatchOptions): Promise<void>;
  
  // Partitioning (optional)
  createPartition?(topic: string, partitionId: string, options?: any): Promise<void>;
  deletePartition?(topic: string, partitionId: string): Promise<void>;
  
  // Consumer groups (optional)
  createConsumerGroup?(topic: string, groupId: string, options?: any): Promise<void>;
  deleteConsumerGroup?(topic: string, groupId: string): Promise<void>;
  
  // Topic management (optional)
  createTopic?(name: string, options?: TopicOptions): Promise<void>;
  deleteTopic?(name: string): Promise<void>;
  getTopicInfo?(name: string): Promise<TopicInfo>;
  
  // Dead letter queues (optional)
  createDeadLetterQueue?(topic: string, options?: DeadLetterQueueOptions): Promise<void>;
  moveToDeadLetter?(topic: string, message: EventEnvelope, reason: string): Promise<void>;
}
```

### TransportCapabilities

```typescript
interface TransportCapabilities {
  // Core capabilities
  supportsPublishing: boolean;
  supportsSubscription: boolean;
  supportsBatching: boolean;
  supportsPartitioning: boolean;
  supportsOrdering: boolean;
  supportsPatternRouting: boolean;
  supportsConsumerGroups: boolean;
  supportsDeadLetterQueues: boolean;
  supportsMessageRetention: boolean;
  supportsMessageCompression: boolean;
  
  // Performance characteristics
  maxMessageSize: number;
  maxBatchSize: number;
  maxTopics: number;
  maxPartitions: number;
  maxConsumerGroups: number;
  
  // Reliability features
  supportsPersistence: boolean;
  supportsReplication: boolean;
  supportsFailover: boolean;
  supportsTransactions: boolean;
  
  // Monitoring and observability
  supportsMetrics: boolean;
  supportsTracing: boolean;
  supportsHealthChecks: boolean;
}
```

## Message Interfaces

### EventEnvelope

```typescript
interface EventEnvelope<T = any> {
  header: {
    id: string;
    type: string;
    origin: string;
    originPrefix?: string;
    timestamp: string;
    hash: string;
    version: string;
  };
  body: T;
}
```

### MessageMetadata

```typescript
interface MessageMetadata {
  topic: string;
  partition?: number;
  offset: string;
  timestamp: number;
  headers?: Record<string, string>;
  matchedPattern?: string;
  correlationId?: string;
  traceId?: string;
}
```

### MessageHandler

```typescript
type MessageHandler<T = any> = (message: EventEnvelope<T>, metadata: MessageMetadata) => Promise<void> | void;
```

### PatternHandler

```typescript
type PatternHandler<T = any> = (message: EventEnvelope<T>, metadata: MessageMetadata, matchedPattern: string) => Promise<void> | void;
```

### PoisonMessageHandler

```typescript
type PoisonMessageHandler = (message: any, error: Error, metadata: any) => Promise<void>;
```

## Statistics Interfaces

### PublisherStats

```typescript
interface PublisherStats {
  totalMessagesSent: number;
  totalMessagesSentByType: Record<string, number>;
  totalMessagesSentByTransport: Record<string, number>;
  totalBatchesSent: number;
  failedMessages: number;
  averageLatency: number;
  lastError?: string;
  lastErrorTime?: string;
}
```

### ConsumerStats

```typescript
interface ConsumerStats {
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
```

### EventSystemStatus

```typescript
interface EventSystemStatus {
  connected: boolean;
  healthy: boolean;
  transports: Map<string, TransportStatus>;
  publisher: PublisherStatus;
  consumer: ConsumerStatus;
  uptime: number;
  version: string;
}
```

### TransportStatus

```typescript
interface TransportStatus {
  connected: boolean;
  healthy: boolean;
  lastError?: string;
  lastErrorTime?: string;
  uptime: number;
  version: string;
}
```

## Utility Functions

### createBasicRoutingConfig

```typescript
function createBasicRoutingConfig(
  routes: EventRoute[],
  validationMode: 'strict' | 'warn' | 'ignore' = 'warn',
  originPrefix?: string,
  topicMapping: { [pattern: string]: string } = {},
  defaultTopicStrategy: 'namespace' | 'custom' = 'namespace',
  customTopicWord?: string
): RoutingConfig
```

Creates a basic routing configuration with sensible defaults.

```typescript
const config = createBasicRoutingConfig(
  [{ pattern: 'user.*', transport: 'redis' }],
  'warn',
  'eu.de',
  { 'user.*': 'user' },
  'namespace'
);
```

### createEventRouter

```typescript
function createEventRouter(
  config: RoutingConfig,
  transportCapabilities: Map<string, TransportCapabilities>
): EventRouter
```

Creates a new EventRouter instance with validation.

```typescript
const router = createEventRouter(routingConfig, transportCapabilities);
```

### createEventSystem

```typescript
function createEventSystem(config: EventSystemConfig): EventSystem
```

Creates an EventSystem directly from configuration.

```typescript
const eventSystem = createEventSystem({
  service: 'my-service',
  transports: new Map([['redis', redisTransport]]),
  validationMode: 'warn'
});
```

## Constants

### Default Values

```typescript
// Default routing configuration
export const defaultRoutingConfig: RoutingConfig = {
  routes: [],
  validationMode: 'warn',
  topicMapping: {},
  defaultTopicStrategy: 'namespace',
  enablePatternRouting: false,
  enableBatching: false,
  enablePartitioning: false,
  enableConsumerGroups: false
};

// Default validation mode
export const DEFAULT_VALIDATION_MODE: 'strict' | 'warn' | 'ignore' = 'warn';
```

## Error Types

### ValidationError

```typescript
class ValidationError extends Error {
  constructor(message: string, details?: any);
  details?: any;
}
```

### ConfigurationError

```typescript
class ConfigurationError extends Error {
  constructor(message: string, config?: any);
  config?: any;
}
```

### TransportError

```typescript
class TransportError extends Error {
  constructor(message: string, transport?: string, cause?: Error);
  transport?: string;
  cause?: Error;
}
```

## Best Practices

### 1. Service Naming

Use descriptive service names that reflect your domain:

```typescript
// Good
.service('user-management-service')
.service('order-processing-service')

// Avoid
.service('service1')
.service('api')
```

### 2. Event Type Naming

Follow a consistent naming convention for event types:

```typescript
// Good - domain.action format
'user.created'
'order.completed'
'payment.failed'

// Avoid
'userCreated'
'order_completed'
'PAYMENT_FAILED'
```

### 3. Origin Prefix Strategy

Use origin prefixes for regional or organizational isolation:

```typescript
// Regional isolation
.originPrefix('eu.de')  // European deployment
.originPrefix('us.ca')  // US deployment

// Organizational isolation
.originPrefix('prod')   // Production environment
.originPrefix('staging') // Staging environment
```

### 4. Transport Selection

Choose transports based on your requirements:

```typescript
// High-performance, production use
.addTransportFromFactory('redis', 'redis-streams', {
  url: 'redis://redis-cluster:6379',
  consumerGroup: 'my-service-group',
  enableDLQ: true
})

// Development and testing
.addTransportFromFactory('memory', 'memory', {
  enablePatternRouting: true
})
```

### 5. Error Handling

Implement proper error handling for production systems:

```typescript
.setPoisonMessageHandler(async (message, error, metadata) => {
  // Log to monitoring system
  await logToDatadog({
    level: 'error',
    message: 'Poison message detected',
    error: error.message,
    eventType: message.header?.type,
    metadata
  });
  
  // Store in dead letter queue for investigation
  await storeInDLQ(message, error, metadata);
});
```

## Migration Guide

### From v2.x to v3.x

#### Breaking Changes

1. **EventSystemBuilder API**: Fluent API replaces configuration object
2. **Transport Registration**: Explicit transport registration required
3. **Validation Modes**: New validation modes with stricter defaults
4. **Origin Prefix**: New origin prefix system for regional isolation

#### Migration Steps

1. **Update Builder Usage**:
   ```typescript
   // Old
   const eventSystem = new EventSystem(config);
   
   // New
   const eventSystem = createEventSystemBuilder()
     .service('my-service')
     .addTransportFromFactory('redis', 'redis-streams', {
       url: 'redis://localhost:6379'
     })
     .build();
   ```

2. **Update Transport Configuration**:
   ```typescript
   // Old
   config.transports = { redis: redisTransport };
   
   // New
   .addTransport('redis', redisTransport)
   ```

3. **Update Validation**:
   ```typescript
   // Old
   config.validation = 'loose';
   
   // New
   .setValidationMode('ignore')
   ```

#### New Features

1. **Origin Prefix System**: Regional isolation support
2. **Enhanced Batching**: Multiple batching strategies
3. **Advanced Retry**: Configurable retry strategies
4. **Rate Limiting**: Built-in rate limiting
5. **Poison Message Handling**: Configurable failed message handling
6. **Pattern Routing**: Advanced pattern-based routing
7. **Consumer Groups**: Reliable message consumption
8. **Message Partitioning**: Parallel processing support
9. **Dead Letter Queues**: Automatic failed message handling
10. **Enterprise Features**: Message ordering, replay, and schema validation

## Examples

### Basic Event System

```typescript
import { createEventSystemBuilder, RedisStreamsPlugin } from '@logistically/events';

const eventSystem = createEventSystemBuilder()
  .service('notification-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    consumerGroup: 'notification-service-group'
  })
  .build();

await eventSystem.connect();

// Publish notification events
await eventSystem.publisher.publish('notification.sent', {
  userId: '123',
  type: 'email',
  content: 'Welcome to our service!'
});

// Subscribe to notification events
await eventSystem.consumer.subscribe('notification.sent', async (message, metadata) => {
  const { userId, type, content } = message.body;
  console.log(`Sending ${type} notification to user ${userId}: ${content}`);
});
```

### Advanced Event System with Multiple Transports

```typescript
import { createEventSystemBuilder, RedisStreamsPlugin, MemoryTransportPlugin } from '@logistically/events';

const eventSystem = createEventSystemBuilder()
  .service('order-service')
  .originPrefix('eu.de')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://redis-cluster:6379',
    consumerGroup: 'order-service-group',
    enableDLQ: true,
    maxRetries: 3
  })
  .addTransportFromFactory('memory', 'memory', {
    enablePatternRouting: true
  })
  .enablePublisherBatching({
    enabled: true,
    maxSize: 1000,
    maxWaitMs: 100,
    maxConcurrentBatches: 5,
    strategy: 'size'
  })
  .enableConsumerPatternRouting()
  .enableConsumerGroups()
  .setPoisonMessageHandler(async (message, error, metadata) => {
    console.error('Poison message:', message, error);
    await logToMonitoringSystem(message, error);
  })
  .build();

await eventSystem.connect();

// Subscribe to all order events
await eventSystem.consumer.subscribePattern('order.*', async (message, metadata, pattern) => {
  console.log(`Order event ${pattern}:`, message.body);
});

// Publish order events
await eventSystem.publisher.publish('order.created', {
  orderId: 'ORD-123',
  customerId: 'CUST-456',
  total: 99.99
});
```

### Custom Routing Configuration

```typescript
import { createEventSystemBuilder, createBasicRoutingConfig } from '@logistically/events';

const routingConfig = createBasicRoutingConfig(
  [
    { pattern: 'user.*', transport: 'redis', options: { topic: 'user-events' } },
    { pattern: 'order.*', transport: 'redis', options: { topic: 'order-events' } },
    { pattern: 'payment.*', transport: 'redis', options: { topic: 'payment-events' } }
  ],
  'warn',
  'eu.de',
  {
    'user.*': 'user',
    'order.*': 'order',
    'payment.*': 'payment'
  },
  'namespace'
);

const eventSystem = createEventSystemBuilder()
  .service('gateway-service')
  .originPrefix('eu.de')
  .routing(routingConfig)
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379'
  })
  .build();
```

This comprehensive API documentation now accurately reflects the actual implementation and provides developers with all the information they need to effectively use the library.
