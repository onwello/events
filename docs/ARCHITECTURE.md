# Event System Architecture

## Overview

The `@logistically/events` library implements a sophisticated event-driven architecture designed for high-performance, reliable event processing in distributed systems. The architecture is built around a plugin-based transport system with comprehensive validation, routing, and monitoring capabilities.

## System Architecture

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
├─────────────────────────────────────────────────────────────────┤
│  Infrastructure                                               │
│  ├── Redis Cluster                                           │
│  ├── Message Brokers                                         │
│  └── Monitoring Systems                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### EventSystemBuilder

The `EventSystemBuilder` is the central configuration and assembly point for the entire event system. It provides a fluent API for configuring all aspects of the system.

**Responsibilities:**
- **Configuration Management**: Centralized configuration for all components
- **Transport Factory**: Manages transport plugin registration and instantiation
- **Validation Engine**: Validates configuration before system assembly
- **System Assembly**: Creates and configures all system components

**Key Features:**
- **Fluent API**: Chainable configuration methods
- **Validation**: Comprehensive configuration validation
- **Plugin Support**: Extensible transport plugin system
- **Error Handling**: Clear error messages for misconfiguration

### EventPublisher

The `EventPublisher` handles all event publishing operations with enterprise-grade features.

**Responsibilities:**
- **Event Publishing**: Single and batch event publishing
- **Batching**: Configurable message batching for high throughput
- **Retry Logic**: Sophisticated retry mechanisms with backoff strategies
- **Rate Limiting**: Configurable rate limiting to prevent system overload
- **Validation**: Event validation before publishing
- **Routing**: Event routing to appropriate transports

**Advanced Features:**
- **Batching Strategies**: Time-based, size-based, and partition-based batching
- **Retry Strategies**: Fixed, exponential, and Fibonacci backoff
- **Rate Limiting**: Sliding window and token bucket strategies
- **Compression**: Optional message compression for large payloads

### EventConsumer

The `EventConsumer` manages event consumption with pattern-based routing and reliable processing.

**Responsibilities:**
- **Event Subscription**: Pattern-based event subscription
- **Message Processing**: Reliable message processing with error handling
- **Consumer Groups**: Support for consumer groups in supported transports
- **Poison Message Handling**: Configurable handling of failed messages
- **Statistics**: Comprehensive processing statistics and metrics

**Advanced Features:**
- **Pattern Routing**: Regex-based pattern matching for subscriptions
- **Origin Filtering**: Regional isolation through origin prefix filtering
- **Consumer Groups**: Automatic failover and load balancing
- **Message Replay**: Historical message replay capabilities
- **Partitioning**: Message partitioning for parallel processing

### EventRouter

The `EventRouter` provides sophisticated event routing capabilities with pattern matching and origin-based isolation.

**Responsibilities:**
- **Pattern Matching**: Advanced pattern matching with wildcard support
- **Topic Resolution**: Dynamic topic resolution based on patterns
- **Origin Isolation**: Regional isolation through origin prefixes
- **Transport Routing**: Route events to appropriate transports
- **Validation**: Route and pattern validation

**Advanced Features:**
- **Wildcard Patterns**: Support for `*`, `*.user.*`, `user.*` patterns
- **Origin Prefixes**: Regional isolation (e.g., `eu.de`, `us.ca`)
- **Topic Mapping**: Custom topic name mapping for patterns
- **Priority Routing**: Priority-based route selection
- **Validation Modes**: Strict, warn, and ignore validation modes

### EventValidator

The `EventValidator` provides comprehensive event validation using Zod schemas.

**Responsibilities:**
- **Schema Validation**: Event structure and content validation
- **Type Safety**: Runtime type checking and validation
- **Error Reporting**: Detailed validation error messages
- **Schema Evolution**: Support for schema versioning and evolution

## Transport System

### Dead Letter Queue (DLQ) Implementation

The library provides automatic dead letter queue functionality for the Redis transport:

**Redis Transport DLQ:**
- **Automatic Operation**: Messages automatically moved to DLQ after max retries
- **Configuration**: `enableDLQ`, `dlqStreamPrefix`, `maxRetriesBeforeDLQ`
- **DLQ Streams**: Failed messages stored in separate Redis streams with prefix
- **Error Context**: Original message ID, stream, error message, and timestamp preserved
- **No Public API**: DLQ operations are internal and automatic only

**Memory Transport:**
- **No DLQ Support**: Failed messages handled by poison message handler only
- **No Persistence**: Failed messages are not stored for later processing

**DLQ Configuration Example:**
```typescript
const eventSystem = createEventSystemBuilder()
  .withService('my-service')
  .withRedisTransport('redis://localhost:6379', {
    enableDLQ: true,
    dlqStreamPrefix: 'dlq:',
    maxRetriesBeforeDLQ: 3
  })
  .build();
```

### Transport Interface

All transports implement a common interface that provides:

```typescript
interface Transport {
  // Core capabilities
  supportsPublishing: boolean;
  supportsSubscription: boolean;
  supportsPatternRouting: boolean;
  supportsBatching: boolean;
  supportsPartitioning: boolean;
  supportsConsumerGroups: boolean;
  
  // Operational methods
  publish(topic: string, message: any, options?: PublishOptions): Promise<void>;
  subscribe(topic: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  
  // Lifecycle management
  connect(): Promise<void>;
  close(): Promise<void>;
}
```

### Redis Streams Transport

The Redis Streams transport provides enterprise-grade event streaming capabilities.

**Features:**
- **Consumer Groups**: Reliable message consumption with automatic failover
- **Batching**: High-performance message batching
- **Partitioning**: Message partitioning for parallel processing
- **Ordering**: Strict message ordering guarantees
- **Retention**: Configurable message retention policies
- **Cluster Support**: Redis Cluster support for high availability
- **Dead Letter Queues**: Automatic DLQ for failed messages after max retries

**Architecture:**
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Publisher     │    │   Consumer      │    │   Redis         │
│                 │    │                 │    │   Streams       │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │   Batching  │ │    │ │Consumer Grp │ │    │ │   Stream    │ │
│ │   Engine    │ │    │ │   Manager   │ │    │ │  user.events│ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │   Retry     │ │    │ │  Partition  │ │    │ │   Stream    │ │
│ │   Engine    │ │    │ │  Manager    │ │    │ │ order.events│ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │   Rate      │ │    │ │   Schema    │ │    │ │   Stream    │ │
│ │  Limiter    │ │    │ │  Manager    │ │    │ │product.events│ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Memory Transport

The Memory transport provides fast in-memory event processing for development and testing.

**Features:**
- **In-Memory Processing**: Ultra-fast local event processing
- **Pattern Matching**: Regex-based pattern matching
- **Testing Support**: Ideal for unit and integration tests
- **No Persistence**: Events are not persisted (for testing only)
- **No DLQ Support**: Failed messages handled by poison message handler only

## Data Flow

### Event Publishing Flow

```
1. Event Creation
   ┌─────────────┐
   │   Client    │
   └─────┬───────┘
         │
2. Validation
   ┌─────────────┐
   │   Validator │
   └─────┬───────┘
         │
3. Routing
   ┌─────────────┐
   │    Router   │
   └─────┬───────┘
         │
4. Transport Selection
   ┌─────────────┐
   │  Transport  │
   │   Factory   │
   └─────┬───────┘
         │
5. Publishing
   ┌─────────────┐
   │   Transport │
   └─────────────┘
```

### Event Consumption Flow

```
1. Event Arrival
   ┌─────────────┐
   │   Transport │
   └─────┬───────┘
         │
2. Pattern Matching
   ┌─────────────┐
   │    Router   │
   └─────┬───────┘
         │
3. Origin Filtering
   ┌─────────────┐
   │   Consumer  │
   └─────┬───────┘
         │
4. Validation
   ┌─────────────┐
   │   Validator │
   └─────┬───────┘
         │
5. Handler Execution
   ┌─────────────┐
   │   Handler   │
   └─────────────┘
```

## Configuration Management

### Configuration Hierarchy

