#!/usr/bin/env node

const Redis = require('ioredis');
const { performance } = require('perf_hooks');
const chalk = require('chalk');

// Import the events library components
const { 
  EventPublisher, 
  BatchedEventPublisher, 
  DefaultEventValidator,
  RedisStreamConsumer 
} = require('../dist');

// Import the real transport
const { RedisStreamsClientProxy } = require('../dist/event-transport/redis-streams.client');

// Statistical analysis function
function calculateStats(values) {
  const sorted = values.sort((a, b) => a - b);
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const stdDev = Math.sqrt(values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length);
  
  return {
    mean,
    median,
    p95,
    p99,
    min,
    max,
    stdDev,
    values
  };
}

// Simple message loss detector
class MessageLossDetector {
  constructor() {
    this.sent = 0;
    this.received = 0;
  }

  trackSent() {
    this.sent++;
  }

  trackReceived() {
    this.received++;
  }

  calculateLoss() {
    const missing = this.sent - this.received;
    const lossRate = this.sent > 0 ? (missing / this.sent) * 100 : 0;
    return {
      totalSent: this.sent,
      totalReceived: this.received,
      missing,
      lossRate
    };
  }
}

// Performance measurement utilities
function measurePerformance(name, fn, iterations = 1000) {
  console.log(chalk.yellow(`\n📊 Testing ${name}...`));
  
  // Warmup
  for (let i = 0; i < 100; i++) {
    fn();
  }
  
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();
  
  const duration = end - start;
  const throughput = (iterations / duration) * 1000;
  const memoryUsage = process.memoryUsage();
  
  console.log(chalk.green(`${name}:`));
  console.log(`  Duration: ${duration.toFixed(2)}ms`);
  console.log(`  Throughput: ${throughput.toFixed(2)} ops/sec`);
  console.log(`  Memory: ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  
  return { duration, throughput, memoryUsage };
}

// Generate test events with TEST prefix
function generateTestEvent(type) {
  const now = new Date().toISOString();
  const timestamp = Date.now(); 
  
  switch (type) {
    case 'TEST.user.created':
      return {
        userId: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: `User ${Math.floor(Math.random() * 10000)}`,
        email: `user${Math.floor(Math.random() * 10000)}@example.com`,
        createdAt: now,
        timestamp: timestamp 
      };
    
    case 'TEST.order.created':
      return {
        orderId: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: `user-${Math.floor(Math.random() * 1000)}`,
        items: Array.from({ length: Math.floor(Math.random() * 5) + 1 }, (_, i) => ({
          productId: `product-${i + 1}`,
          quantity: Math.floor(Math.random() * 10) + 1,
          price: Math.random() * 100 + 10
        })),
        total: Math.random() * 1000 + 100,
        createdAt: now
      };
    
    case 'TEST.payment.processed':
      return {
        paymentId: `payment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        orderId: `order-${Math.floor(Math.random() * 1000)}`,
        amount: Math.random() * 1000 + 50,
        currency: 'USD',
        status: ['pending', 'completed', 'failed'][Math.floor(Math.random() * 3)],
        processedAt: now
      };
    
    default:
      throw new Error(`Unknown event type: ${type}`);
  }
}

// Create Redis Streams transport
function createRedisTransport(redis) {
  return {
    dispatchEvent: async (packet, options) => {
      const { pattern, data } = packet;
      const stream = options?.stream || 'test-events-stream';
      await redis.xadd(stream, '*', 'data', JSON.stringify({ pattern, data }));
    },
    emit: (pattern, data) => {
      return {
        subscribe: (observer) => {
          redis.xadd('test-events-stream', '*', 'data', JSON.stringify({ pattern, data }))
            .then(() => {
              if (observer.next) observer.next(data);
              if (observer.complete) observer.complete();
            })
            .catch((error) => {
              if (observer.error) observer.error(error);
            });
          return { unsubscribe: () => {} };
        }
      };
    },
    close: async () => {
      // Cleanup if needed
    }
  };
}

