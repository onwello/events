# Quick Start Guide

Get up and running with the event publishing library in minutes.

## Installation

```bash
npm install @logistically/events ioredis
```

## Basic Usage

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
      maxSize: 50,           // Max 50 messages per batch
      maxWaitMs: 1000,       // Flush after 1 second
      maxConcurrentBatches: 3, // Max 3 concurrent batches
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

// Create validator
const eventValidator = new DefaultEventValidator({
  'user.created': UserCreatedSchema,
  'user.updated': UserUpdatedSchema
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

### Route Different Event Types to Different Streams

```typescript
const routingConfig = {
  default: 'redis',
  routes: [
    // User events to user stream
    { pattern: 'user.*', transport: 'redis', prefix: 'user-events:' },
    
    // Order events to order stream
    { pattern: 'order.*', transport: 'redis', prefix: 'order-events:' },
    
    // Payment events to payment stream with high priority
    { pattern: 'payment.*', transport: 'redis', prefix: 'payment-events:', priority: 'high' },
    
    // Audit events to audit stream
    { pattern: 'audit.*', transport: 'redis', prefix: 'audit-events:' }
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

// These will go to different streams
await publisher.publish('user.created', { userId: '123' });
await publisher.publish('order.created', { orderId: '456' });
await publisher.publish('payment.processed', { paymentId: '789' });
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

### Batch Processing with Related Events

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

## Error Handling

### Handle Failed Messages

```typescript
// Add messages
await batchedPublisher.addMessage('user.created', { userId: '1' });
await batchedPublisher.addMessage('user.created', { userId: '2' });

// Flush and check for errors
await batchedPublisher.flush();

const failedMessages = batchedPublisher.getFailedMessages();
if (failedMessages.length > 0) {
  console.error('Failed messages:', failedMessages);
  
  // Retry failed messages
  for (const message of failedMessages) {
    try {
      await batchedPublisher.addMessage(message.eventType, message.body);
    } catch (error) {
      console.error('Retry failed:', error);
    }
  }
  
  // Clear failed messages
  batchedPublisher.clearFailedMessages();
}
```

### Concurrent Batch Limits

```typescript
const batchedPublisher = new BatchedEventPublisher(
  { redis: redisClient },
  {
    originServiceName: 'user-service',
    batchConfig: {
      maxConcurrentBatches: 1 // Only one batch at a time
    }
  }
);

try {
  await batchedPublisher.addMessage('user.created', { userId: '1' });
} catch (error) {
  if (error.message === 'Too many concurrent batches') {
    console.log('Waiting for current batch to complete...');
    await batchedPublisher.flush();
    await batchedPublisher.addMessage('user.created', { userId: '1' });
  }
}
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

## Next Steps

1. **Read the [API Documentation](./API.md)** for detailed information about all classes and methods
2. **Check the [Troubleshooting Guide](./TROUBLESHOOTING.md)** if you encounter any issues
3. **Review the [README](./README.md)** for comprehensive usage examples and best practices
4. **Explore the test files** in the repository for more examples

## Common Patterns

### Batch Processing with Error Recovery

```typescript
async function processUserEvents(users: User[]) {
  const batchSize = 50;
  
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    
    // Add all users in batch
    for (const user of batch) {
      await batchedPublisher.addMessage('user.created', user);
    }
    
    // Flush and handle errors
    await batchedPublisher.flush();
    
    const failedMessages = batchedPublisher.getFailedMessages();
    if (failedMessages.length > 0) {
      console.error(`Batch ${i / batchSize + 1} had ${failedMessages.length} failures`);
      // Handle failed messages (retry, log, etc.)
    }
  }
}
```

### Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  
  // Flush all pending batches
  await batchedPublisher.flush();
  
  // Handle any remaining failed messages
  const failedMessages = batchedPublisher.getFailedMessages();
  if (failedMessages.length > 0) {
    console.log(`Saving ${failedMessages.length} failed messages`);
    // Save to persistent storage
  }
  
  process.exit(0);
});
```

### Health Monitoring

```typescript
setInterval(() => {
  const failedMessages = batchedPublisher.getFailedMessages();
  if (failedMessages.length > 100) {
    console.warn(`High number of failed messages: ${failedMessages.length}`);
  }
}, 60000); // Check every minute
```
