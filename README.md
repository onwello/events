# @logistically/events

A production-ready event-driven architecture library with Redis Streams, comprehensive batching, reliable consumption, and enterprise-grade features.

## 🚀 Features

### Core Event System
- **Event System Builder**: Fluent API for configuring and building event systems
- **Event Publisher**: Reliable event publishing with batching, retry, and rate limiting
- **Event Consumer**: Pattern-based event consumption with consumer groups and poison message handling
- **Event Router**: Advanced pattern-based routing with origin prefix support
- **Transport Agnostic**: Plugin-based transport system supporting Redis Streams and Memory

### Redis Streams Transport
- **Consumer Groups**: Reliable message consumption with automatic failover
- **Batching**: Configurable message batching for high throughput
- **Partitioning**: Message partitioning for parallel processing
- **Message Ordering**: Strict ordering guarantees
- **Message Replay**: Historical message replay capabilities
- **Schema Management**: Event schema validation and evolution
- **Dead Letter Queues**: Automatic failed message handling
- **Cluster Support**: Redis Cluster support for high availability

### Memory Transport
- **In-Memory Processing**: Fast local event processing
- **Pattern Matching**: Regex-based pattern matching
- **Testing Support**: Ideal for unit and integration tests

### Enterprise Features
- **Origin-Based Routing**: Regional isolation and namespace separation
- **Validation**: Comprehensive event validation
- **Error Handling**: Poison message handling and retry mechanisms
- **Monitoring**: Built-in statistics and metrics
- **Type Safety**: Full TypeScript support with comprehensive types

## 📦 Installation

```bash
npm install @logistically/events
```

## 🏗️ Quick Start

### Basic Event System

```typescript
import { createEventSystemBuilder } from '@logistically/events';

const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    groupId: 'my-service-group'
  })
  .build();

await eventSystem.connect();

// Publish events
await eventSystem.publisher.publish('user.created', { userId: '123' });

// Subscribe to events
await eventSystem.consumer.subscribe('user.created', async (message, metadata) => {
  console.log('Received:', message.body);
});

await eventSystem.close();
```

### Advanced Configuration

```typescript
import { createEventSystemBuilder } from '@logistically/events';

const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    groupId: 'my-service-group',
    batchSize: 100,
    enableDLQ: true,
    dlqStreamPrefix: 'dlq:',
    maxRetries: 3
  })
  .originPrefix('eu.de')
  .setValidationMode('warn')
  .enablePublisherBatching({
    enabled: true,
    maxSize: 1000,
    maxWaitMs: 100,
    maxConcurrentBatches: 5,
    strategy: 'size'
  })
  .enablePublisherRetry({
    maxRetries: 3,
    backoffStrategy: 'exponential',
    baseDelay: 1000,
    maxDelay: 10000
  })
  .enableConsumerPatternRouting()
  .enableConsumerGroups()
  .build();
```

## 🔧 Configuration

### Event System Configuration

```typescript
interface EventSystemConfig {
  service: string;                    // Required service name
  transports: Map<string, Transport>; // Transport instances
  routing?: RoutingConfig;            // Optional routing configuration
  validationMode?: 'strict' | 'warn' | 'ignore';
  originPrefix?: string;              // Regional prefix (e.g., 'eu.de')
  origins?: string[];                 // Allowed origin prefixes
  
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
}
```

### Redis Transport Configuration