async function runComprehensiveBenchmarks() {
  console.log(chalk.blue('🚀 @logistically/events Comprehensive Performance Benchmark'));
  console.log(chalk.blue('='.repeat(60)));
  
  // Configuration for repeatable results
  const RUNS = 5; // Number of benchmark runs
  const WARMUP_RUNS = 2; // Warmup runs to stabilize performance
  console.log(chalk.yellow(`📊 Running ${RUNS} benchmark runs (${WARMUP_RUNS} warmup runs excluded)`));
  console.log(chalk.yellow('📊 Each run includes all test scenarios for comprehensive analysis'));
  console.log('');
  
  // Connect to Redis
  const redis = new Redis({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: 3
  });
  
  try {
    await redis.ping();
    console.log(chalk.green('✅ Connected to Redis'));
  } catch (error) {
    console.error(chalk.red('❌ Failed to connect to Redis:'), error.message);
    console.log(chalk.yellow('Make sure Redis is running: docker run -d -p 6379:6379 redis:7-alpine'));
    process.exit(1);
  }
  
  // Create validator with test schemas (including prefixed versions)
  const validator = new DefaultEventValidator({
    'TEST.user.created': {
      parse: (data) => data,
      safeParse: (data) => ({ success: true, data })
    },
    'TEST.order.created': {
      parse: (data) => data,
      safeParse: (data) => ({ success: true, data })
    },
    'TEST.payment.processed': {
      parse: (data) => data,
      safeParse: (data) => ({ success: true, data })
    },
    'benchmark-service.TEST.user.created': {
      parse: (data) => data,
      safeParse: (data) => ({ success: true, data })
    },
    'benchmark-service.TEST.order.created': {
      parse: (data) => data,
      safeParse: (data) => ({ success: true, data })
    },
    'benchmark-service.TEST.payment.processed': {
      parse: (data) => data,
      safeParse: (data) => ({ success: true, data })
    }
  });
  
  // Create transport using the real library transport
  const transport = new RedisStreamsClientProxy({
    host: 'localhost',
    port: 6379,
    stream: 'test-events-stream',
    verbose: false
  });
  
  // Create publishers
  const publisher = new EventPublisher(
    { redis: transport },
    {
      originServiceName: 'benchmark-service',
      validator: validator
    }
  );
  
  const batchedPublisher = new BatchedEventPublisher(
    { redis: transport },
    {
      originServiceName: 'benchmark-service',
      validator: validator,
      batchConfig: {
        maxSize: 200, 
        maxWaitMs: 50, // Very aggressive flush interval - flush every 50ms
        maxConcurrentBatches: 5 // Moderate concurrency, focus on flush timing
      }
    }
  );
  
  // Create consumer with the same validator as publisher
  const consumer = new RedisStreamConsumer({
    redis: redis,
    stream: 'TEST-events', // Match the stream name the publisher is using
    group: 'benchmark-group',
    consumer: 'benchmark-consumer',
    handlers: {
      'benchmark-service.TEST.user.created': async (body, header) => {
        // Simulate processing
        await new Promise(resolve => setTimeout(resolve, 1));
      },
      'benchmark-service.TEST.order.created': async (body, header) => {
        await new Promise(resolve => setTimeout(resolve, 1));
      },
      'benchmark-service.TEST.payment.processed': async (body, header) => {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    },
    blockMs: 1000,
    count: 10,
    validator: validator, // Use the same validator as publisher
    verbose: false // Disable verbose logging
  });
  
  // Consumer will be started only during E2E test
  let pollInterval = null;
  
  // Results storage for multiple runs
  const allResults = {
    individual: [],
    batched: [],
    concurrent: [],
    memory: [],
    e2e: [],
    stress: []
  };
  
  // Run multiple benchmark iterations
  for (let run = 0; run < RUNS + WARMUP_RUNS; run++) {
    const isWarmup = run < WARMUP_RUNS;
    const runNumber = run + 1;
    
    if (!isWarmup) {
      console.log(chalk.cyan(`\n🔄 Benchmark Run ${runNumber - WARMUP_RUNS}/${RUNS}`));
      console.log(chalk.cyan('='.repeat(40)));
    } else {
      console.log(chalk.gray(`\n🔥 Warmup Run ${runNumber}/${WARMUP_RUNS}`));
    }
    
    const results = [];
    
    // Test 1: Individual event publishing with events library
    const individualResult = measurePerformance('Individual Event Publishing (Events Library)', async () => {
      const event = generateTestEvent('TEST.user.created');
      await publisher.publish('TEST.user.created', event);
    }, 1000);
    
    if (!isWarmup) {
      allResults.individual.push(individualResult);
    }
    
    // Store results for this run
    const runResults = [];
    runResults.push(individualResult);
  
  // Test 2: Batched event publishing with detailed throughput analysis
  console.log(chalk.yellow('\n📦 Testing Batched Event Publishing with Detailed Analysis...'));
  
  // Test different flush intervals - this is the key configuration for batching performance
  const flushIntervals = [25, 50, 100, 200, 500]; // Test different flush intervals in ms
  const batchResults = [];
  
  for (const flushInterval of flushIntervals) {
    // Create a new batched publisher with this flush interval
    const testBatchedPublisher = new BatchedEventPublisher(
      { redis: transport },
      {
        originServiceName: 'benchmark-service',
        validator: validator,
        batchConfig: {
          maxSize: 200, // Keep batch size constant
          maxWaitMs: flushInterval, // Test different flush intervals
          maxConcurrentBatches: 5
        }
      }
    );
    
    const start = performance.now();
    const totalMessages = 100000; // 100k messages to better trigger batching
    const iterations = Math.ceil(totalMessages / 200); // Use batch size of 200 for all tests
    
    // Use addMessage to trigger actual batching mechanism with higher concurrency
    const batchPromises = [];
    const concurrentBatchSize = 1000; // Process in batches of 1000 for better concurrency
    
    for (let i = 0; i < totalMessages; i += concurrentBatchSize) {
      const batch = [];
      for (let j = 0; j < Math.min(concurrentBatchSize, totalMessages - i); j++) {
        const event = generateTestEvent('TEST.order.created');
        batch.push(testBatchedPublisher.addMessage('TEST.order.created', event));
      }
      batchPromises.push(Promise.all(batch));
    }
    
    // Wait for all batches to be added
    await Promise.all(batchPromises);
    
    // Force flush to ensure all messages are sent
    await testBatchedPublisher.flush();
    
    const end = performance.now();
    
    const duration = end - start;
    const messagesPerSecond = (totalMessages / duration) * 1000;
    const batchesPerSecond = (iterations / duration) * 1000;
    const memoryUsage = process.memoryUsage();
    
    console.log(chalk.green(`Flush Interval ${flushInterval}ms:`));
    console.log(`  Total Messages: ${totalMessages.toLocaleString()}`);
    console.log(`  Duration: ${duration.toFixed(2)}ms`);
    console.log(`  Messages/sec: ${messagesPerSecond.toFixed(2)}`);
    console.log(`  Batches/sec: ${batchesPerSecond.toFixed(2)}`);
    console.log(`  Memory: ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log('');
    
    batchResults.push({
      flushInterval,
      totalMessages,
      duration,
      messagesPerSecond,
      batchesPerSecond,
      memoryUsage
    });
  }
  
  // Find the best performing batch size
  const bestBatch = batchResults.reduce((best, current) => 
    current.messagesPerSecond > best.messagesPerSecond ? current : best
  );
  
  console.log(chalk.cyan('🏆 BEST BATCH PERFORMANCE:'));
  console.log(`  Flush Interval: ${bestBatch.flushInterval}ms`);
  console.log(`  Messages/sec: ${bestBatch.messagesPerSecond.toFixed(2)}`);
  console.log(`  Batches/sec: ${bestBatch.batchesPerSecond.toFixed(2)}`);
  console.log(`  Total Messages: ${bestBatch.totalMessages.toLocaleString()}`);
  console.log('');
  
  // Store batched results for this run
  const batchedResult = {
    name: `Batched Publishing (${bestBatch.flushInterval}ms flush)`,
    duration: bestBatch.duration,
    count: bestBatch.totalMessages,
    throughput: bestBatch.messagesPerSecond,
    memoryUsage: bestBatch.memoryUsage,
    flushInterval: bestBatch.flushInterval
  };
  
  if (!isWarmup) {
    allResults.batched.push(batchedResult);
  }
  runResults.push(batchedResult);
  
  // Test 3: Concurrent publishing with events library
  const concurrentResult = measurePerformance('Concurrent Event Publishing (Events Library)', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      const event = generateTestEvent('TEST.payment.processed');
      promises.push(publisher.publish('TEST.payment.processed', event));
    }
    await Promise.all(promises);
  }, 100);
  
  if (!isWarmup) {
    allResults.concurrent.push(concurrentResult);
  }
  runResults.push(concurrentResult);
  
  // Test 4: Memory efficiency test
  const memoryResult = measurePerformance('Memory Efficiency Test', async () => {
    const events = Array.from({ length: 100 }, () => generateTestEvent('TEST.user.created'));
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        await publisher.publish('TEST.user.created', events[j]);
      }
    }
  }, 50);
  
  if (!isWarmup) {
    allResults.memory.push(memoryResult);
  }
  runResults.push(memoryResult);
  
  // Test 5: End-to-end latency test with message loss detection
  console.log(chalk.yellow('\n📊 Testing End-to-End Latency (Events Library)...'));
  
  // Clear test stream and create consumer group for E2E test
  await redis.del('test-events-stream');
  console.log(chalk.green('✅ Cleared test stream for E2E test'));
  
  try {
    await redis.xgroup('CREATE', 'test-events-stream', 'benchmark-group', '$', 'MKSTREAM');
    console.log(chalk.green('✅ Created consumer group for E2E test'));
  } catch (error) {
    if (error.message.includes('BUSYGROUP')) {
      console.log(chalk.yellow('⚠️  Consumer group already exists'));
    } else {
      console.log(chalk.green('✅ Consumer group created for E2E test'));
    }
  }
  
  const e2eIterations = 1000;
  const e2eStart = performance.now();
  const e2eLatencies = [];
  
  // Create message loss detector with simple array tracking
  const e2eDetector = new MessageLossDetector();
  const sentHashes = []; // Track hashes of messages sent during test
  const receivedHashes = []; // Track hashes of messages received
  
  // Update consumer handler to track received messages using library-generated hashes
  const originalHandler = consumer.eventConsumer.handlers['benchmark-service.TEST.user.created'];
  consumer.eventConsumer.handlers['benchmark-service.TEST.user.created'] = async (body, header) => {
    // Use the library's generated hash from header
    const messageHash = header?.hash;
    
    
    
    if (messageHash) {
      receivedHashes.push(messageHash);
      e2eDetector.trackReceived();
      
    }
    
    // Call original handler
    if (originalHandler) {
      await originalHandler(body, header);
    }
  };
  
    // Clear existing messages and reset consumer group for clean E2E test
  try {
    // Delete the stream to clear all messages
    await redis.del('TEST-events');
    console.log('✅ Cleared TEST-events stream');

    // Also trim the stream to ensure it's empty
    await redis.xtrim('TEST-events', 'MAXLEN', 0);
    console.log('✅ Trimmed TEST-events stream to empty');

    // Recreate consumer group
    await redis.xgroup('CREATE', 'TEST-events', 'benchmark-group', '$', 'MKSTREAM');
    console.log('✅ Recreated consumer group for TEST-events stream');
  } catch (error) {
    if (error.message.includes('BUSYGROUP')) {
      // Consumer group exists, try to delete and recreate
      try {
        await redis.xgroup('DESTROY', 'TEST-events', 'benchmark-group');
        await redis.xgroup('CREATE', 'TEST-events', 'benchmark-group', '$', 'MKSTREAM');
        console.log('✅ Reset consumer group for TEST-events stream');
      } catch (destroyError) {
        console.log('ℹ️  Could not reset consumer group, continuing with existing');
      }
    } else {
      console.log('ℹ️  Consumer group setup completed');
    }
  }

  // Create a cleanup consumer to acknowledge all existing messages
  console.log('🧹 Creating cleanup consumer to acknowledge all existing messages...');
  
  // Create cleanup consumer group
  try {
    await redis.xgroup('CREATE', 'TEST-events', 'cleanup-group', '$', 'MKSTREAM');
    console.log('✅ Created cleanup consumer group');
  } catch (error) {
    if (error.message.includes('BUSYGROUP')) {
      console.log('ℹ️  Cleanup consumer group already exists');
    } else {
      console.log('ℹ️  Cleanup consumer group setup completed');
    }
  }
  
  const cleanupConsumer = new RedisStreamConsumer({
    redis,
    stream: 'TEST-events',
    group: 'cleanup-group',
    consumer: 'cleanup-consumer',
    handlers: {
      'benchmark-service.TEST.user.created': async (body, header) => {
        // Just acknowledge the message, don't process it

      }
    },
    verbose: false,
    validator: {
      validate: () => ({ valid: true }), // Skip validation for cleanup
      registerSchema: () => {},
      getSchema: () => ({ parse: () => ({}) }) // Mock Zod schema
    }
  });

  // Start cleanup consumer and let it process all existing messages
  let cleanupInterval = setInterval(async () => {
    try {
      await cleanupConsumer.pollAndHandle();
    } catch (error) {
      console.error('Cleanup consumer error:', error);
    }
  }, 100);

  // Let cleanup consumer run for a few seconds to process all messages
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Stop cleanup consumer
  clearInterval(cleanupInterval);
  await cleanupConsumer.stop();
  console.log('✅ Cleanup consumer finished and stopped');

  // Reset the main consumer group position to the current end of stream
  try {
    await redis.xgroup('SETID', 'TEST-events', 'benchmark-group', '$');
    console.log('✅ Reset main consumer group position to stream end');
  } catch (error) {
    console.log('ℹ️  Could not reset consumer group position:', error.message);
  }
  
  // Start consumer polling for E2E test (faster polling for better performance)
  pollInterval = setInterval(async () => {
    try {
      await consumer.pollAndHandle();
    } catch (error) {
      console.error('Consumer polling error:', error);
    }
  }, 100); // Faster polling for better throughput
  
  // Add timeout to prevent hanging
  const e2eTimeout = setTimeout(() => {
    console.log(chalk.red('⏰ E2E test timeout - stopping consumer'));
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }, 90000); // 30 second timeout
  
  for (let i = 0; i < e2eIterations; i++) {
    const event = generateTestEvent('TEST.user.created');
    
    // Create the envelope to get the library's generated hash
    const { createEventEnvelope } = require('../dist/event-types');
    const envelope = createEventEnvelope(
      'TEST.user.created',
      'benchmark-service',
      event,
      'benchmark-service'
    );
    
    // Get the hash that the library actually generated
    const messageHash = envelope.header.hash;
    
    // Track the message hash when we send it
    sentHashes.push(messageHash);
    
    
    
    const start = performance.now();
    await publisher.publish('TEST.user.created', event);
    e2eDetector.trackSent(); // Track sent message
    const end = performance.now();
    
    e2eLatencies.push(end - start);
  }
  
  // Wait for all messages to be processed (longer wait for more messages)
  const waitTime = Math.max(5000, e2eIterations * 10); // At least 5 seconds, or 10ms per message
  console.log(chalk.blue(`⏳ Waiting ${waitTime}ms for all messages to be processed...`));
  await new Promise(resolve => setTimeout(resolve, waitTime));
  
  const e2eEnd = performance.now();
  const e2eDuration = e2eEnd - e2eStart;
  // Stop consumer polling and clear timeout
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  clearTimeout(e2eTimeout);
  
  const e2eThroughput = (e2eIterations / e2eDuration) * 1000;
  const e2eMemory = process.memoryUsage();
  
  // Calculate message loss
  const e2eLoss = e2eDetector.calculateLoss();
  
  // Calculate latency statistics
  const avgLatency = e2eLatencies.reduce((sum, lat) => sum + lat, 0) / e2eLatencies.length;
  const sortedLatencies = e2eLatencies.sort((a, b) => a - b);
  const p50Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
  const p95Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
  const p99Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)];
  
  console.log(chalk.green('End-to-End Latency (Events Library):'));
  console.log(`  Duration: ${e2eDuration.toFixed(2)}ms`);
  console.log(`  Throughput: ${e2eThroughput.toFixed(2)} ops/sec`);
  console.log(`  Memory: ${(e2eMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Average Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`  P50 Latency: ${p50Latency.toFixed(2)}ms`);
  console.log(`  P95 Latency: ${p95Latency.toFixed(2)}ms`);
  console.log(`  P99 Latency: ${p99Latency.toFixed(2)}ms`);
  // Calculate intersection and differences
  const sentSet = new Set(sentHashes);
  const receivedSet = new Set(receivedHashes);
  
  // Find hashes that were sent but not received (missing)
  const missingHashes = sentHashes.filter(hash => !receivedSet.has(hash));
  
  // Find hashes that were received but not sent (extra/duplicates)
  const extraHashes = receivedHashes.filter(hash => !sentSet.has(hash));
  
  // Find hashes that were both sent and received (successful)
  const successfulHashes = sentHashes.filter(hash => receivedSet.has(hash));
  
  console.log(`  Total Sent: ${e2eLoss.totalSent.toLocaleString()}`);
  console.log(`  Total Received: ${e2eLoss.totalReceived.toLocaleString()}`);
  console.log(`  Successful Deliveries: ${successfulHashes.length}`);
  console.log(`  Missing Messages: ${missingHashes.length}`);
  console.log(`  Extra/Duplicate Messages: ${extraHashes.length}`);
  console.log(`  Message Loss: ${e2eLoss.lossRate.toFixed(2)}%`);
  console.log(`  Reliability: ${(100 - e2eLoss.lossRate).toFixed(2)}%`);
  
  const e2eResult = {
    name: 'End-to-End Latency',
    duration: e2eDuration,
    count: e2eIterations,
    throughput: e2eThroughput,
    memoryUsage: e2eMemory,
    lossRate: e2eLoss.lossRate,
    reliability: 100 - e2eLoss.lossRate,
    avgLatency,
    p50Latency,
    p95Latency,
    p99Latency
  };
  if (!isWarmup) {
    allResults.e2e.push(e2eResult);
  }
  runResults.push(e2eResult);
  
  // Test 6: Consumer Clearance Performance Test
  console.log(chalk.yellow('\n🧹 Testing Consumer Clearance Performance...'));
  
  // Check if there are messages to clear
  const streamLength = await redis.xlen('console');
  if (streamLength > 0) {
    console.log(`📊 Found ${streamLength.toLocaleString()} messages in console stream to clear`);
    
    // Use the existing cleanup consumer approach but with timing
    const startTime = Date.now();
    let processedCount = 0;
    
    // Create consumer group from beginning
    try {
      await redis.xgroup('CREATE', 'console', 'clearance-group', '0', 'MKSTREAM');
    } catch (error) {
      try {
        await redis.xgroup('SETID', 'console', 'clearance-group', '0');
      } catch (resetError) {
        console.log(`  ⚠️  Could not reset consumer group: ${resetError.message}`);
      }
    }
    
    const cleanupConsumer = new RedisStreamConsumer({
      redis: redis,
      stream: 'console',
      group: 'clearance-group',
      consumer: 'clearance-consumer',
      handlers: {
        'benchmark-service.TEST.user.created': async (body, header) => {
          processedCount++;
          return true;
        },
        'benchmark-service.TEST.order.created': async (body, header) => {
          processedCount++;
          return true;
        },
        'benchmark-service.TEST.payment.processed': async (body, header) => {
          processedCount++;
          return true;
        }
      },
      blockMs: 1000,
      count: 1000, // Large fetch size for speed
      validator: {
        validate: () => ({ valid: true }),
        getSchema: () => ({ parse: () => {} })
      },
      verbose: false
    });
    
    // Start polling
    const pollInterval = setInterval(async () => {
      await cleanupConsumer.pollAndHandle();
    }, 100); // Fast polling
    
    // Wait for completion
    await new Promise(resolve => {
      const checkInterval = setInterval(async () => {
        const currentLength = await redis.xlen('console');
        const elapsed = (Date.now() - startTime) / 1000;
        
        if (currentLength === 0 || elapsed > 30) { // 30 second timeout
          clearInterval(pollInterval);
          clearInterval(checkInterval);
          
          const totalTime = (Date.now() - startTime) / 1000;
          const avgRate = processedCount / totalTime;
          const dataProcessedMB = (processedCount * 450) / (1024 * 1024);
          const dataRateMBps = dataProcessedMB / totalTime;
          
          console.log(chalk.green(`✅ Consumer Clearance completed!`));
          console.log(`  📊 Processed: ${processedCount.toLocaleString()} messages`);
          console.log(`  ⏱️  Time: ${totalTime.toFixed(1)}s`);
          console.log(`  ⚡ Rate: ${avgRate.toFixed(2)} messages/sec`);
          console.log(`  📦 Data Rate: ${dataRateMBps.toFixed(2)} MB/sec`);
          
          // Store consumer results
          const consumerResult = {
            name: `Consumer Clearance`,
            duration: totalTime * 1000,
            count: processedCount,
            throughput: avgRate,
            memoryUsage: { heapUsed: 0 },
            dataRateMBps: dataRateMBps
          };
          
          if (!isWarmup) {
            allResults.consumer = allResults.consumer || [];
            allResults.consumer.push(consumerResult);
          }
          runResults.push(consumerResult);
          
          cleanupConsumer.stop();
          resolve();
        }
      }, 1000);
    });
  } else {
    console.log('📭 No messages found in console stream to clear');
  }
  
  // Test 7: High-throughput batched stress test
  console.log(chalk.yellow('\n🚀 Testing High-Throughput Batched Stress Test...'));
  
  const stressBatchSizes = [100, 250, 500, 1000];
  const stressResults = [];
  
  for (const batchSize of stressBatchSizes) {
    const start = performance.now();
    const totalMessages = 200000; // Increase to 200k messages for stress testing
    
    // Use addMessage to trigger actual batching mechanism with higher concurrency
    const batchPromises = [];
    const concurrentBatchSize = 2000; // Process in larger batches for stress testing
    
    for (let i = 0; i < totalMessages; i += concurrentBatchSize) {
      const batch = [];
      for (let j = 0; j < Math.min(concurrentBatchSize, totalMessages - i); j++) {
        const event = generateTestEvent('TEST.payment.processed');
        batch.push(batchedPublisher.addMessage('TEST.payment.processed', event));
      }
      batchPromises.push(Promise.all(batch));
    }
    
    // Wait for all batches to be added
    await Promise.all(batchPromises);
    
    // Force flush to ensure all messages are sent
    await batchedPublisher.flush();
    
    const end = performance.now();
    
    const duration = end - start;
    const messagesPerSecond = (totalMessages / duration) * 1000;
    const batchesPerSecond = (totalMessages / batchSize / duration) * 1000;
    const memoryUsage = process.memoryUsage();
    
    console.log(chalk.green(`Stress Test - Batch Size ${batchSize}:`));
    console.log(`  Total Messages: ${totalMessages.toLocaleString()}`);
    console.log(`  Duration: ${duration.toFixed(2)}ms`);
    console.log(`  Messages/sec: ${messagesPerSecond.toFixed(2)}`);
    console.log(`  Batches/sec: ${batchesPerSecond.toFixed(2)}`);
    console.log(`  Memory: ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log('');
    
    stressResults.push({
      batchSize,
      totalMessages,
      duration,
      messagesPerSecond,
      batchesPerSecond,
      memoryUsage
    });
  }
  
  // Find the best stress test result
  const bestStress = stressResults.reduce((best, current) => 
    current.messagesPerSecond > best.messagesPerSecond ? current : best
  );
  
  console.log(chalk.cyan('🏆 BEST STRESS TEST PERFORMANCE:'));
  console.log(`  Batch Size: ${bestStress.batchSize}`);
  console.log(`  Messages/sec: ${bestStress.messagesPerSecond.toFixed(2)}`);
  console.log(`  Batches/sec: ${bestStress.batchesPerSecond.toFixed(2)}`);
  console.log(`  Total Messages: ${bestStress.totalMessages.toLocaleString()}`);
  console.log('');
  
  // Store stress test results
  const stressResult = {
    name: `High-Throughput Batched (${bestStress.batchSize} batch size)`,
    duration: bestStress.duration,
    count: bestStress.totalMessages,
    throughput: bestStress.messagesPerSecond,
    memoryUsage: bestStress.memoryUsage,
    batchSize: bestStress.batchSize
  };
  
  if (!isWarmup) {
    allResults.stress.push(stressResult);
  }
  runResults.push(stressResult);
  
  // Close the for loop
  }
  
  // Calculate statistics for repeatable results
  console.log(chalk.magenta('\n📊 REPEATABLE BENCHMARK RESULTS'));
  console.log(chalk.magenta('='.repeat(60)));
  
  // Individual Publishing Statistics
  const individualThroughputs = allResults.individual.map(r => r.throughput);
  const individualStats = calculateStats(individualThroughputs);
  
  console.log(chalk.cyan('\n📈 Individual Publishing Statistics:'));
  console.log(`  Mean Throughput: ${individualStats.mean.toFixed(2)} ops/sec`);
  console.log(`  Median Throughput: ${individualStats.median.toFixed(2)} ops/sec`);
  console.log(`  P95 Throughput: ${individualStats.p95.toFixed(2)} ops/sec`);
  console.log(`  P99 Throughput: ${individualStats.p99.toFixed(2)} ops/sec`);
  console.log(`  Min Throughput: ${individualStats.min.toFixed(2)} ops/sec`);
  console.log(`  Max Throughput: ${individualStats.max.toFixed(2)} ops/sec`);
  console.log(`  Std Dev: ${individualStats.stdDev.toFixed(2)} ops/sec`);
  
  // Batched Publishing Statistics
  const batchedThroughputs = allResults.batched.map(r => r.throughput);
  const batchedStats = calculateStats(batchedThroughputs);
  
  console.log(chalk.cyan('\n📦 Batched Publishing Statistics:'));
  console.log(`  Mean Throughput: ${batchedStats.mean.toFixed(2)} messages/sec`);
  console.log(`  Median Throughput: ${batchedStats.median.toFixed(2)} messages/sec`);
  console.log(`  P95 Throughput: ${batchedStats.p95.toFixed(2)} messages/sec`);
  console.log(`  P99 Throughput: ${batchedStats.p99.toFixed(2)} messages/sec`);
  console.log(`  Min Throughput: ${batchedStats.min.toFixed(2)} messages/sec`);
  console.log(`  Max Throughput: ${batchedStats.max.toFixed(2)} messages/sec`);
  console.log(`  Std Dev: ${batchedStats.stdDev.toFixed(2)} messages/sec`);
  
  // E2E Statistics
  const e2eThroughputs = allResults.e2e.map(r => r.throughput);
  const e2eLatencies = allResults.e2e.map(r => r.avgLatency);
  const e2eLossRates = allResults.e2e.map(r => r.lossRate);
  
  const e2eThroughputStats = calculateStats(e2eThroughputs);
  const e2eLatencyStats = calculateStats(e2eLatencies);
  const e2eLossStats = calculateStats(e2eLossRates);
  
  // Consumer Statistics (if available)
  if (allResults.consumer && allResults.consumer.length > 0) {
    const consumerThroughputs = allResults.consumer.map(r => r.throughput);
    const consumerDataRates = allResults.consumer.map(r => r.dataRateMBps);
    
    const consumerStats = calculateStats(consumerThroughputs);
    const consumerDataStats = calculateStats(consumerDataRates);
    
    console.log(chalk.cyan('\n🧹 Consumer Clearance Statistics:'));
    console.log(`  Mean Throughput: ${consumerStats.mean.toFixed(2)} messages/sec`);
    console.log(`  Median Throughput: ${consumerStats.median.toFixed(2)} messages/sec`);
    console.log(`  P95 Throughput: ${consumerStats.p95.toFixed(2)} messages/sec`);
    console.log(`  P99 Throughput: ${consumerStats.p99.toFixed(2)} messages/sec`);
    console.log(`  Min Throughput: ${consumerStats.min.toFixed(2)} messages/sec`);
    console.log(`  Max Throughput: ${consumerStats.max.toFixed(2)} messages/sec`);
    console.log(`  Std Dev: ${consumerStats.stdDev.toFixed(2)} messages/sec`);
    console.log(`  Mean Data Rate: ${consumerDataStats.mean.toFixed(2)} MB/sec`);
  }
  
  console.log(chalk.cyan('\n🔄 End-to-End Statistics:'));
  console.log(`  Mean Throughput: ${e2eThroughputStats.mean.toFixed(2)} ops/sec`);
  console.log(`  Median Throughput: ${e2eThroughputStats.median.toFixed(2)} ops/sec`);
  console.log(`  Mean Latency: ${e2eLatencyStats.mean.toFixed(2)}ms`);
  console.log(`  Median Latency: ${e2eLatencyStats.median.toFixed(2)}ms`);
  console.log(`  Mean Loss Rate: ${e2eLossStats.mean.toFixed(2)}%`);
  console.log(`  Median Loss Rate: ${e2eLossStats.median.toFixed(2)}%`);
  
  // Confidence Intervals (95% confidence)
  console.log(chalk.cyan('\n🎯 Confidence Intervals (95%):'));
  console.log(`  Individual Publishing: ${(individualStats.mean - 1.96 * individualStats.stdDev / Math.sqrt(RUNS)).toFixed(2)} - ${(individualStats.mean + 1.96 * individualStats.stdDev / Math.sqrt(RUNS)).toFixed(2)} ops/sec`);
  console.log(`  Batched Publishing: ${(batchedStats.mean - 1.96 * batchedStats.stdDev / Math.sqrt(RUNS)).toFixed(2)} - ${(batchedStats.mean + 1.96 * batchedStats.stdDev / Math.sqrt(RUNS)).toFixed(2)} messages/sec`);
  console.log(`  E2E Throughput: ${(e2eThroughputStats.mean - 1.96 * e2eThroughputStats.stdDev / Math.sqrt(RUNS)).toFixed(2)} - ${(e2eThroughputStats.mean + 1.96 * e2eThroughputStats.stdDev / Math.sqrt(RUNS)).toFixed(2)} ops/sec`);
  
  // Print detailed summary (using last run results)
  console.log(chalk.magenta('\n📊 COMPREHENSIVE BENCHMARK SUMMARY'));
  console.log(chalk.magenta('='.repeat(60)));
  
  const testNames = [
    'Individual Publishing',
    'Batched Publishing', 
    'Concurrent Publishing',
    'Memory Efficiency',
    'End-to-End Latency',
    'High-Throughput Stress'
  ];
  
  // Use the last run's results for summary (if available)
  if (typeof runResults !== 'undefined' && runResults.length > 0) {
    const lastRunResults = runResults;
    lastRunResults.forEach((result, index) => {
    console.log(chalk.yellow(`${testNames[index]}:`));
    // Use messages/sec for all tests since we're comparing individual messages
    const throughputLabel = index === 1 || index === 5 ? 'messages/sec' : 'ops/sec';
          console.log(`  Throughput: ${result.throughput.toFixed(2)} ${throughputLabel}`);
      console.log(`  Memory: ${(result.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Duration: ${result.duration.toFixed(2)}ms`);

      console.log('');
    });
  }
  
  // Calculate averages (if results are available)
  if (typeof runResults !== 'undefined' && runResults.length > 0) {
    const avgThroughput = runResults.reduce((sum, r) => sum + r.throughput, 0) / runResults.length;
    const avgMemory = runResults.reduce((sum, r) => sum + r.memoryUsage.heapUsed, 0) / runResults.length;
  
    console.log(chalk.cyan('📈 AVERAGE PERFORMANCE:'));
    console.log(`  Average Throughput: ${avgThroughput.toFixed(2)} messages/sec`);
    console.log(`  Average Memory: ${(avgMemory / 1024 / 1024).toFixed(2)} MB`);
  }
  
  // Performance analysis
  console.log(chalk.cyan('\n🔍 PERFORMANCE ANALYSIS:'));
  
  const individual = runResults[0];
  const batched = runResults[1];
  const concurrent = runResults[2];
  const highThroughput = runResults[5]; // The stress test result
  
  console.log(`  Individual Publishing: ${individual.throughput.toFixed(2)} messages/sec`);
  console.log(`  Best Batched Publishing: ${batched.throughput.toFixed(2)} messages/sec`);
  console.log(`  Concurrent Publishing: ${concurrent.throughput.toFixed(2)} messages/sec`);
  console.log(`  High-Throughput Batched: ${highThroughput.throughput.toFixed(2)} messages/sec`);
  console.log('');
  
  console.log(`  Individual vs Best Batched: ${(individual.throughput / batched.throughput).toFixed(2)}x ratio`);
  console.log(`  Individual vs High-Throughput: ${(individual.throughput / highThroughput.throughput).toFixed(2)}x ratio`);
  console.log(`  Best Batched vs High-Throughput: ${(batched.throughput / highThroughput.throughput).toFixed(2)}x ratio`);
  
  // Memory analysis
  const memoryEfficiency = runResults[3];
  console.log(`  Memory Efficiency: ${(memoryEfficiency.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB baseline`);
  
  // Throughput efficiency analysis
  console.log(chalk.cyan('\n📈 THROUGHPUT EFFICIENCY:'));
  console.log(`  Individual Efficiency: ${(individual.throughput / (individual.memoryUsage.heapUsed / 1024 / 1024)).toFixed(2)} messages/sec/MB`);
  console.log(`  Batched Efficiency: ${(batched.throughput / (batched.memoryUsage.heapUsed / 1024 / 1024)).toFixed(2)} messages/sec/MB`);
  console.log(`  High-Throughput Efficiency: ${(highThroughput.throughput / (highThroughput.memoryUsage.heapUsed / 1024 / 1024)).toFixed(2)} messages/sec/MB`);
  


  // Cleanup
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  consumer.stop();
  
  try {
    await publisher.close();
  } catch (error) {
    // Ignore connection already closed errors
  }
  
  try {
    await batchedPublisher.close();
  } catch (error) {
    // Ignore connection already closed errors
  }
  
  try {
    await redis.quit();
  } catch (error) {
    // Ignore connection already closed errors
  }
  
  console.log(chalk.green('\n✅ benchmarks completed!'));
  console.log(chalk.gray('Note: These results test the events library with Redis Streams'));
}

// Run comprehensive benchmarks
runComprehensiveBenchmarks().catch(console.error);
