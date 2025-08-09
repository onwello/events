# Enhanced Message Broker Features

This document describes the enhanced features that transform Redis Streams into a full-fledged message broker with topic-based routing and pattern matching capabilities.

## 🎯 Overview

The enhanced features provide:

- **Topic-based routing** with wildcard pattern matching
- **Transport abstraction** for pluggable backends (Redis, Kafka, RabbitMQ)
- **Partitioned message processing** for scalability
- **Poison message handling** with dead letter queues
- **Multi-tenant support** with topic isolation
- **NestJS microservices compatibility**

## 🚀 Quick Start

### Basic Usage

```typescript
import { 
  createEnhancedPublisher, 
  createEnhancedConsumer,
  ConsumerBuilder 
} from '@logistically/events';

// Create transport configuration
const transportConfig = {
  type: 'redis' as const,
  options: {
    host: 'localhost',
    port: 6379
  }
};

// Create publisher
const publisher = createEnhancedPublisher({
  transport: transportConfig,
  enablePatternRouting: true
});

// Create consumer
const consumer = new ConsumerBuilder(transportConfig)
  .withConsumerId('my-service')
  .withPatternRouting(true)
  .build();

// Connect
await publisher.connect();
await consumer.connect();

// Subscribe to specific topic
await consumer.subscribe('user.registration.created', async (event, metadata) => {
  console.log('User registered:', event);
});

// Subscribe to pattern
await consumer.subscribePattern('user.*.created', async (event, metadata) => {
  console.log('User event created:', event);
});

// Publish events
await publisher.publish('user.registration.created', {
  userId: '123',
  email: 'user@example.com'
});
```

## 📋 Core Concepts

### 1. Topics and Partitions

Topics are logical abstractions that map to one or more Redis streams (partitions):

```typescript
// Topic configuration
const topicConfig = {
  name: 'user-events',
  partitions: 3, // Maps to 3 Redis streams
  retention: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    maxSize: 10000 // messages
  },
  ordering: 'per-partition' // Strict ordering within partitions
};
```

### 2. Pattern-Based Routing

Support for wildcard patterns similar to Kafka:

```typescript
// Subscribe to specific events
await consumer.subscribe('location.us.user.registration.created', handler);

// Subscribe to all US user events
await consumer.subscribePattern('location.us.user.*', handler);

// Subscribe to all registration events globally
await consumer.subscribePattern('location.*.user.registration.*', handler);

// Subscribe to all completed events
await consumer.subscribePattern('location.*.user.*.completed', handler);
```

### 3. Transport Abstraction

The library supports multiple transport backends:

```typescript
// Redis transport
const redisTransport = {
  type: 'redis' as const,
  options: { host: 'localhost', port: 6379 }
};

// Future: Kafka transport
const kafkaTransport = {
  type: 'kafka' as const,
  options: { brokers: ['localhost:9092'] }
};

// Future: RabbitMQ transport
const rabbitmqTransport = {
  type: 'rabbitmq' as const,
  options: { url: 'amqp://localhost' }
};
```

## 🔧 Advanced Features

### 1. Partitioned Processing

```typescript
// Publisher with consistent partitioning
const publisher = createEnhancedPublisher({
  transport: transportConfig,
  partitionKeyExtractor: (event) => event.userId // Same user = same partition
});

// Publish events with consistent ordering per user
await publisher.publish('orders', {
  orderId: 'order-123',
  userId: 'user-456', // This determines the partition
  amount: 99.99
});
```

### 2. Multi-Tenant Support

```typescript
// Tenant-specific publishers
const tenantAPublisher = createEnhancedPublisher({
  transport: transportConfig,
  topicPrefix: 'tenant-a'
});

const tenantBConsumer = new ConsumerBuilder(transportConfig)
  .withConsumerId('tenant-b-processor')
  .build();

// Subscribe to tenant-specific patterns
await tenantBConsumer.subscribePattern('tenant-a.*.order.*', handler);

// Publish tenant-specific events
await tenantAPublisher.publish('tenant-a.us.order.created', {
  orderId: 'order-123',
  amount: 99.99
});
```

### 3. Poison Message Handling

```typescript
const consumer = new ConsumerBuilder(transportConfig)
  .withPoisonMessageHandler(async (message, error) => {
    // Send to monitoring system
    await sendToMonitoring({
      message,
      error: error.message,
      timestamp: Date.now()
    });
    
    // Move to dead letter queue
    await moveToDeadLetterQueue(message);
  })
  .build();
```

### 4. Consumer Groups

```typescript
const consumer = new ConsumerBuilder(transportConfig)
  .withGroupId('order-processors')
  .withConsumerId('processor-1')
  .withAutoOffsetReset('latest')
  .withAutoCommit(true)
  .withAutoCommitInterval(5000)
  .build();
```

## 🏗️ Architecture

### Transport Layer

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Application   │    │  MessageBroker  │    │    Transport    │
│                 │◄──►│                 │◄──►│                 │
│ - Publisher     │    │ - Topic Mgmt    │    │ - Redis         │
│ - Consumer      │    │ - Pattern Router│    │ - Kafka (future)│
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Topic to Stream Mapping

```
Topic: user-events (3 partitions)
├── Stream: topic:user-events:partition:0
├── Stream: topic:user-events:partition:1
└── Stream: topic:user-events:partition:2
```

