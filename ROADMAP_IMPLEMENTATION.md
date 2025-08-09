# Roadmap Features Implementation

This document describes the implementation of critical roadmap features for the `@logistically/events` library. These features address production readiness, enterprise requirements, and enhanced developer experience.

## 🚀 Implemented Features

### 1. Enhanced Topic Configuration & Stream Control

**Problem Solved**: Library publishes to unintended topics, lacks explicit topic naming, and has no security controls.

**Solution**: Comprehensive topic configuration system with dynamic resolution, security validation, and isolation.

#### Key Features:
- **Explicit topic naming**: Specify exact topic names
- **Dynamic topic resolution**: Support for payload-based topic naming
- **Topic validation**: Validate topic names before publishing
- **Security controls**: Multi-tenant support with topic isolation
- **Warning system**: Alert when topic length exceeds thresholds

#### Usage Example:

```typescript
import { EnhancedTopicConfigurationManager, EnhancedTopicConfiguration } from '@logistically/events';

const config: EnhancedTopicConfiguration = {
  defaultTopic: 'my-events',
  topicNamingStrategy: 'dynamic',
  topicValidation: true,
  topicIsolation: {
    enabled: true,
    environment: 'prod',
    namespace: 'myapp'
  },
  security: {
    allowedTopics: ['user-events', 'order-events', 'payment-events'],
    deniedTopics: ['test-events', 'debug-events'],
    multiTenant: true,
    tenantResolver: (payload) => payload?.tenant || 'default'
  },
  warnings: {
    topicLengthThreshold: 20000,
    backpressureThreshold: 1000,
    onWarning: (topic, warning) => {
      console.warn(`Topic warning: ${warning.message}`);
    }
  }
};

const topicManager = new EnhancedTopicConfigurationManager(config);

// Resolve topic names dynamically
const userTopic = topicManager.resolveTopicName('user.login', { userId: '123', tenant: 'acme' });
// Result: 'prod-myapp-acme-user.login-events'

const orderTopic = topicManager.resolveTopicName('order.created', { orderId: '456', priority: 'high' });
// Result: 'prod-myapp-high-priority-order.created-events'
```

### 2. Poison Message Handling & Visibility

**Problem Solved**: No visibility into poison messages (invalid payloads, unacknowledged for too long, etc.)

**Solution**: Comprehensive poison message tracking with retry logic, dead letter topics, and detailed metrics.

#### Key Features:
- **Poison message tracking**: Comprehensive tracking of failed messages
- **Configurable max retry**: Set retry limits per event type
- **Dead letter topic**: Automatic routing of failed messages
- **Poison message metrics**: Detailed metrics for monitoring
- **Alerting system**: Notify when poison message thresholds are exceeded

#### Usage Example:

```typescript
import { PoisonMessageMonitor, PoisonMessageConfig } from '@logistically/events';

const poisonConfig: PoisonMessageConfig = {
  enabled: true,
  maxRetries: 3,
  deadLetterTopic: 'dead-letter-events',
  retryDelayMs: 1000,
  retryBackoff: 'exponential',
  poisonMessageHandlers: {
    onPoisonMessage: (message) => {
      console.warn(`Poison message detected: ${message.eventType} in ${message.topic}`);
    },
    onMaxRetriesExceeded: (message) => {
      console.error(`Message exceeded max retries: ${message.id} in ${message.topic}`);
    }
  }
};

const poisonMonitor = new PoisonMessageMonitor(redis, poisonConfig);

// Track a failed message
await poisonMonitor.trackFailedMessage(
  'msg-123',
  'user-events',
  'my-consumer-group',
  'user.login',
  { userId: '123', action: 'login' },
  new Error('Database connection failed')
);

// Get poison message statistics
const stats = poisonMonitor.getPoisonMessageStats();
console.log('Poison message stats:', stats);
```

### 3. Enhanced Consumer Group Management

**Problem Solved**: Manual consumer group creation required, no automatic setup, no PEL reprocessing after failover.

**Solution**: Automatic consumer group creation, validation, and failover recovery with PEL reprocessing.

#### Key Features:
- **Auto-create consumer groups**: Configurable automatic group creation
- **Group naming strategy**: Flexible naming conventions
- **Group validation**: Ensure groups exist before consumption
- **PEL reprocessing after failover**: Handle unacknowledged messages after failover
- **Poison queue support**: Configurable max retry + DLQ topic

#### Usage Example:

