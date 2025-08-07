# Event Publishing & Consumption Library

[![CI](https://github.com/onwello/events/workflows/CI/badge.svg)](https://github.com/onwello/events/actions)
[![npm version](https://badge.fury.io/js/%40logistically%2Fevents.svg)](https://badge.fury.io/js/%40logistically%2Fevents)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A production-ready event-driven architecture library with Redis Streams, comprehensive batching, reliable consumption, and enterprise-grade features.

## Features

- **🚀 High-Performance Publishing**: Batched publishing with configurable limits and strategies
- **📡 Redis Streams Support**: Reliable event streaming with consumer groups and dead-letter queues
- **🔄 Event Consumption**: Robust consumer with idempotency, retry logic, and error handling
- **⚡ Concurrent Processing**: Configurable concurrent batch limits and consumer parallelism
- **🛡️ Error Resilience**: Failed message tracking, retry mechanisms, and graceful degradation
- **📊 Observability**: Built-in metrics, logging, and monitoring capabilities
- **🔧 TypeScript First**: Full type safety with comprehensive interfaces
- **🏗️ Enterprise Ready**: Production-tested with large-scale deployments

## Installation

```bash
npm install @logistically/events ioredis
```

## Quick Start

### 1. Event Publisher Setup

```typescript
import { EventPublisher, createRedisStreamsClient } from '@logistically/events';

// Create Redis client
const redisClient = createRedisStreamsClient({
  host: 'localhost',
  port: 6379,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3
});

// Create publisher with validation
const publisher = new EventPublisher(
  { redis: redisClient },
  { 
    originServiceName: 'user-service',
    validator: userEventValidator 
  }
);

// Publish events
await publisher.publish('user.created', { 
  userId: '123', 
  name: 'John Doe',
  email: 'john@example.com' 
});
```

### 2. Batched Event Publisher

```typescript
import { BatchedEventPublisher } from '@logistically/events';

const batchedPublisher = new BatchedEventPublisher(
  { redis: redisClient },
  {
    originServiceName: 'user-service',
    validator: userEventValidator,
    batchConfig: {
      maxSize: 100,           // Max messages per batch
      maxWaitMs: 1000,        // Flush after 1 second
      maxConcurrentBatches: 5, // Max concurrent batches
      batchingTypeStrategy: 'exact'
    }
  }
);

// Add messages to batch
await batchedPublisher.addMessage('user.created', { userId: '1', name: 'John' });
await batchedPublisher.addMessage('user.updated', { userId: '2', email: 'jane@example.com' });

// Flush to send all pending messages
await batchedPublisher.flush();
```

### 3. Event Consumer Setup

```typescript
import { RedisStreamsServer } from '@logistically/events';

// Create consumer server
const consumer = new RedisStreamsServer({
  host: 'localhost',
  port: 6379,
  stream: 'user-events',
  group: 'user-processors',
  consumer: 'worker-1',
  blockMs: 1000,
  batchSize: 10,
  retryAttempts: 3
});

// Register event handlers
consumer.addHandler('user.created', async (body, header) => {
  console.log('Processing user creation:', body);
  console.log('Event ID:', header.id);
  console.log('Event hash:', header.hash); // For idempotency
  
  // Your business logic here
  await createUser(body);
});

consumer.addHandler('user.updated', async (body, header) => {
  console.log('Processing user update:', body);
  
  // Your business logic here
  await updateUser(body.userId, body.changes);
});

// Start consuming events
await consumer.listen();
```

## Configuration

### Event Publisher Configuration

```typescript
interface EventPublisherOptions {
  originServiceName: string;           // Service name for event routing
  validator?: EventValidator;          // Event validation
  eventNamespace?: string;             // Event namespace
  routingConfig?: RoutingConfig;       // Custom routing rules
}
```

### Batched Publisher Configuration

```typescript
interface BatchedEventPublisherOptions extends EventPublisherOptions {
  batchConfig?: BatchConfig;
  transportType?: TransportType;       // 'redis' | 'console'
  typePrefix?: string;                 // Event type prefix
  batchingTypeStrategy?: BatchingTypeStrategy; // 'exact' | '0' | '1'
}

interface BatchConfig {
  maxSize: number;                     // Max messages per batch
  maxWaitMs: number;                   // Max wait time before flushing
  maxConcurrentBatches: number;        // Max concurrent batches
  batchingTypeStrategy: BatchingTypeStrategy;
}
```

### Consumer Configuration

```typescript
interface RedisStreamsServerConfig {
  host: string;
  port: number;
  stream: string;                      // Redis stream name
  group: string;                       // Consumer group name
  consumer: string;                    // Consumer instance name
  blockMs?: number;                    // Block timeout (default: 1000)
  batchSize?: number;                  // Messages per batch (default: 10)
  retryAttempts?: number;              // Retry attempts (default: 3)
  deadLetterStream?: string;           // Dead letter stream
  maxPendingMessages?: number;         // Max pending messages
  autoAck?: boolean;                   // Auto acknowledge (default: true)
}
```

## Event Validation

### Schema-Based Validation

```typescript
import { z } from 'zod';
import { DefaultEventValidator } from '@logistically/events';

// Define event schemas
const UserCreatedSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string().datetime()
});

const UserUpdatedSchema = z.object({
  userId: z.string(),
  changes: z.record(z.string(), z.any()),
  updatedBy: z.string(),
  updatedAt: z.string().datetime()
});

const OrderCreatedSchema = z.object({
  orderId: z.string(),
  customerId: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
    price: z.number().positive()
  })),
  total: z.number().positive()
});

// Create validator
const eventValidator = new DefaultEventValidator({
  'user.created': UserCreatedSchema,
  'user.updated': UserUpdatedSchema,
  'order.created': OrderCreatedSchema
});

const publisher = new EventPublisher(
  { redis: redisClient },
  { 
    originServiceName: 'user-service',
    validator: eventValidator 
  }
);
```

### Custom Validation

```typescript
import { EventValidator } from '@logistically/events';

const customValidator: EventValidator = {
  validate: (eventType: string, body: any) => {
    // Business logic validation
    if (eventType === 'user.created') {
      if (!body.userId || !body.email) {
        return { valid: false, error: 'userId and email are required' };
      }
      
      // Check if user already exists
      if (await userExists(body.userId)) {
        return { valid: false, error: 'User already exists' };
      }
    }
    
    return { valid: true };
  },
  getSchema: (eventType: string) => {
    // Return appropriate schema
    return schemas[eventType];
  }
};
```

## Event Routing

### Advanced Routing Configuration

```typescript
const routingConfig = {
  default: 'redis',
  routes: [
    // User events to Redis with prefix
    { pattern: 'user.*', transport: 'redis', prefix: 'user-events:' },
    
    // Order events to Redis with different prefix
    { pattern: 'order.*', transport: 'redis', prefix: 'order-events:' },
    
    // Payment events to Redis with high priority
    { pattern: 'payment.*', transport: 'redis', prefix: 'payment-events:', priority: 'high' },
    
    // Audit events to separate stream
    { pattern: 'audit.*', transport: 'redis', prefix: 'audit-events:' },
    
    // Debug events to console (development only)
    ...(process.env.NODE_ENV === 'development' ? [
      { pattern: 'debug.*', transport: 'console' }
    ] : [])
  ]
};

const publisher = new EventPublisher(
  { redis: redisClient },
  { 
    originServiceName: 'my-service',
    validator: eventValidator,
    routingConfig 
  }
);
```

## Consumer Patterns

### Idempotent Event Processing

```typescript
consumer.addHandler('user.created', async (body, header) => {
  // Use event hash for idempotency
  const processed = await checkIfProcessed(header.hash);
  if (processed) {
    console.log('Event already processed, skipping');
    return;
  }
  
  try {
    // Process the event
    await createUser(body);
    
    // Mark as processed
    await markAsProcessed(header.hash);
  } catch (error) {
    console.error('Failed to process user creation:', error);
    throw error; // Will trigger retry
  }
});
```

### Batch Processing

```typescript
consumer.addHandler('order.created', async (body, header) => {
  // Process order creation
  await processOrder(body);
  
  // Publish related events
  await publisher.publish('inventory.reserved', {
    orderId: body.orderId,
    items: body.items
  });
  
  await publisher.publish('notification.sent', {
    userId: body.customerId,
    type: 'order_created',
    orderId: body.orderId
  });
});
```

### Error Handling and Dead Letters

```typescript
// Configure dead letter stream
const consumer = new RedisStreamsServer({
  host: 'localhost',
  port: 6379,
  stream: 'user-events',
  group: 'user-processors',
  consumer: 'worker-1',
  deadLetterStream: 'user-events-dlq',
  retryAttempts: 3
});

consumer.addHandler('user.updated', async (body, header) => {
  try {
    await updateUser(body.userId, body.changes);
  } catch (error) {
    if (error.code === 'USER_NOT_FOUND') {
      // Log and continue (don't retry)
      console.error('User not found:', body.userId);
      return;
    }
    
    // Re-throw for retry
    throw error;
  }
});
```

## Production Patterns

### Graceful Shutdown

```typescript
// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  
  // Stop accepting new events and close publishers
  await publisher.close();
  await batchedPublisher.close();
  
  // Stop consumer
  await consumer.close();
  
  // Handle any remaining failed messages
  const failedMessages = batchedPublisher.getFailedMessages();
  if (failedMessages.length > 0) {
    console.log(`Saving ${failedMessages.length} failed messages`);
    await saveFailedMessages(failedMessages);
  }
  
  process.exit(0);
});
```

### Health Monitoring

```typescript
// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check Redis connection
    await redisClient.ping();
    
    // Check consumer status
    const consumerStatus = await consumer.getStatus();
    
    // Check publisher memory stats
    const memoryStats = batchedPublisher.getMemoryStats();
    
    res.json({
      status: 'healthy',
      redis: 'connected',
      consumer: consumerStatus,
      publisher: {
        queueCount: memoryStats.queueCount,
        totalMessages: memoryStats.totalMessages,
        failedMessages: memoryStats.failedMessageCount,
        activeBatches: memoryStats.activeBatches
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});
```

### Custom Metrics Collection

```typescript
// Simple metrics collection
class EventMetrics {
  private publishedEvents = 0;
  private failedEvents = 0;
  private processedEvents = 0;
  private failedProcessing = 0;

  incrementPublished() {
    this.publishedEvents++;
  }

  incrementFailed() {
    this.failedEvents++;
  }

  incrementProcessed() {
    this.processedEvents++;
  }

  incrementFailedProcessing() {
    this.failedProcessing++;
  }

  getMetrics() {
    return {
      publishedEvents: this.publishedEvents,
      failedEvents: this.failedEvents,
      processedEvents: this.processedEvents,
      failedProcessing: this.failedProcessing,
      publishSuccessRate: this.publishedEvents / (this.publishedEvents + this.failedEvents),
      processingSuccessRate: this.processedEvents / (this.processedEvents + this.failedProcessing)
    };
  }
}

const metrics = new EventMetrics();

// Wrap publisher methods
const instrumentedPublisher = {
  publish: async (eventType: string, body: any) => {
    try {
      await publisher.publish(eventType, body);
      metrics.incrementPublished();
    } catch (error) {
      metrics.incrementFailed();
      throw error;
    }
  }
};

// Wrap consumer handlers
consumer.addHandler('user.created', async (body, header) => {
  try {
    await createUser(body);
    metrics.incrementProcessed();
  } catch (error) {
    metrics.incrementFailedProcessing();
    throw error;
  }
});

// Expose metrics endpoint
app.get('/metrics', (req, res) => {
  res.json(metrics.getMetrics());
});
```

## Complete Example

### User Service Implementation

```typescript
import { 
  BatchedEventPublisher, 
  RedisStreamsServer, 
  createRedisStreamsClient,
  DefaultEventValidator 
} from '@logistically/events';
import { z } from 'zod';

class UserService {
  private publisher: BatchedEventPublisher;
  private consumer: RedisStreamsServer;
  
  constructor() {
    const redisClient = createRedisStreamsClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    });
    
    // Define event schemas
    const UserCreatedSchema = z.object({
      userId: z.string(),
      name: z.string(),
      email: z.string().email(),
      createdAt: z.string().datetime()
    });
    
    const UserUpdatedSchema = z.object({
      userId: z.string(),
      changes: z.record(z.string(), z.any()),
      updatedBy: z.string(),
      updatedAt: z.string().datetime()
    });
    
    const validator = new DefaultEventValidator({
      'user.created': UserCreatedSchema,
      'user.updated': UserUpdatedSchema
    });
    
    // Create publisher
    this.publisher = new BatchedEventPublisher(
      { redis: redisClient },
      {
        originServiceName: 'user-service',
        validator,
        batchConfig: {
          maxSize: 100,
          maxWaitMs: 1000,
          maxConcurrentBatches: 5,
          batchingTypeStrategy: 'exact'
        }
      }
    );
    
    // Create consumer
    this.consumer = new RedisStreamsServer({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      stream: 'user-events',
      group: 'user-processors',
      consumer: `worker-${process.pid}`,
      blockMs: 1000,
      batchSize: 10,
      retryAttempts: 3,
      deadLetterStream: 'user-events-dlq'
    });
    
    this.setupEventHandlers();
  }
  
  private setupEventHandlers() {
    // Handle user creation events
    this.consumer.addHandler('user.created', async (body, header) => {
      console.log('Processing user creation:', body);
      
      try {
        await this.createUser(body);
        
        // Publish related events
        await this.publisher.addMessage('notification.sent', {
          userId: body.userId,
          type: 'welcome',
          email: body.email
        });
        
        await this.publisher.addMessage('audit.log', {
          action: 'user_created',
          userId: body.userId,
          actor: 'system',
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error('Failed to process user creation:', error);
        throw error; // Will trigger retry
      }
    });
    
    // Handle user update events
    this.consumer.addHandler('user.updated', async (body, header) => {
      console.log('Processing user update:', body);
      
      try {
        await this.updateUser(body.userId, body.changes);
        
        // Publish audit event
        await this.publisher.addMessage('audit.log', {
          action: 'user_updated',
          userId: body.userId,
          actor: body.updatedBy,
          changes: body.changes,
          timestamp: body.updatedAt
        });
        
      } catch (error) {
        console.error('Failed to process user update:', error);
        throw error;
      }
    });
  }
  
  async start() {
    // Start consuming events
    await this.consumer.listen();
    console.log('User service started');
  }
  
  async stop() {
    // Graceful shutdown
    await this.publisher.flush();
    await this.consumer.close();
    console.log('User service stopped');
  }
  
  // Business logic methods
  private async createUser(data: any) {
    // Implementation
  }
  
  private async updateUser(userId: string, changes: any) {
    // Implementation
  }
}

// Usage
const userService = new UserService();
await userService.start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await userService.stop();
  process.exit(0);
});
```

## API Reference

See [API Documentation](./docs/API.md) for complete API reference.

## Troubleshooting

See [Troubleshooting Guide](./docs/TROUBLESHOOTING.md) for common issues and solutions.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

MIT License - see LICENSE file for details. 