### Pattern Routing

```
Pattern: location.*.user.registration.*
├── Matches: location.us.user.registration.created
├── Matches: location.eu.user.registration.created
└── Matches: location.asia.user.registration.completed
```

## 📊 Monitoring and Observability

### Basic Metrics

```typescript
// Get broker capabilities
const capabilities = consumer.getCapabilities();
console.log('Supports partitioning:', capabilities.supportsPartitioning);
console.log('Supports pattern routing:', capabilities.supportsPatternRouting);

// Get consumer statistics
console.log('Subscribed topics:', consumer.getSubscribedTopics());
console.log('Subscribed patterns:', consumer.getSubscribedPatterns());
```

### Topic Statistics

```typescript
// Get topic statistics
const stats = await publisher.getTopicStats('user-events');
console.log('Total messages:', stats.totalMessages);
console.log('Partitions:', stats.partitions);
console.log('Oldest message:', stats.oldestMessage);
console.log('Newest message:', stats.newestMessage);
```

## 🔒 Security and Multi-Tenancy

### Topic Isolation

```typescript
// Tenant-specific topic prefixes
const tenantConfig = {
  transport: transportConfig,
  topicPrefix: 'tenant-a',
  allowedTopics: ['tenant-a.*'], // Restrict to tenant topics only
  enablePatternRouting: true
};
```

### Access Control

```typescript
// Publisher with access restrictions
const publisher = createEnhancedPublisher({
  transport: transportConfig,
  allowedTopics: ['user.*', 'order.*'], // Only allow specific topics
  enablePatternRouting: true
});
```

## 🚨 Error Handling

### Poison Messages

```typescript
const consumer = new ConsumerBuilder(transportConfig)
  .withPoisonMessageHandler(async (message, error) => {
    // Log the error
    console.error('Poison message:', { message, error });
    
    // Send to monitoring
    await sendToMonitoring({
      type: 'poison_message',
      message,
      error: error.message,
      timestamp: Date.now()
    });
    
    // Move to dead letter queue
    await moveToDeadLetterQueue(message);
  })
  .build();
```

### Connection Failures

```typescript
// Automatic reconnection
const publisher = createEnhancedPublisher({
  transport: {
    type: 'redis' as const,
    options: {
      host: 'localhost',
      port: 6379,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      retryDelayOnClusterDown: 300,
      enableReadyCheck: false
    }
  }
});
```

## 🔄 Migration from Legacy API

### Before (Legacy)

```typescript
import { EventPublisher, EventConsumer } from '@logistically/events';

const publisher = new EventPublisher();
const consumer = new EventConsumer();

await publisher.publish('user.created', { userId: '123' });
await consumer.subscribe('user.created', handler);
```

### After (Enhanced)

```typescript
import { createEnhancedPublisher, ConsumerBuilder } from '@logistically/events';

const publisher = createEnhancedPublisher({
  transport: { type: 'redis', options: { host: 'localhost', port: 6379 } }
});

const consumer = new ConsumerBuilder({ type: 'redis', options: { host: 'localhost', port: 6379 } })
  .build();

await publisher.publish('user.created', { userId: '123' });
await consumer.subscribe('user.created', handler);
```

## 🎯 Best Practices

### 1. Topic Naming

```typescript
// Good: Hierarchical naming
'location.us.user.registration.created'
'location.eu.user.registration.completed'
'order.payment.processed'
'order.shipping.delivered'

// Avoid: Flat naming
'user_event'
'order_event'
```

### 2. Pattern Design

```typescript
// Good: Specific patterns
'location.*.user.registration.*'  // All registration events
'location.*.user.*.completed'     // All completed user actions

// Avoid: Too broad patterns
'*.*.*.*'  // Too broad, matches everything
```

### 3. Partitioning Strategy

```typescript
// Good: Consistent partitioning
const publisher = createEnhancedPublisher({
  transport: transportConfig,
  partitionKeyExtractor: (event) => event.userId // Same user = same partition
});

// Avoid: Random partitioning for ordered events
const publisher = createEnhancedPublisher({
  transport: transportConfig,
  partitionKeyExtractor: () => Math.random().toString() // Inconsistent ordering
});
```

### 4. Error Handling

```typescript
// Good: Comprehensive error handling
const consumer = new ConsumerBuilder(transportConfig)
  .withPoisonMessageHandler(async (message, error) => {
    // Log, monitor, and move to DLQ
    await handlePoisonMessage(message, error);
  })
  .build();

// Avoid: Silent failures
const consumer = new ConsumerBuilder(transportConfig).build();
// No error handling - messages will be lost
```

## 🔮 Future Enhancements

### Planned Features

1. **Kafka Transport**: Full Kafka compatibility
2. **RabbitMQ Transport**: AMQP protocol support
3. **Advanced Monitoring**: Prometheus metrics, Grafana dashboards
4. **Schema Registry**: Event schema validation and evolution
5. **Stream Processing**: Real-time event processing pipelines
6. **Geographic Distribution**: Multi-region message routing
7. **Advanced Security**: Encryption, authentication, authorization

### Roadmap

- **Phase 1**: Core message broker features ✅
- **Phase 2**: Advanced monitoring and observability
- **Phase 3**: Additional transport backends
- **Phase 4**: Enterprise features (security, compliance)
- **Phase 5**: Advanced stream processing capabilities