```
EventSystemConfig
├── Service Configuration
│   ├── service: string
│   ├── validationMode: 'strict' | 'warn' | 'ignore'
│   └── originPrefix?: string
├── Transport Configuration
│   ├── transports: Map<string, Transport>
│   └── transportCapabilities: Map<string, TransportCapabilities>
├── Publisher Configuration
│   ├── batching: BatchingConfig
│   ├── retry: RetryConfig
│   └── rateLimiting: RateLimitingConfig
├── Consumer Configuration
│   ├── enablePatternRouting: boolean
│   ├── enableConsumerGroups: boolean
│   └── poisonMessageHandler?: PoisonMessageHandler
└── Routing Configuration
    ├── routes: EventRoute[]
    ├── topicMapping: TopicMapping
    └── defaultTopicStrategy: TopicStrategy
```

### Validation Pipeline

```
1. Configuration Assembly
   ┌─────────────────┐
   │ Configuration   │
   │   Assembly      │
   └─────────┬───────┘
             │
2. Schema Validation
   ┌─────────────────┐
   │   Schema        │
   │  Validation     │
   └─────────┬───────┘
             │
3. Transport Validation
   ┌─────────────────┐
   │   Transport     │
   │   Capabilities  │
   └─────────┬───────┘
             │
4. Routing Validation
   ┌─────────────────┐
   │    Routing      │
   │   Validation    │
   └─────────┬───────┘
             │
5. System Assembly
   ┌─────────────────┐
   │   Component     │
   │   Assembly      │
   └─────────────────┘
```

## Performance Characteristics

### Design Goals

- **Efficient Pattern Matching**: Optimized route matching algorithms
- **Batch Processing**: Configurable batching for high throughput
- **Memory Management**: Efficient memory usage patterns
- **Scalable Architecture**: Support for multiple transport instances

### Current Limitations

- **No performance benchmarks**: No published performance figures
- **No load testing tools**: Performance characteristics depend on transport implementation
- **No optimization guarantees**: Performance varies by use case and configuration

## Security Considerations

### Data Protection

- **Event Validation**: Comprehensive input validation using Zod schemas
- **Schema Enforcement**: Strict schema validation before processing
- **Origin Isolation**: Regional data isolation through origin prefixes

### Current Limitations

- **No built-in encryption**: Transport-level encryption depends on transport implementation
- **No authentication**: Authentication must be implemented at transport level
- **No authorization**: Access control must be implemented at application level

## Monitoring and Observability

### Built-in Statistics

- **Publisher Statistics**: Message counts, batch information, error counts
- **Consumer Statistics**: Message processing, failure counts, processing times
- **System Status**: Connection status for transports

### Current Limitations

- **No built-in metrics**: No Prometheus or other metrics system integration
- **No distributed tracing**: No OpenTelemetry or similar tracing support
- **No health check endpoints**: Health status available through API calls only
- **No structured logging**: Basic console logging only

## Deployment Considerations

### Production Deployment

- **High Availability**: Multi-instance deployment
- **Load Balancing**: Load balancer configuration
- **Monitoring**: Comprehensive monitoring setup
- **Backup**: Data backup and recovery procedures

### Development Environment

- **Memory Transport**: Fast local development
- **Mock Services**: Mock external dependencies
- **Hot Reloading**: Development server configuration
- **Testing**: Automated testing setup

### Testing Strategy

- **Unit Tests**: Component-level testing with Jest
- **Integration Tests**: End-to-end testing with real transports
- **Coverage Reporting**: Jest coverage reporting for code quality

## Future Enhancements

### Potential Future Features

- **Enhanced Monitoring**: Better observability and metrics
- **Advanced Security**: Built-in encryption and authentication
- **Performance Optimization**: Performance benchmarking and optimization
- **Extended Transport Support**: Additional transport implementations

### Current Focus

- **Core Functionality**: Stabilizing existing features
- **Test Coverage**: Improving test coverage and quality
- **Documentation**: Accurate and comprehensive documentation
- **Bug Fixes**: Addressing known issues and edge cases