```typescript
interface RedisStreamsConfig {
  // Connection settings
  url?: string;                       // Redis connection URL
  host?: string;                      // Redis host
  port?: number;                      // Redis port
  db?: number;                        // Redis database
  password?: string;                  // Redis password
  
  // Consumer group settings
  groupId?: string;                   // Consumer group name
  consumerId?: string;                // Consumer ID
  
  // Stream settings
  streamPrefix?: string;              // Stream prefix
  maxLen?: number;                    // Maximum stream length
  trimStrategy?: 'MAXLEN' | 'MINID'; // Stream trimming strategy
  
  // Consumer settings
  batchSize?: number;                 // Batch size for consumption
  blockTime?: number;                 // Block time for polling
  pollInterval?: number;              // Poll interval
  maxRetries?: number;                // Maximum retries
  retryDelay?: number;                // Retry delay
  
  // Dead letter queue settings
  enableDLQ?: boolean;                // Enable dead letter queue
  dlqStreamPrefix?: string;           // DLQ stream prefix
  maxRetriesBeforeDLQ?: number;      // Max retries before DLQ
  
  // Performance settings
  enablePipelining?: boolean;         // Enable pipelining
  pipelineSize?: number;              // Pipeline size
  
  // Enterprise features
  ordering?: OrderingConfig;          // Message ordering configuration
  partitioning?: PartitioningConfig;  // Partitioning configuration
  schema?: SchemaConfig;              // Schema management
  replay?: ReplayConfig;              // Message replay configuration
}
```

### Memory Transport Configuration

```typescript
interface MemoryTransportConfig {
  originPrefix?: string;              // Origin prefix for routing
}
```

## 📚 Usage Examples

### Event Publishing

```typescript
// Basic publishing
await eventSystem.publisher.publish('user.created', { userId: '123' });

// Publishing with options
await eventSystem.publisher.publish('order.completed', 
  { orderId: '456', total: 99.99 },
  { partition: 1, headers: { priority: 'high' } }
);

// Batch publishing
const events = [
  { eventType: 'user.created', body: { userId: '123' } },
  { eventType: 'user.created', body: { userId: '456' } }
];

await eventSystem.publisher.publishBatch(events);
```

### Event Consumption

```typescript
// Basic subscription
await eventSystem.consumer.subscribe('user.created', async (message, metadata) => {
  console.log('User created:', message.body);
});

// Pattern subscription
await eventSystem.consumer.subscribePattern('user.*', async (message, metadata, pattern) => {
  console.log('User event:', message.header.type, message.body, 'Pattern:', pattern);
});

// Subscription with options
await eventSystem.consumer.subscribe('order.*', async (message, metadata) => {
  console.log('Order event:', message.body);
}, {
  groupId: 'order-processors',
  partition: 1
});
```

### Advanced Routing

```typescript
import { createEventRouter, createBasicRoutingConfig } from '@logistically/events';

const routingConfig = createBasicRoutingConfig(
  [
    {
      pattern: 'user.*',
      transport: 'redis',
      priority: 1,
      options: {
        topic: 'user-events',
        partition: 1,
        ordering: 'strict'
      }
    }
  ],
  'warn',
  'eu.de',
  {
    'user.*': 'user',
    'order.*': 'order'
  },
  'namespace'
);

const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .routing(routingConfig)
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379'
  })
  .build();
```

## 🔍 Pattern Matching

### Supported Patterns

- **Exact**: `user.created` - Matches exactly
- **Wildcard**: `user.*` - Matches all user events
- **Prefix Wildcard**: `*.user.*` - Matches user events with any prefix/suffix
- **Suffix Wildcard**: `user.*.completed` - Matches user events ending with completed

### Pattern Examples

```typescript
// Valid patterns
'user.created'           // Exact match
'user.*'                // All user events
'*.user.*'              // User events with any prefix/suffix
'order.*.completed'     // Order events ending with completed
'product.inventory.*'   // Product inventory events

// Invalid patterns
'.user.*'               // Cannot start with dot
'user.*.'               // Cannot end with dot
'user..created'         // Cannot have consecutive dots
'user**created'         // Cannot have consecutive asterisks
'user*created'          // Asterisk must be standalone
```

## 🌍 Origin-Based Routing

### Regional Isolation

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .originPrefix('eu.de')  // European Germany
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379'
  })
  .build();