```typescript
import { ConsumerGroupManager, ConsumerGroupConfig } from '@logistically/events';

const groupConfig: ConsumerGroupConfig = {
  autoCreateGroup: true,
  groupNamingStrategy: 'service-name',
  groupValidation: true,
  resumeUnackedMessages: 'only-if-stale',
  staleMessageThreshold: 300000, // 5 minutes
  poisonQueue: {
    enabled: true,
    maxRetries: 3,
    deadLetterTopic: 'dead-letter-events',
    retryDelayMs: 1000
  }
};

const groupManager = new ConsumerGroupManager(redis, groupConfig);

// Ensure consumer group exists
const groupName = groupManager.getConsumerGroupName('user-events', 'user-service');
await groupManager.ensureConsumerGroup('user-events', groupName);

// Handle failover recovery
await groupManager.handleFailoverRecovery('user-events', groupName);

// Get consumer group info
const groupInfo = await groupManager.getConsumerGroupInfo('user-events', groupName);
console.log('Consumer group info:', groupInfo);
```

### 4. Configurable Trim Strategy with Warning System

**Problem Solved**: No built-in topic trimming, leading to unbounded memory growth.

**Solution**: Automatic trimming with configurable strategies and comprehensive warning system.

#### Key Features:
- **Automatic trimming**: Configurable MAXLEN strategy
- **Manual trimming**: XTRIM operations with configurable parameters
- **Trim events**: Events triggered when trimming occurs
- **Memory monitoring**: Built-in memory usage tracking
- **Warning system**: Alert when trimming is ineffective

#### Usage Example:

```typescript
import { TopicTrimManager, TrimStrategy } from '@logistically/events';

const trimConfig: TrimStrategy = {
  enabled: true,
  maxLength: 10000,
  trimPolicy: 'minid',
  trimThreshold: 0.8, // Trim when 80% full
  trimBatchSize: 1000,
  trimInterval: 60000, // 1 minute
  trimOnPublish: true,
  warnings: {
    ineffectiveTrimThreshold: 0.5,
    onIneffectiveTrim: (topic, before, after) => {
      console.warn(`Ineffective trimming on ${topic}: ${before} -> ${after}`);
    }
  }
};

const trimManager = new TopicTrimManager(redis, trimConfig);

// Check and trim if needed
await trimManager.checkAndTrim('user-events');

// Start periodic trimming
trimManager.startPeriodicTrimming('user-events');

// Get topic length stats
const stats = await trimManager.getTopicLengthStats('user-events');
console.log('Topic length stats:', stats);

// Manual trim
await trimManager.manualTrim('user-events', 5000, 'maxlen');
```

## 🔧 Integration with Existing Architecture

All roadmap features are designed to work seamlessly with the existing topic-based architecture:

### Enhanced Publisher Integration

```typescript
import { createEnhancedPublisher } from '@logistically/events';

const publisher = createEnhancedPublisher({
  transport: {
    type: 'redis',
    options: { redis }
  },
  defaultTopic: 'my-events',
  enablePatternRouting: true,
  partitionKeyExtractor: (event) => event.userId || event.orderId
});

// Publish with dynamic topic resolution
const userEvent = { userId: '123', action: 'login', tenant: 'acme' };
const topic = topicManager.resolveTopicName('user.login', userEvent);
await publisher.publish(topic, userEvent);
```

### Enhanced Consumer Integration

```typescript
import { createEnhancedConsumer } from '@logistically/events';

const consumer = createEnhancedConsumer({
  transport: {
    type: 'redis',
    options: { redis }
  },
  consumerId: 'my-consumer',
  groupId: 'my-consumer-group',
  autoOffsetReset: 'earliest',
  enableAutoCommit: true,
  autoCommitInterval: 5000,
  enablePatternRouting: true,
  poisonMessageHandler: async (message, error) => {
    await poisonMonitor.trackFailedMessage(
      message.id,
      message.topic,
      'my-consumer-group',
      message.eventType,
      message.payload,
      error,
      message.metadata
    );
  }
});

// Subscribe with automatic group management
await consumer.subscribe('user-events', async (event, metadata) => {
  console.log('Received user event:', event);
});
```

## 📊 Monitoring and Observability

### Topic Warnings

```typescript
// Get warning history
const warnings = topicManager.getWarningHistory();
console.log('Topic warnings:', warnings);

// Check specific warning types
const securityWarnings = warnings.filter(w => w.type === 'security_violation');
const lengthWarnings = warnings.filter(w => w.type === 'topic_length');
```

### Poison Message Statistics

