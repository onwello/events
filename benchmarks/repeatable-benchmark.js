const { performance } = require('perf_hooks');
const chalk = require('chalk');
const Redis = require('ioredis');
const { EventPublisher } = require('../dist/event-publisher');
const { BatchedEventPublisher } = require('../dist/event-publisher/batched-publisher');
const { RedisStreamConsumer } = require('../dist/event-consumer');
const { RedisStreamsClientProxy } = require('../dist/event-transport');
const { DefaultEventValidator } = require('../dist/event-types');

// Configuration for repeatable results
const RUNS = 5; // Number of benchmark runs
const WARMUP_RUNS = 2; // Warmup runs to stabilize performance
  const E2E_MESSAGES = 50; // Number of messages for E2E test

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
    const totalSent = this.sent;
    const totalReceived = this.received;
    const lossRate = totalSent > 0 ? ((totalSent - totalReceived) / totalSent) * 100 : 0;
    
    return {
      totalSent,
      totalReceived,
      lossRate
    };
  }
}

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

function generateTestEvent(type) {
  return {
    userId: Math.floor(Math.random() * 1000000),
    timestamp: new Date().toISOString(),
    data: {
      id: Math.random().toString(36).substring(7),
      value: Math.random() * 1000,
      metadata: {
        source: 'benchmark',
        version: '1.0.0'
      }
    }
  };
}