// Events are automatically prefixed
// 'user.created' becomes 'eu.de.user.created'
await eventSystem.publisher.publish('user.created', { userId: '123' });

// Patterns respect origin prefix
await eventSystem.consumer.subscribe('user.created', handler);
// Only matches 'eu.de.user.created', not 'us.ca.user.created'
```

### Multi-Region Support

```typescript
// European region
const euSystem = createEventSystemBuilder()
  .service('eu-service')
  .originPrefix('eu.de')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://eu-redis:6379'
  })
  .build();

// US region
const usSystem = createEventSystemBuilder()
  .service('us-service')
  .originPrefix('us.ca')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://us-redis:6379'
  })
  .build();
```

### Origin Filtering

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .origins(['eu.de', 'us.ca'])  // Allow multiple origins
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379'
  })
  .build();

// Only events from eu.de or us.ca origins will be processed
await eventSystem.consumer.subscribe('user.*', handler);
```

## 📊 Monitoring and Statistics

### Consumer Statistics

```typescript
const stats = await eventSystem.consumer.getStats();

console.log('Total messages:', stats.totalMessagesReceived);
console.log('Failed messages:', stats.failedMessages);
console.log('Poison messages:', stats.poisonMessages);
console.log('Average processing time:', stats.averageProcessingTime);
console.log('Last message time:', stats.lastMessageTime);
```

### Publisher Statistics

```typescript
const stats = await eventSystem.publisher.getStats();

console.log('Total published:', stats.totalMessagesSent);
console.log('Failed publishes:', stats.failedMessages);
console.log('Batch count:', stats.totalBatchesSent);
console.log('Average latency:', stats.averageLatency);
```

### System Status

```typescript
const status = await eventSystem.getStatus();

console.log('Connected:', status.connected);
console.log('Healthy:', status.healthy);
console.log('Uptime:', status.uptime);
console.log('Version:', status.version);

// Transport status
for (const [name, transportStatus] of status.transports) {
  console.log(`Transport ${name}:`, transportStatus.connected, transportStatus.healthy);
}
```

## 🧪 Testing and Development

### Memory Transport for Testing

```typescript
import { createEventSystemBuilder } from '@logistically/events';

const testSystem = createEventSystemBuilder()
  .service('test-service')
  .addTransportFromFactory('memory', 'memory', {
    enablePatternRouting: true
  })
  .build();

// Use in your tests
await testSystem.publisher.publish('test.event', { data: 'test' });
await testSystem.consumer.subscribe('test.*', handler);
```

### Integration Testing

```typescript
// Use Redis transport for integration tests
const integrationSystem = createEventSystemBuilder()
  .service('integration-test')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    groupId: 'integration-test-group'
  })
  .build();

// Test real Redis functionality
await integrationSystem.publisher.publish('integration.test', { test: true });
```

### Comprehensive Test Suite

The library includes extensive testing capabilities:

- **Unit Tests**: 700+ tests covering all components
- **Integration Tests**: End-to-end testing with real transports
- **Performance Tests**: Load testing and benchmarking
- **Memory Leak Detection**: Automatic leak detection in tests
- **Coverage Reporting**: Detailed coverage analysis

## 🚨 Error Handling and Resilience

### Poison Message Handling

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379'
  })
  .setPoisonMessageHandler(async (message, error, metadata) => {
    console.error('Poison message:', message, error);
    // Handle failed messages (e.g., log to monitoring system)
    await logToMonitoringSystem(message, error);
  })
  .build();
```

### Validation Errors

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379'
  })
  .setValidationMode('strict')  // Throw on validation errors
  .build();

try {
  await eventSystem.publisher.publish('invalid.event', { invalid: 'data' });
} catch (error) {
  console.error('Validation failed:', error.message);
}
```

### Retry with Exponential Backoff

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379'
  })
  .enablePublisherRetry({
    maxRetries: 5,
    backoffStrategy: 'exponential',
    baseDelay: 1000,
    maxDelay: 30000
  })
  .build();

