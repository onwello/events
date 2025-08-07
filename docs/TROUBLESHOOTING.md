# Troubleshooting Guide

This guide covers common issues you might encounter when using the event publishing library and how to resolve them.

## Table of Contents

- [Common Issues](#common-issues)
- [Performance Issues](#performance-issues)
- [Error Handling](#error-handling)
- [Debugging](#debugging)
- [Best Practices](#best-practices)

## Common Issues

### 1. "Too many concurrent batches" Error

**Problem:** You're getting an error when trying to add messages to a batched publisher.

**Cause:** The number of concurrent batches has exceeded the configured limit.

**Solutions:**

```typescript
// Increase the concurrent batch limit
const batchedPublisher = new BatchedEventPublisher(
  { redis: redisClient },
  {
    originServiceName: 'my-service',
    batchConfig: {
      maxConcurrentBatches: 10, // Increase from default 5
      // ... other config
    }
  }
);

// Or wait for existing batches to complete
await batchedPublisher.flush(); // Wait for current batches
await batchedPublisher.addMessage('user.created', { userId: '123' });
```

### 2. Failed Messages Not Being Tracked

**Problem:** Failed messages are not appearing in `getFailedMessages()`.

**Cause:** The batch is succeeding but individual messages are failing, or there's a timing issue.

**Solutions:**

```typescript
// Wait for async processing to complete
await batchedPublisher.flush();
await new Promise(resolve => setTimeout(resolve, 100)); // Wait for async processing

const failedMessages = batchedPublisher.getFailedMessages();
console.log('Failed messages:', failedMessages);
```

### 3. Events Not Being Published

**Problem:** Events are not appearing in your transport (Redis, console, etc.).

**Cause:** Transport configuration, routing issues, or validation failures.

**Solutions:**

```typescript
// Check transport configuration
const publisher = new EventPublisher(
  { redis: redisClient }, // Ensure transport is properly configured
  { 
    originServiceName: 'my-service',
    validator: myValidator 
  }
);

// Check routing configuration
const routingConfig = {
  default: 'console',
  routes: [
    { pattern: 'user.*', transport: 'redis', prefix: 'user-events:' }
  ]
};

// Add error handling
try {
  await publisher.publish('user.created', { userId: '123' });
} catch (error) {
  console.error('Publish failed:', error);
}
```

### 4. Validation Errors

**Problem:** Events are being rejected due to validation failures.

**Cause:** Event payload doesn't match the expected schema.

**Solutions:**

```typescript
// Check your validator implementation
const validator: EventValidator = {
  validate: (eventType: string, body: any) => {
    console.log('Validating:', eventType, body); // Add logging
    
    if (eventType === 'user.created') {
      if (!body.userId) {
        return { valid: false, error: 'userId is required' };
      }
    }
    return { valid: true };
  },
  getSchema: (eventType: string) => {
    // Return appropriate schema
    return schema;
  }
};
```

## Performance Issues

### 1. Slow Batch Processing

**Problem:** Batches are taking too long to process.

**Solutions:**

```typescript
// Optimize batch configuration
const batchConfig: BatchConfig = {
  maxSize: 50,        // Reduce batch size for faster processing
  maxWaitMs: 500,     // Reduce wait time
  maxConcurrentBatches: 3, // Reduce concurrent batches
  batchingTypeStrategy: 'exact'
};

// Use appropriate batching strategy
const strategy = 'exact'; // For events that should be processed together
// or '0' for related events
```

### 2. High Memory Usage

**Problem:** The application is using too much memory.

**Solutions:**

```typescript
// Reduce batch sizes
const batchConfig: BatchConfig = {
  maxSize: 25,        // Smaller batches
  maxWaitMs: 200,     // Flush more frequently
  maxConcurrentBatches: 2, // Fewer concurrent batches
  batchingTypeStrategy: 'exact'
};

// Clear failed messages regularly
setInterval(() => {
  const failedMessages = batchedPublisher.getFailedMessages();
  if (failedMessages.length > 100) {
    console.warn('Too many failed messages, clearing');
    batchedPublisher.clearFailedMessages();
  }
}, 60000); // Check every minute
```

### 3. Network Timeouts

**Problem:** Network operations are timing out.

**Solutions:**

```typescript
// Configure transport timeouts
const redisClient = createRedisStreamsClient({
  host: 'localhost',
  port: 6379,
  connectTimeout: 10000,    // 10 seconds
  commandTimeout: 5000,     // 5 seconds
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3
});

// Add retry logic
const publishWithRetry = async (eventType: string, body: any, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await publisher.publish(eventType, body);
      return;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
};
```

### 4. Memory Management Issues

**Problem:** High memory usage or memory leaks.

**Solutions:**

```typescript
// Monitor memory usage
const memoryStats = batchedPublisher.getMemoryStats();
console.log('Memory stats:', memoryStats);

// Cleanup old failed messages
batchedPublisher.cleanupOldFailedMessages(3600000); // 1 hour

// Force cleanup of all resources
batchedPublisher.cleanup();

// Regular memory monitoring
setInterval(() => {
  const stats = batchedPublisher.getMemoryStats();
  if (stats.failedMessageCount > 100) {
    console.warn('High number of failed messages:', stats.failedMessageCount);
    batchedPublisher.clearFailedMessages();
  }
  if (stats.queueCount > 50) {
    console.warn('High number of queues:', stats.queueCount);
  }
}, 60000); // Check every minute
```

## Error Handling

### 1. Handling Failed Messages

```typescript
// Comprehensive failed message handling
const handleFailedMessages = async (publisher: BatchedEventPublisher) => {
  const failedMessages = publisher.getFailedMessages();
  
  if (failedMessages.length > 0) {
    console.error(`Found ${failedMessages.length} failed messages`);
    
    // Group by event type for batch retry
    const groupedMessages = failedMessages.reduce((acc, message) => {
      if (!acc[message.eventType]) {
        acc[message.eventType] = [];
      }
      acc[message.eventType].push(message.body);
      return acc;
    }, {} as Record<string, any[]>);
    
    // Retry each event type as a batch
    for (const [eventType, bodies] of Object.entries(groupedMessages)) {
      try {
        await publisher.publishBatch(eventType, bodies);
        console.log(`Successfully retried ${bodies.length} ${eventType} messages`);
      } catch (error) {
        console.error(`Failed to retry ${eventType} messages:`, error);
      }
    }
    
    // Clear the failed messages
    publisher.clearFailedMessages();
  }
};
```

### 2. Graceful Shutdown

```typescript
// Graceful shutdown handling
const gracefulShutdown = async (publisher: BatchedEventPublisher) => {
  console.log('Shutting down gracefully...');
  
  // Flush all pending batches
  await publisher.flush();
  
  // Handle any remaining failed messages
  const failedMessages = publisher.getFailedMessages();
  if (failedMessages.length > 0) {
    console.log(`Saving ${failedMessages.length} failed messages for later processing`);
    // Save to persistent storage for later processing
    await saveFailedMessages(failedMessages);
  }
  
  console.log('Shutdown complete');
};
```

## Debugging

### 1. Enable Debug Logging

```typescript
// Add debug logging to your application
const DEBUG = process.env.DEBUG === 'true';

const debugPublisher = new BatchedEventPublisher(
  { redis: redisClient },
  {
    originServiceName: 'my-service',
    batchConfig: {
      maxSize: 100,
      maxWaitMs: 1000,
      maxConcurrentBatches: 5,
      batchingTypeStrategy: 'exact'
    }
  }
);

// Add debug logging
if (DEBUG) {
  const originalAddMessage = debugPublisher.addMessage.bind(debugPublisher);
  debugPublisher.addMessage = async (eventType: string, body: any) => {
    console.log(`[DEBUG] Adding message: ${eventType}`, body);
    try {
      await originalAddMessage(eventType, body);
      console.log(`[DEBUG] Message added successfully: ${eventType}`);
    } catch (error) {
      console.error(`[DEBUG] Failed to add message: ${eventType}`, error);
      throw error;
    }
  };
}
```

### 2. Monitor Batch Queues

```typescript
// Monitor batch queue status
const monitorBatches = (publisher: BatchedEventPublisher) => {
  setInterval(() => {
    const queues = (publisher as any).queues;
    console.log('Batch queue status:');
    
    for (const [key, queue] of queues.entries()) {
      const messageCount = queue.getMessageCount();
      console.log(`  ${key}: ${messageCount} messages`);
    }
  }, 5000); // Check every 5 seconds
};
```

### 3. Transport Health Checks

```typescript
// Health check for Redis transport
const checkRedisHealth = async (redisClient: any) => {
  try {
    await redisClient.ping();
    console.log('Redis connection: OK');
    return true;
  } catch (error) {
    console.error('Redis connection: FAILED', error);
    return false;
  }
};

// Regular health checks
setInterval(async () => {
  const isHealthy = await checkRedisHealth(redisClient);
  if (!isHealthy) {
    console.warn('Redis health check failed');
  }
}, 30000); // Check every 30 seconds
```

## Best Practices

### 1. Configuration Management

```typescript
// Environment-based configuration
const getBatchConfig = (): BatchConfig => {
  const env = process.env.NODE_ENV || 'development';
  
  switch (env) {
    case 'production':
      return {
        maxSize: 100,
        maxWaitMs: 1000,
        maxConcurrentBatches: 5,
        batchingTypeStrategy: 'exact'
      };
    case 'development':
      return {
        maxSize: 10,
        maxWaitMs: 500,
        maxConcurrentBatches: 2,
        batchingTypeStrategy: 'exact'
      };
    default:
      return {
        maxSize: 50,
        maxWaitMs: 750,
        maxConcurrentBatches: 3,
        batchingTypeStrategy: 'exact'
      };
  }
};
```

### 2. Error Recovery

```typescript
// Implement circuit breaker pattern
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private readonly threshold = 5;
  private readonly timeout = 60000; // 1 minute

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error('Circuit breaker is open');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private isOpen(): boolean {
    return this.failures >= this.threshold && 
           Date.now() - this.lastFailureTime < this.timeout;
  }

  private onSuccess(): void {
    this.failures = 0;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
  }
}

// Use with publisher
const circuitBreaker = new CircuitBreaker();
const safePublish = async (eventType: string, body: any) => {
  return circuitBreaker.execute(() => publisher.publish(eventType, body));
};
```

### 3. Monitoring and Metrics

```typescript
// Add metrics collection
class PublisherMetrics {
  private publishedEvents = 0;
  private failedEvents = 0;
  private batchCount = 0;

  incrementPublished() {
    this.publishedEvents++;
  }

  incrementFailed() {
    this.failedEvents++;
  }

  incrementBatch() {
    this.batchCount++;
  }

  getMetrics() {
    return {
      publishedEvents: this.publishedEvents,
      failedEvents: this.failedEvents,
      batchCount: this.batchCount,
      successRate: this.publishedEvents / (this.publishedEvents + this.failedEvents)
    };
  }
}

const metrics = new PublisherMetrics();

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
```

## Common Error Messages

| Error Message | Cause | Solution |
|---------------|-------|----------|
| "Too many concurrent batches" | Batch limit exceeded | Increase `maxConcurrentBatches` or wait for batches to complete |
| "Invalid event body" | Validation failed | Check event payload against schema |
| "Transport error" | Network/connection issue | Check transport configuration and connectivity |
| "Failed to send individual message" | Individual message send failed | Check transport and retry logic |
| "Batch send failed" | Batch operation failed | Check batch configuration and transport |

## Getting Help

If you're still experiencing issues:

1. Check the [API Documentation](./API.md) for detailed information
2. Review the [README](./README.md) for usage examples
3. Enable debug logging to get more detailed error information
4. Check your transport configuration and connectivity
5. Verify your event validation logic
6. Monitor system resources (memory, CPU, network)