```typescript
// Get comprehensive poison message stats
const stats = poisonMonitor.getPoisonMessageStats();
console.log('Total poison messages:', stats.totalPoisonMessages);
console.log('Messages by event type:', stats.messagesByEventType);
console.log('Average retry count:', stats.averageRetryCount);
console.log('Retry distribution:', stats.retryDistribution);
```

### Consumer Group Monitoring

```typescript
// Get consumer group information
const groupInfo = await groupManager.getConsumerGroupInfo('user-events', 'user-service-user-events-group');
console.log('Consumers:', groupInfo[0]?.consumers);
console.log('Pending messages:', groupInfo[0]?.pending);
console.log('Lag:', groupInfo[0]?.lag);
```

### Trim Monitoring

```typescript
// Get trim events
const trimEvents = trimManager.getTrimEvents('user-events');
console.log('Trim events:', trimEvents);

// Get memory stats
const memoryStats = await trimManager.getMemoryStats('user-events');
console.log('Memory usage:', memoryStats.memoryUsagePercentage + '%');
```

## 🚀 Production Deployment

### Configuration Best Practices

1. **Topic Configuration**:
   - Use environment-specific isolation
   - Implement strict security controls
   - Set appropriate warning thresholds

2. **Poison Message Handling**:
   - Configure appropriate retry limits
   - Set up dead letter topic monitoring
   - Implement alerting for poison message thresholds

3. **Consumer Group Management**:
   - Enable automatic group creation
   - Configure failover recovery strategies
   - Set up group cleanup schedules

4. **Trim Strategy**:
   - Configure appropriate max lengths
   - Set up periodic trimming
   - Monitor trim effectiveness

### Monitoring Setup

```typescript
// Comprehensive monitoring setup
const monitoring = {
  topicWarnings: topicManager.getWarningHistory(),
  poisonStats: poisonMonitor.getPoisonMessageStats(),
  trimEvents: trimManager.getTrimEvents(),
  groupInfo: await groupManager.getConsumerGroupInfo('user-events', 'user-service-user-events-group')
};

// Alert on critical conditions
if (monitoring.poisonStats.totalPoisonMessages > 100) {
  console.error('High number of poison messages detected!');
}

if (monitoring.topicWarnings.length > 10) {
  console.warn('Multiple topic warnings detected!');
}
```

## 🔄 Migration Guide

### From Basic Usage to Enhanced Features

1. **Add Topic Configuration**:
   ```typescript
   // Before
   await publisher.publish('user-events', event);
   
   // After
   const topic = topicManager.resolveTopicName('user.login', event);
   await publisher.publish(topic, event);
   ```

2. **Add Poison Message Handling**:
   ```typescript
   // Before
   await consumer.subscribe('user-events', handler);
   
   // After
   await consumer.subscribe('user-events', handler, {
     poisonMessageHandler: async (message, error) => {
       await poisonMonitor.trackFailedMessage(/* ... */);
     }
   });
   ```

3. **Add Consumer Group Management**:
   ```typescript
   // Before
   const consumer = createConsumer({ groupId: 'my-group' });
   
   // After
   const groupName = groupManager.getConsumerGroupName('user-events', 'user-service');
   await groupManager.ensureConsumerGroup('user-events', groupName);
   const consumer = createConsumer({ groupId: groupName });
   ```

4. **Add Trim Strategy**:
   ```typescript
   // Before
   // No trimming
   
   // After
   trimManager.startPeriodicTrimming('user-events');
   await trimManager.trimOnPublish('user-events');
   ```

## 📈 Performance Considerations

- **Topic Resolution Caching**: Topic names are cached for performance
- **Batch Operations**: Trim operations are batched for efficiency
- **Lazy Loading**: Consumer group info is loaded on-demand
- **Memory Management**: Trim events are limited to prevent memory leaks

## 🔒 Security Features

- **Topic Validation**: Prevents publishing to unauthorized topics
- **Multi-tenant Isolation**: Automatic tenant-based topic separation
- **Pattern-based Security**: Regex patterns for topic name validation
- **Access Control**: Allowed/denied topic lists

## 🎯 Next Steps

These implementations provide a solid foundation for production-ready event-driven applications. Future enhancements could include:

1. **Redis Cluster Support**: Enhanced failover and cluster management
2. **Advanced Monitoring**: Integration with external monitoring systems
3. **Performance Optimization**: Further caching and optimization strategies
4. **Additional Transport Support**: Kafka, RabbitMQ, etc.

## 📚 Additional Resources

- [Roadmap Features Example](./examples/roadmap-features-example.ts)
- [Enhanced Usage Example](./examples/enhanced-usage.ts)
- [API Documentation](./docs/)
- [Performance Benchmarks](./benchmarks/)
