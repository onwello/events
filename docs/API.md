# API Documentation

## Table of Contents

- [EventPublisher](#eventpublisher)
- [BatchedEventPublisher](#batchedeventpublisher)
- [RedisStreamsServer](#redisstreamsserver)
- [EventValidator](#eventvalidator)
- [BatchConfig](#batchconfig)
- [Consumer Configuration](#consumer-configuration)
- [Transport Types](#transport-types)
- [Batching Strategies](#batching-strategies)
- [Error Handling](#error-handling)

## EventPublisher

The main event publishing class that handles single event publishing with routing and validation.

### Constructor

```typescript
new EventPublisher(
  transports: Record<string, any>,
  options: EventPublisherOptions
)
```

**Parameters:**
- `transports`: Object containing transport instances (e.g., `{ redis: redisClient }`)
- `options`: Configuration options for the publisher

### Methods

#### `publish<T>(eventType: string, body: T): Promise<void>`

Publishes a single event to the appropriate transport based on routing configuration.

**Parameters:**
- `eventType`: The type of event (e.g., 'user.created')
- `body`: The event payload

**Example:**
```typescript
await publisher.publish('user.created', { 
  userId: '123', 
  name: 'John Doe',
  email: 'john@example.com' 
});
```

#### `publishBatch<T>(eventType: string, bodies: T[]): Promise<void>`

Publishes multiple events of the same type immediately.

**Parameters:**
- `eventType`: The type of event
- `bodies`: Array of event payloads

**Example:**
```typescript
await publisher.publishBatch('user.created', [
  { userId: '1', name: 'John', email: 'john@example.com' },
  { userId: '2', name: 'Jane', email: 'jane@example.com' }
]);
```

### Properties

#### `validator: EventValidator`

The validator instance used for event validation.

## BatchedEventPublisher

A specialized publisher that batches events for efficient processing with configurable limits and error handling.

### Constructor

```typescript
new BatchedEventPublisher(
  transports: Record<string, any>,
  options: BatchedEventPublisherOptions
)
```

**Parameters:**
- `transports`: Object containing transport instances
- `options`: Configuration options including batch settings

### Methods

#### `addMessage<T>(eventType: string, body: T): Promise<void>`

Adds a message to the appropriate batch queue. The message will be sent when the batch is flushed.

**Parameters:**
- `eventType`: The type of event
- `body`: The event payload

**Example:**
```typescript
await batchedPublisher.addMessage('user.created', { 
  userId: '123', 
  name: 'John Doe',
  email: 'john@example.com' 
});
```

#### `flush(): Promise<void>`

Forces all pending batches to be sent immediately.

**Example:**
```typescript
await batchedPublisher.addMessage('user.created', { userId: '123' });
await batchedPublisher.flush(); // Sends the batch immediately
```

#### `publishBatch<T>(eventType: string, bodies: T[]): Promise<void>`

Publishes multiple events immediately without batching.

**Parameters:**
- `eventType`: The type of event
- `bodies`: Array of event payloads

**Example:**
```typescript
await batchedPublisher.publishBatch('user.created', [
  { userId: '1', name: 'John' },
  { userId: '2', name: 'Jane' }
]);
```

#### `getFailedMessages(): BatchMessage[]`

Returns an array of messages that failed to be sent.

**Returns:** Array of failed messages with their original data

**Example:**
```typescript
const failedMessages = batchedPublisher.getFailedMessages();
if (failedMessages.length > 0) {
  console.log('Failed messages:', failedMessages);
}
```

#### `clearFailedMessages(): void`

Clears the list of failed messages.

**Example:**
```typescript
batchedPublisher.clearFailedMessages();
```

### Properties

#### `validator: EventValidator`

The validator instance used for event validation.

## RedisStreamsServer

A robust Redis Streams consumer with support for consumer groups, dead-letter queues, and idempotent processing.

### Constructor

```typescript
new RedisStreamsServer(config: RedisStreamsServerConfig)
```

**Parameters:**
- `config`: Configuration for the Redis Streams consumer

### Methods

#### `addHandler(eventType: string, handler: EventHandler): void`

Registers an event handler for a specific event type.

**Parameters:**
- `eventType`: The type of event to handle
- `handler`: The handler function

**Example:**
```typescript
consumer.addHandler('user.created', async (body, header) => {
  console.log('Processing user creation:', body);
  console.log('Event ID:', header.id);
  console.log('Event hash:', header.hash); // For idempotency
  
  // Your business logic here
  await createUser(body);
});
```

#### `listen(): Promise<void>`

Starts consuming events from the Redis stream.

**Example:**
```typescript
await consumer.listen();
console.log('Consumer started');
```

#### `close(): Promise<void>`

Gracefully shuts down the consumer.

**Example:**
```typescript
await consumer.close();
console.log('Consumer stopped');
```

#### `getStatus(): Promise<ConsumerStatus>`

Returns the current status of the consumer.

**Returns:** Consumer status including pending messages, lag, etc.

**Example:**
```typescript
const status = await consumer.getStatus();
console.log('Pending messages:', status.pendingMessages);
console.log('Consumer lag:', status.lag);
```

### Event Handler Signature

```typescript
type EventHandler = (body: any, header: EventHeader) => Promise<void>;

interface EventHeader {
  id: string;           // Unique event identifier
  type: string;         // Event type
  origin: string;       // Source service name
  timestamp: string;    // ISO timestamp
  hash: string;         // SHA-256 hash for idempotency
  version: string;      // Schema version
}
```

## EventValidator

Interface for event validation. Implement this interface to provide custom validation logic.

### Interface

```typescript
interface EventValidator {
  validate(eventType: string, body: any): ValidationResult;
  getSchema(eventType: string): any;
}
```

### Methods

#### `validate(eventType: string, body: any): ValidationResult`

Validates an event body against the schema for the given event type.

**Parameters:**
- `eventType`: The type of event to validate
- `body`: The event payload to validate

**Returns:** `ValidationResult` object with validation status and error details

**Example:**
```typescript
const validator: EventValidator = {
  validate: (eventType: string, body: any) => {
    if (eventType === 'user.created') {
      if (!body.userId) {
        return { valid: false, error: 'userId is required' };
      }
      if (!body.email) {
        return { valid: false, error: 'email is required' };
      }
    }
    return { valid: true };
  },
  getSchema: (eventType: string) => {
    // Return schema for the event type
    return schemas[eventType];
  }
};
```

#### `getSchema(eventType: string): any`

Returns the schema for the given event type.

**Parameters:**
- `eventType`: The type of event

**Returns:** Schema object for the event type

## BatchConfig

Configuration for batch processing behavior.

### Interface

```typescript
interface BatchConfig {
  maxSize: number;                     // Maximum messages per batch
  maxWaitMs: number;                   // Maximum wait time before flushing
  maxConcurrentBatches: number;        // Maximum concurrent batches
  batchingTypeStrategy: BatchingTypeStrategy;
}
```

### Properties

- `maxSize`: Maximum number of messages that can be in a single batch
- `maxWaitMs`: Maximum time to wait before automatically flushing a batch
- `maxConcurrentBatches`: Maximum number of batches that can be processed simultaneously
- `batchingTypeStrategy`: Strategy for determining how events are batched together

### Example

```typescript
const batchConfig: BatchConfig = {
  maxSize: 100,           // Max 100 messages per batch
  maxWaitMs: 1000,        // Flush after 1 second
  maxConcurrentBatches: 5, // Max 5 concurrent batches
  batchingTypeStrategy: 'exact'
};
```

## Consumer Configuration

### RedisStreamsServerConfig

```typescript
interface RedisStreamsServerConfig {
  host: string;
  port: number;
  password?: string;
  stream: string;                      // Redis stream name
  group: string;                       // Consumer group name
  consumer: string;                    // Consumer instance name
  blockMs?: number;                    // Block timeout (default: 1000)
  batchSize?: number;                  // Messages per batch (default: 10)
  retryAttempts?: number;              // Retry attempts (default: 3)
  deadLetterStream?: string;           // Dead letter stream
  maxPendingMessages?: number;         // Max pending messages
  autoAck?: boolean;                   // Auto acknowledge (default: true)
  retryDelayMs?: number;               // Delay between retries (default: 1000)
  maxRetryDelayMs?: number;            // Max retry delay (default: 30000)
}
```

### Consumer Status

```typescript
interface ConsumerStatus {
  isConnected: boolean;
  pendingMessages: number;
  lag: number;                         // Messages behind
  lastProcessedId?: string;
  errorCount: number;
  retryCount: number;
}
```

## Transport Types

### Redis Streams Transport

```typescript
import { createRedisStreamsClient } from '@logistically/events';

const redisClient = createRedisStreamsClient({
  host: 'localhost',
  port: 6379,
  password: 'your-password',
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  connectTimeout: 10000,
  commandTimeout: 5000
});
```

### Console Transport (Development Only)

```typescript
import { ConsoleClientProxy } from '@logistically/events';

const consoleTransport = new ConsoleClientProxy();
```

## Batching Strategies

### Exact Strategy

Batches events with exactly the same event type.

```typescript
const config: BatchConfig = {
  batchingTypeStrategy: 'exact'
};

// Only 'user.created' events will be batched together
await publisher.addMessage('user.created', { userId: '1' });
await publisher.addMessage('user.created', { userId: '2' });
// These will be in the same batch
```

### Position-Based Strategy

Batches events based on a specific position in the event type.

```typescript
const config: BatchConfig = {
  batchingTypeStrategy: '0' // Batch by first token
};

// 'user.created' and 'user.updated' will be batched together
await publisher.addMessage('user.created', { userId: '1' });
await publisher.addMessage('user.updated', { userId: '2' });
// These will be in the same batch because they share 'user' at position 0
```

## Error Handling

### Failed Message Structure

```typescript
interface BatchMessage {
  eventType: string;
  body: any;
  originalId: string;
  timestamp: string;
  envelope: EventEnvelope;
}
```

### Error Handling Example

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
  
  // Clear the failed messages list
  batchedPublisher.clearFailedMessages();
}
```

### Consumer Error Handling

```typescript
consumer.addHandler('user.created', async (body, header) => {
  try {
    // Use event hash for idempotency
    const processed = await checkIfProcessed(header.hash);
    if (processed) {
      console.log('Event already processed, skipping');
      return;
    }
    
    // Process the event
    await createUser(body);
    
    // Mark as processed
    await markAsProcessed(header.hash);
  } catch (error) {
    console.error('Failed to process user creation:', error);
    
    // Re-throw for retry (will go to dead letter after max retries)
    throw error;
  }
});
```

### Concurrent Batch Limit Errors

When the concurrent batch limit is exceeded, the publisher will throw an error:

```typescript
try {
  await batchedPublisher.addMessage('user.created', { userId: '1' });
} catch (error) {
  if (error.message === 'Too many concurrent batches') {
    // Handle the error - wait and retry, or reduce batch limits
    console.error('Concurrent batch limit exceeded');
    await batchedPublisher.flush(); // Wait for current batches
    await batchedPublisher.addMessage('user.created', { userId: '1' });
  }
}
```

## Event Envelope Structure

All events are published with an envelope structure:

```typescript
interface EventEnvelope {
  header: {
    id: string;           // Unique event identifier
    type: string;         // Event type with namespace
    origin: string;       // Source service name
    timestamp: string;    // ISO timestamp
    hash: string;         // SHA-256 hash for idempotency
    version: string;      // Schema version
  };
  body: any;             // Event payload
}
```

## Configuration Options

### EventPublisherOptions

```typescript
interface EventPublisherOptions {
  originServiceName: string;           // Service name for event routing
  validator?: EventValidator;          // Event validation
  eventNamespace?: string;             // Event namespace
  routingConfig?: RoutingConfig;       // Custom routing rules
}
```

### BatchedEventPublisherOptions

```typescript
interface BatchedEventPublisherOptions extends EventPublisherOptions {
  batchConfig?: BatchConfig;
  transportType?: TransportType;       // 'redis' | 'console'
  typePrefix?: string;                 // Event type prefix
  batchingTypeStrategy?: BatchingTypeStrategy; // 'exact' | '0' | '1'
}
```

### RoutingConfig

```typescript
interface RoutingConfig {
  default: string;                     // Default transport
  routes: RouteConfig[];               // Route configurations
}

interface RouteConfig {
  pattern: string;                     // Event pattern (e.g., 'user.*')
  transport: string;                   // Transport name
  prefix?: string;                     // Event prefix
  priority?: 'high' | 'normal' | 'low'; // Priority level
}
```

## Type Definitions

### BatchingTypeStrategy

```typescript
type BatchingTypeStrategy = 'exact' | '0' | '1';
```

### TransportType

```typescript
type TransportType = 'redis' | 'console';
```

### ValidationResult

```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
}
```

### EventHandler

```typescript
type EventHandler = (body: any, header: EventHeader) => Promise<void>;
```

## Production Patterns

### Idempotent Processing

```typescript
consumer.addHandler('order.created', async (body, header) => {
  // Check if already processed
  const processed = await checkIfProcessed(header.hash);
  if (processed) {
    console.log('Order already processed:', header.id);
    return;
  }
  
  try {
    // Process order
    await processOrder(body);
    
    // Mark as processed
    await markAsProcessed(header.hash);
  } catch (error) {
    console.error('Failed to process order:', error);
    throw error; // Will trigger retry
  }
});
```

### Dead Letter Queue Handling

```typescript
// Configure consumer with dead letter queue
const consumer = new RedisStreamsServer({
  host: 'localhost',
  port: 6379,
  stream: 'order-events',
  group: 'order-processors',
  consumer: 'worker-1',
  deadLetterStream: 'order-events-dlq',
  retryAttempts: 3
});

// Process dead letter messages
const dlqConsumer = new RedisStreamsServer({
  host: 'localhost',
  port: 6379,
  stream: 'order-events-dlq',
  group: 'dlq-processors',
  consumer: 'dlq-worker-1'
});

dlqConsumer.addHandler('*', async (body, header) => {
  console.error('Dead letter message:', { body, header });
  // Log, alert, or manually process
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
    
    // Check failed messages
    const failedMessages = batchedPublisher.getFailedMessages();
    
    res.json({
      status: 'healthy',
      redis: 'connected',
      consumer: consumerStatus,
      failedMessages: failedMessages.length
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