// Intelligent retry with exponential backoff for transient failures
```

## 🏭 Enterprise Features

### High Availability

- **Redis Cluster Support**: Basic cluster support with failover capabilities
- **Consumer Groups**: Reliable message consumption with automatic failover
- **Health Status**: Comprehensive health status through API calls
- **Error Handling**: Comprehensive error handling and retry mechanisms

### Dead Letter Queues (Redis Transport)

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    enableDLQ: true,                    // Enable automatic DLQ
    dlqStreamPrefix: 'dlq:',            // DLQ stream prefix
    maxRetriesBeforeDLQ: 3              // Retry count before DLQ
  })
  .build();

// Failed messages are automatically moved to DLQ streams after max retries
// DLQ streams are named with 'dlq:' prefix (e.g., 'dlq:user-events')
```

### Message Ordering

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    ordering: {
      enabled: true,
      strategy: 'strict',
      partitionKey: 'userId'
    }
  })
  .build();

// Maintain strict ordering for messages with the same partition key
```

### Schema Management

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    schema: {
      enabled: true,
      validationMode: 'strict',
      autoEvolution: true,
      compatibilityCheck: true
    }
  })
  .build();

// Automatic schema validation and evolution
```

### Message Replay

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    replay: {
      enabled: true,
      maxReplayMessages: 1000,
      replayTimeout: 300000,
      validateReplay: true
    }
  })
  .build();

// Historical messages can be replayed for testing or recovery
```

### Security

- **Event Validation**: Comprehensive input validation
- **Origin Isolation**: Regional data isolation through origin prefixes
- **Transport Security**: Security depends on transport implementation
- **No Built-in Encryption**: Encryption must be implemented at transport level

### Monitoring and Observability

- **Built-in Statistics**: Publisher and consumer performance metrics
- **System Status**: Connection status and comprehensive health information
- **Error Tracking**: Failed message and poison message tracking
- **Transport Metrics**: Detailed transport-level performance data

## 📈 Performance Tuning

### Batching Configuration

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379'
  })
  .enablePublisherBatching({
    enabled: true,
    maxSize: 1000,           // Maximum batch size
    maxWaitMs: 100,          // Maximum wait time
    maxConcurrentBatches: 5, // Parallel batch processing
    strategy: 'size'          // Batch by size, not time
  })
  .build();
```

### Partitioning

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    partitioning: {
      enabled: true,
      strategy: 'hash',
      partitions: 8,
      partitionKey: 'userId'
    }
  })
  .build();
```

### Rate Limiting

```typescript
const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379'
  })
  .enablePublisherRateLimiting({
    maxRequests: 1000,
    timeWindow: 60000,
    strategy: 'sliding-window'
  })
  .build();
```

## 🔧 Advanced Configuration

### Custom Transport

```typescript
import { Transport, TransportCapabilities } from '@logistically/events';

class CustomTransport implements Transport {
  readonly name = 'custom';
  readonly capabilities: TransportCapabilities = {
    supportsPublishing: true,
    supportsSubscription: true,
    supportsBatching: false,
    supportsPartitioning: false,
    supportsOrdering: false,
    supportsPatternRouting: false,
    supportsConsumerGroups: false,
    supportsDeadLetterQueues: false,
    supportsMessageRetention: false,
    supportsMessageCompression: false,
    maxMessageSize: 1024,
    maxBatchSize: 1,
    maxTopics: 100,
    maxPartitions: 1,
    maxConsumerGroups: 0,
    supportsPersistence: false,
    supportsReplication: false,
    supportsFailover: false,
    supportsTransactions: false,
    supportsMetrics: true,
    supportsTracing: false,
    supportsHealthChecks: true
  };

  // Implement required methods...
}

const eventSystem = createEventSystemBuilder()
  .service('my-service')
  .addTransport('custom', new CustomTransport())
  .build();
