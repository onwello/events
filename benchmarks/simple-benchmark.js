#!/usr/bin/env node

const Redis = require('ioredis');
const { performance } = require('perf_hooks');
const chalk = require('chalk');

// Simple performance measurement
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

// Generate test events
function generateTestEvent(type) {
  const now = new Date().toISOString();
  
  switch (type) {
    case 'TEST.user.created':
      return {
        userId: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: `User ${Math.floor(Math.random() * 10000)}`,
        email: `user${Math.floor(Math.random() * 10000)}@example.com`,
        createdAt: now
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

// Simple Redis Streams publisher
class SimpleRedisPublisher {
  constructor(redis, stream = 'test-events-stream') {
    this.redis = redis;
    this.stream = stream;
  }
  
  async publish(eventType, data) {
    const envelope = {
      header: {
        id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: eventType,
        origin: 'benchmark-service',
        timestamp: new Date().toISOString(),
        hash: `hash-${Math.random().toString(36).substr(2, 9)}`,
        version: '1.0.0'
      },
      body: data
    };
    
    await this.redis.xadd(this.stream, '*', 'data', JSON.stringify({ pattern: eventType, data: envelope }));
  }
  
  async publishBatch(eventType, events) {
    const pipeline = this.redis.pipeline();
    
    for (const event of events) {
      const envelope = {
        header: {
          id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: eventType,
          origin: 'benchmark-service',
          timestamp: new Date().toISOString(),
          hash: `hash-${Math.random().toString(36).substr(2, 9)}`,
          version: '1.0.0'
        },
        body: event
      };
      
      pipeline.xadd(this.stream, '*', 'data', JSON.stringify({ pattern: eventType, data: envelope }));
    }
    
    await pipeline.exec();
  }
}

// Simple Redis Streams consumer
class SimpleRedisConsumer {
  constructor(redis, stream = 'test-events-stream', group = 'benchmark-group', consumer = 'benchmark-consumer') {
    this.redis = redis;
    this.stream = stream;
    this.group = group;
    this.consumer = consumer;
    this.running = false;
  }
  
  async start() {
    try {
      await this.redis.xgroup('CREATE', this.stream, this.group, '$', 'MKSTREAM');
    } catch (e) {
      // Group might already exist
    }
    
    this.running = true;
    this.poll();
  }
  
  async stop() {
    this.running = false;
  }
  
  async poll() {
    while (this.running) {
      try {
        const messages = await this.redis.xreadgroup(
          'GROUP', this.group, this.consumer,
          'COUNT', 10,
          'BLOCK', 1000,
          'STREAMS', this.stream, '>'
        );
        
        if (messages && messages.length > 0) {
          for (const [stream, streamMessages] of messages) {
            for (const [id, fields] of streamMessages) {
              try {
                const raw = JSON.parse(fields.data);
                const envelope = raw.data;
                
                // Process the message
                if (envelope && envelope.header) {
                  // Simulate processing
                  await new Promise(resolve => setTimeout(resolve, 1));
                }
                
                await this.redis.xack(this.stream, this.group, id);
              } catch (err) {
                console.error('Error processing message:', err);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error in poll loop:', err);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}

async function runBenchmarks() {
  console.log(chalk.blue('🚀 @logistically/events Simple Performance Benchmark'));
  console.log(chalk.blue('='.repeat(60)));
  
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
  
  const publisher = new SimpleRedisPublisher(redis);
  const consumer = new SimpleRedisConsumer(redis);
  
  // Start consumer
  await consumer.start();
  
  const results = [];
  
  // Test 1: Individual event publishing
  const individualResult = measurePerformance('Individual Event Publishing', async () => {
    const event = generateTestEvent('TEST.user.created');
    await publisher.publish('TEST.user.created', event);
  }, 1000);
  results.push(individualResult);
  
  // Test 2: Batched event publishing
  const batchResult = measurePerformance('Batched Event Publishing', async () => {
    const events = Array.from({ length: 50 }, () => generateTestEvent('TEST.order.created'));
    await publisher.publishBatch('TEST.order.created', events);
  }, 100);
  results.push(batchResult);
  
  // Test 3: Concurrent publishing
  const concurrentResult = measurePerformance('Concurrent Event Publishing', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      const event = generateTestEvent('TEST.payment.processed');
      promises.push(publisher.publish('TEST.payment.processed', event));
    }
    await Promise.all(promises);
  }, 100);
  results.push(concurrentResult);
  
  // Test 4: End-to-end latency
  const e2eResult = measurePerformance('End-to-End Latency', async () => {
    const event = generateTestEvent('TEST.user.created');
    const start = performance.now();
    await publisher.publish('TEST.user.created', event);
    
    // Wait for consumption (simplified)
    await new Promise(resolve => setTimeout(resolve, 10));
    const end = performance.now();
    
    return end - start;
  }, 500);
  results.push(e2eResult);
  
  // Print summary
  console.log(chalk.magenta('\n📊 BENCHMARK SUMMARY'));
  console.log(chalk.magenta('='.repeat(60)));
  
  results.forEach((result, index) => {
    const names = ['Individual', 'Batched', 'Concurrent', 'E2E'];
    console.log(chalk.yellow(`${names[index]}:`));
    console.log(`  Throughput: ${result.throughput.toFixed(2)} ops/sec`);
    console.log(`  Memory: ${(result.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log('');
  });
  
  // Cleanup
  await consumer.stop();
  await redis.quit();
  
  console.log(chalk.green('✅ Benchmarks completed!'));
}

// Run benchmarks
runBenchmarks().catch(console.error);