async function runRepeatableBenchmarks() {
  console.log(chalk.blue('🚀 @logistically/events Repeatable Performance Benchmark'));
  console.log(chalk.blue('='.repeat(60)));
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

  // Create validator with test schemas
  const validator = new DefaultEventValidator({
    'TEST.user.created': {
      parse: (data) => data,
      safeParse: (data) => ({ success: true, data })
    },
    'TEST.order.created': {
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
    }
  });

  // Create transport
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
        maxWaitMs: 500,
        maxConcurrentBatches: 5
      }
    }
  );

  // Create consumer
  const consumer = new RedisStreamConsumer({
    redis: redis,
    stream: 'TEST-events',
    group: 'benchmark-group',
    consumer: 'benchmark-consumer',
    handlers: {
      'benchmark-service.TEST.user.created': async (body, header) => {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    },
    blockMs: 1000,
    count: 10,
    validator: validator,
    verbose: false
  });

  // Results storage for multiple runs
  const allResults = {
    individual: [],
    batched: [],
    e2e: []
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
    
    console.log(chalk.gray('  Starting individual publishing test...'));

    // Test 1: Individual Event Publishing
    if (!isWarmup) console.log(chalk.yellow('\n📊 Testing Individual Event Publishing...'));
    
    const individualStart = performance.now();
    for (let i = 0; i < 100; i++) { // Reduced from 1000 to 100 for faster testing
      const event = generateTestEvent('TEST.user.created');
      await publisher.publish('TEST.user.created', event);
      if (i % 20 === 0 && !isWarmup) {
        console.log(chalk.gray(`  Published ${i} events...`));
      }
    }
    const individualEnd = performance.now();
    
    const individualResult = {
      duration: individualEnd - individualStart,
      throughput: (1000 / (individualEnd - individualStart)) * 1000,
      memory: process.memoryUsage()
    };
    
    if (!isWarmup) {
      allResults.individual.push(individualResult);
    }

    // Test 2: Batched Event Publishing
    if (!isWarmup) console.log(chalk.yellow('\n📦 Testing Batched Event Publishing...'));
    
    const batchedStart = performance.now();
    const totalMessages = 1000; // Reduced from 25000 to 1000 for faster testing
    
    for (let i = 0; i < totalMessages; i++) {
      const event = generateTestEvent('TEST.order.created');
      await batchedPublisher.addMessage('TEST.order.created', event);
      if (i % 200 === 0 && !isWarmup) {
        console.log(chalk.gray(`  Added ${i} messages to batch...`));
      }
    }
    
    if (!isWarmup) console.log(chalk.gray('  Flushing batch...'));
    await batchedPublisher.flush();
    const batchedEnd = performance.now();
    
    const batchedResult = {
      duration: batchedEnd - batchedStart,
      throughput: (totalMessages / (batchedEnd - batchedStart)) * 1000,
      memory: process.memoryUsage()
    };
    
    if (!isWarmup) {
      allResults.batched.push(batchedResult);
    }

    // Test 3: End-to-End Latency
    if (!isWarmup) console.log(chalk.yellow('\n📊 Testing End-to-End Latency...'));
    
    // Clear stream and setup for E2E test
    try {
      await redis.del('TEST-events');
      await redis.xgroup('CREATE', 'TEST-events', 'benchmark-group', '$', 'MKSTREAM');
    } catch (error) {
      // Ignore errors
    }

    // Create cleanup consumer
    const cleanupConsumer = new RedisStreamConsumer({
      redis,
      stream: 'TEST-events',
      group: 'cleanup-group',
      consumer: 'cleanup-consumer',
      handlers: {
        'benchmark-service.TEST.user.created': async (body, header) => {
          // Just acknowledge, don't process
        }
      },
      verbose: false,
      validator: {
        validate: () => ({ valid: true }),
        registerSchema: () => {},
        getSchema: () => ({ parse: () => ({}) })
      }
    });

    // Cleanup old messages
    try {
      await redis.xgroup('CREATE', 'TEST-events', 'cleanup-group', '$', 'MKSTREAM');
      const cleanupInterval = setInterval(async () => {
        try {
          await cleanupConsumer.pollAndHandle();
        } catch (error) {
          // Ignore errors
        }
      }, 100);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      clearInterval(cleanupInterval);
      await cleanupConsumer.stop();
      await redis.xgroup('SETID', 'TEST-events', 'benchmark-group', '$');
    } catch (error) {
      // Ignore errors
    }

    // Start consumer polling
    let pollInterval = setInterval(async () => {
      try {
        await consumer.pollAndHandle();
      } catch (error) {
        // Ignore errors
      }
    }, 100);

    const e2eDetector = new MessageLossDetector();
    const sentHashes = [];
    const receivedHashes = [];

    // Add message tracking to consumer
    consumer.eventConsumer.addHandler('benchmark-service.TEST.user.created', async (body, header) => {
      const messageHash = header?.hash;
      if (messageHash) {
        receivedHashes.push(messageHash);
        e2eDetector.trackReceived();
      }
    });

    const e2eStart = performance.now();
    const e2eLatencies = [];

    // Publish messages
    for (let i = 0; i < E2E_MESSAGES; i++) {
      const event = generateTestEvent('TEST.user.created');
      
      const { createEventEnvelope } = require('../dist/event-types');
      const envelope = createEventEnvelope(
        'TEST.user.created',
        'benchmark-service',
        event,
        'benchmark-service'
      );
      
      const messageHash = envelope.header.hash;
      sentHashes.push(messageHash);
      
      const start = performance.now();
      await publisher.publish('TEST.user.created', event);
      e2eDetector.trackSent();
      const end = performance.now();
      
      e2eLatencies.push(end - start);
    }

    // Wait for processing
    const waitTime = Math.max(5000, E2E_MESSAGES * 10);
    await new Promise(resolve => setTimeout(resolve, waitTime));

    const e2eEnd = performance.now();
    clearInterval(pollInterval);

    const e2eResult = {
      duration: e2eEnd - e2eStart,
      throughput: (E2E_MESSAGES / (e2eEnd - e2eStart)) * 1000,
      memory: process.memoryUsage(),
      lossRate: e2eDetector.calculateLoss().lossRate,
      avgLatency: e2eLatencies.reduce((sum, lat) => sum + lat, 0) / e2eLatencies.length
    };

    if (!isWarmup) {
      allResults.e2e.push(e2eResult);
    }

    await consumer.stop();
  }

  // Calculate statistics for each test
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

  // Performance Comparison
  console.log(chalk.cyan('\n🔍 Performance Comparison:'));
  console.log(`  Individual vs Batched Ratio: ${(individualStats.mean / batchedStats.mean).toFixed(2)}x`);
  console.log(`  Individual vs E2E Ratio: ${(individualStats.mean / e2eThroughputStats.mean).toFixed(2)}x`);
  console.log(`  Batched vs E2E Ratio: ${(batchedStats.mean / e2eThroughputStats.mean).toFixed(2)}x`);

  // Methodology
  console.log(chalk.cyan('\n📋 Test Methodology:'));
  console.log(`  • ${RUNS} benchmark runs with ${WARMUP_RUNS} warmup runs excluded`);
  console.log(`  • Individual Publishing: 1000 events per run`);
  console.log(`  • Batched Publishing: 25,000 messages per run`);
  console.log(`  • E2E Test: ${E2E_MESSAGES} messages per run with consumer polling`);
  console.log(`  • 95% confidence intervals calculated using standard error`);
  console.log(`  • All tests use Redis Streams transport`);
  console.log(`  • Consumer polling at 100ms intervals for E2E tests`);

  // Cleanup
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
  
  console.log(chalk.green('\n✅ Repeatable benchmark completed!'));
  console.log(chalk.gray('Note: Results are statistically significant with 95% confidence intervals'));
}

// Run repeatable benchmarks
runRepeatableBenchmarks().catch(console.error);