```

### Transport Factory

```typescript
import { createTransportFactory, RedisStreamsPlugin, MemoryTransportPlugin } from '@logistically/events';

const factory = createTransportFactory();

// Register plugins
factory.registerPlugin(new RedisStreamsPlugin());
factory.registerPlugin(new MemoryTransportPlugin());

// Create transports
const redisTransport = factory.createTransport({
  type: 'redis-streams',
  options: {
    url: 'redis://localhost:6379',
    groupId: 'my-group'
  }
});

const memoryTransport = factory.createTransport({
  type: 'memory',
  options: {
    enablePatternRouting: true
  }
});
```

## 📚 API Reference

For detailed API documentation, see:

- **[API Reference](./docs/API.md)** - Complete API documentation
- **[Event Routing Reference](./docs/EVENT_ROUTING_REFERENCE.md)** - Comprehensive routing system documentation
- **[Architecture Guide](./docs/ARCHITECTURE.md)** - System architecture overview

## 🏗️ System Architecture

The library follows a modular, plugin-based architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Event System                            │
├─────────────────────────────────────────────────────────────────┤
│  EventSystemBuilder                                           │
│  ├── Configuration Management                                 │
│  ├── Transport Factory                                       │
│  ├── Validation Engine                                       │
│  └── System Assembly                                         │
├─────────────────────────────────────────────────────────────────┤
│  Core Components                                              │
│  ├── EventPublisher                                          │
│  ├── EventConsumer                                           │
│  ├── EventRouter                                             │
│  └── EventValidator                                          │
├─────────────────────────────────────────────────────────────────┤
│  Transport Layer                                              │
│  ├── Redis Streams Transport                                 │
│  ├── Memory Transport                                        │
│  └── Custom Transport Plugins                                │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

- **Transport Agnostic**: Core logic independent of transport implementation
- **Plugin Architecture**: Easy to add new transports and features
- **Type Safety**: Full TypeScript support with comprehensive types
- **Validation First**: Comprehensive validation at every level
- **Performance Optimized**: Efficient batching, partitioning, and routing
- **Enterprise Ready**: Production-grade features for mission-critical systems

## 🚀 Getting Started Examples

### Simple Notification Service

```typescript
import { createEventSystemBuilder } from '@logistically/events';

const notificationService = createEventSystemBuilder()
  .service('notification-service')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379',
    groupId: 'notification-service-group'
  })
  .build();

await notificationService.connect();

// Subscribe to notification events
await notificationService.consumer.subscribe('notification.sent', async (message, metadata) => {
  const { userId, type, content } = message.body;
  console.log(`Sending ${type} notification to user ${userId}: ${content}`);
});

// Publish notification events
await notificationService.publisher.publish('notification.sent', {
  userId: '123',
  type: 'email',
  content: 'Welcome to our service!'
});
```

### Multi-Transport Order Service

```typescript
import { createEventSystemBuilder } from '@logistically/events';

const orderService = createEventSystemBuilder()
  .service('order-service')
  .originPrefix('eu.de')
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://redis-cluster:6379',
    groupId: 'order-service-group',
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

await orderService.connect();

// Subscribe to all order events
await orderService.consumer.subscribePattern('order.*', async (message, metadata, pattern) => {
  console.log(`Order event ${pattern}:`, message.body);
});

// Publish order events
await orderService.publisher.publish('order.created', {
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

const gatewayService = createEventSystemBuilder()
  .service('gateway-service')
  .originPrefix('eu.de')
  .routing(routingConfig)
  .addTransportFromFactory('redis', 'redis-streams', {
    url: 'redis://localhost:6379'
  })
  .build();
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/onwello/events/issues)
- **Documentation**: [GitHub Wiki](https://github.com/onwello/events/wiki)
- **Discussions**: [GitHub Discussions](https://github.com/onwello/events/discussions)
