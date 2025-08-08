import { EventPublisher, BatchedEventPublisher } from '@logistically/events';
import { DefaultEventValidator } from '@logistically/events';
import { 
  setupRedisForBenchmarks, 
  cleanupRedis, 
  generateTestEvent,
  UserCreatedSchema,
  OrderCreatedSchema,
  PaymentProcessedSchema
} from './redis-setup';
import { 
  BenchmarkReporter, 
  BenchmarkResult,
  PerformanceMonitor,
  calculateStats
} from './utils';
import * as chalk from 'chalk';
import * as performance from 'performance-now';

export interface LatencyBenchmarkConfig {
  iterations: number;
  warmupIterations: number;
  batchSize: number;
  concurrentPublishers: number;
}

export const defaultLatencyConfig: LatencyBenchmarkConfig = {
  iterations: 1000,
  warmupIterations: 100,
  batchSize: 50,
  concurrentPublishers: 5
};

export interface LatencyResult {
  name: string;
  stats: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p95: number;
    p99: number;
  };
  memoryUsage: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
}

export class LatencyBenchmark {
  private redis: any;
  private transport: any;
  private validator: DefaultEventValidator;
  private publisher: EventPublisher;
  private batchedPublisher: BatchedEventPublisher;
  private results: LatencyResult[] = [];

  constructor(private config: LatencyBenchmarkConfig = defaultLatencyConfig) {
    this.validator = new DefaultEventValidator({
      'user.created': UserCreatedSchema,
      'order.created': OrderCreatedSchema,
      'payment.processed': PaymentProcessedSchema
    });
  }

  async setup(): Promise<void> {
    console.log(chalk.blue('🚀 Setting up Latency Benchmark...'));
    
    const setup = await setupRedisForBenchmarks();
    this.redis = setup.redis;
    this.transport = setup.transport;

    this.publisher = new EventPublisher(
      { redis: this.transport },
      {
        originServiceName: 'benchmark-service',
        validator: this.validator
      }
    );

    this.batchedPublisher = new BatchedEventPublisher(
      { redis: this.transport },
      {
        originServiceName: 'benchmark-service',
        validator: this.validator,
        batchConfig: {
          maxSize: this.config.batchSize,
          maxWaitMs: 1000,
          maxConcurrentBatches: 3
        }
      }
    );

    console.log('✅ Setup completed');
  }

  async measureIndividualLatency(): Promise<LatencyResult> {
    console.log(chalk.yellow('\n⏱️  Measuring Individual Event Latency...'));
    
    const latencies: number[] = [];
    const event = generateTestEvent('user.created');

    // Warmup
    for (let i = 0; i < this.config.warmupIterations; i++) {
      await this.publisher.publish('user.created', event);
    }

    // Force GC before measurement
    if (global.gc) {
      global.gc();
    }

    // Measure latencies
    for (let i = 0; i < this.config.iterations; i++) {
      const start = performance();
      await this.publisher.publish('user.created', event);
      const end = performance();
      latencies.push(end - start);
    }

    const stats = calculateStats(latencies);
    const memoryUsage = process.memoryUsage();

    return {
      name: 'Individual Event Latency',
      stats,
      memoryUsage: {
        rss: memoryUsage.rss,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external
      }
    };
  }

  async measureBatchedLatency(): Promise<LatencyResult> {
    console.log(chalk.yellow('\n📦 Measuring Batched Event Latency...'));
    
    const latencies: number[] = [];
    const events = Array.from({ length: this.config.batchSize }, () => generateTestEvent('order.created'));

    // Warmup
    for (let i = 0; i < this.config.warmupIterations; i++) {
      await this.batchedPublisher.publishBatch('order.created', events);
    }

    // Force GC before measurement
    if (global.gc) {
      global.gc();
    }

    // Measure latencies
    for (let i = 0; i < this.config.iterations; i++) {
      const start = performance();
      await this.batchedPublisher.publishBatch('order.created', events);
      const end = performance();
      latencies.push(end - start);
    }

    const stats = calculateStats(latencies);
    const memoryUsage = process.memoryUsage();

    return {
      name: 'Batched Event Latency',
      stats,
      memoryUsage: {
        rss: memoryUsage.rss,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external
      }
    };
  }

  async measureConcurrentLatency(): Promise<LatencyResult> {
    console.log(chalk.yellow('\n⚡ Measuring Concurrent Event Latency...'));
    
    const latencies: number[] = [];
    const event = generateTestEvent('payment.processed');

    // Create multiple publishers
    const publishers = Array.from({ length: this.config.concurrentPublishers }, () => 
      new EventPublisher(
        { redis: this.transport },
        {
          originServiceName: 'benchmark-service',
          validator: this.validator
        }
      )
    );

    // Warmup
    for (let i = 0; i < this.config.warmupIterations; i++) {
      const publisher = publishers[i % publishers.length];
      await publisher.publish('payment.processed', event);
    }

    // Force GC before measurement
    if (global.gc) {
      global.gc();
    }

    // Measure latencies with concurrent publishers
    const promises: Promise<number>[] = [];
    
    for (let i = 0; i < this.config.iterations; i++) {
      const publisher = publishers[i % publishers.length];
      const promise = (async () => {
        const start = performance();
        await publisher.publish('payment.processed', event);
        const end = performance();
        return end - start;
      })();
      promises.push(promise);
    }

    const results = await Promise.all(promises);
    latencies.push(...results);

    const stats = calculateStats(latencies);
    const memoryUsage = process.memoryUsage();

    return {
      name: 'Concurrent Event Latency',
      stats,
      memoryUsage: {
        rss: memoryUsage.rss,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external
      }
    };
  }

  async measureEndToEndLatency(): Promise<LatencyResult> {
    console.log(chalk.yellow('\n🔄 Measuring End-to-End Latency (Publish + Consume)...'));
    
    const latencies: number[] = [];
    const event = generateTestEvent('user.created');
    let consumedCount = 0;
    const targetCount = this.config.iterations;

    // Set up consumer
    const { EventConsumer } = require('@logistically/events');
    const consumer = new EventConsumer({
      handlers: {
        'user.created': async (body: any, header: any) => {
          consumedCount++;
        }
      },
      validator: this.validator
    });

    // Set up Redis Streams consumer
    const { RedisStreamsConsumer } = require('@logistically/events');
    const streamsConsumer = new RedisStreamsConsumer(
      this.redis,
      {
        stream: 'user-events',
        group: 'benchmark-group',
        consumer: 'benchmark-consumer',
        blockMs: 1000,
        count: 10
      }
    );

    // Start consumer
    streamsConsumer.addHandler('user.created', async (body: any, header: any) => {
      consumedCount++;
    });

    await streamsConsumer.start();

    // Warmup
    for (let i = 0; i < this.config.warmupIterations; i++) {
      await this.publisher.publish('user.created', event);
    }

    // Force GC before measurement
    if (global.gc) {
      global.gc();
    }

    // Measure end-to-end latencies
    for (let i = 0; i < this.config.iterations; i++) {
      const start = performance();
      await this.publisher.publish('user.created', event);
      
      // Wait for consumption
      while (consumedCount <= i) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      
      const end = performance();
      latencies.push(end - start);
    }

    await streamsConsumer.stop();

    const stats = calculateStats(latencies);
    const memoryUsage = process.memoryUsage();

    return {
      name: 'End-to-End Latency',
      stats,
      memoryUsage: {
        rss: memoryUsage.rss,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external
      }
    };
  }

  async run(): Promise<LatencyResult[]> {
    try {
      await this.setup();

      console.log(chalk.green('\n🎯 Starting Latency Benchmarks...'));
      console.log(chalk.gray(`Configuration:`));
      console.log(chalk.gray(`  Iterations: ${this.config.iterations.toLocaleString()}`));
      console.log(chalk.gray(`  Warmup Iterations: ${this.config.warmupIterations}`));
      console.log(chalk.gray(`  Batch Size: ${this.config.batchSize}`));
      console.log(chalk.gray(`  Concurrent Publishers: ${this.config.concurrentPublishers}`));

      // Run individual latency test
      const individualResult = await this.measureIndividualLatency();
      this.results.push(individualResult);
      this.printLatencyResult(individualResult);

      // Run batched latency test
      const batchedResult = await this.measureBatchedLatency();
      this.results.push(batchedResult);
      this.printLatencyResult(batchedResult);

      // Run concurrent latency test
      const concurrentResult = await this.measureConcurrentLatency();
      this.results.push(concurrentResult);
      this.printLatencyResult(concurrentResult);

      // Run end-to-end latency test
      const e2eResult = await this.measureEndToEndLatency();
      this.results.push(e2eResult);
      this.printLatencyResult(e2eResult);

      // Print summary
      this.printLatencySummary();

      return this.results;

    } catch (error) {
      console.error(chalk.red('❌ Latency benchmark failed:'), error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private printLatencyResult(result: LatencyResult): void {
    console.log('\n' + chalk.blue('='.repeat(60)));
    console.log(chalk.yellow(`Latency Benchmark: ${result.name}`));
    console.log(chalk.blue('='.repeat(60)));
    
    console.log(chalk.green('Latency Statistics (ms):'));
    console.log(`  Min: ${result.stats.min.toFixed(3)}`);
    console.log(`  Max: ${result.stats.max.toFixed(3)}`);
    console.log(`  Mean: ${result.stats.mean.toFixed(3)}`);
    console.log(`  Median: ${result.stats.median.toFixed(3)}`);
    console.log(`  P95: ${result.stats.p95.toFixed(3)}`);
    console.log(`  P99: ${result.stats.p99.toFixed(3)}`);
    
    console.log(chalk.cyan('\nMemory Usage:'));
    console.log(`  RSS: ${PerformanceMonitor.formatBytes(result.memoryUsage.rss)}`);
    console.log(`  Heap Used: ${PerformanceMonitor.formatBytes(result.memoryUsage.heapUsed)}`);
    console.log(`  Heap Total: ${PerformanceMonitor.formatBytes(result.memoryUsage.heapTotal)}`);
    console.log(`  External: ${PerformanceMonitor.formatBytes(result.memoryUsage.external)}`);
    
    console.log(chalk.blue('='.repeat(60)) + '\n');
  }

  private printLatencySummary(): void {
    console.log('\n' + chalk.magenta('📊 LATENCY BENCHMARK SUMMARY'));
    console.log(chalk.magenta('='.repeat(60)));
    
    this.results.forEach(result => {
      console.log(chalk.yellow(`${result.name}:`));
      console.log(`  P50: ${result.stats.median.toFixed(3)}ms`);
      console.log(`  P95: ${result.stats.p95.toFixed(3)}ms`);
      console.log(`  P99: ${result.stats.p99.toFixed(3)}ms`);
      console.log(`  Mean: ${result.stats.mean.toFixed(3)}ms`);
      console.log('');
    });
  }

  async cleanup(): Promise<void> {
    try {
      if (this.publisher) {
        await this.publisher.close();
      }
      if (this.batchedPublisher) {
        await this.batchedPublisher.close();
      }
      if (this.redis) {
        await cleanupRedis(this.redis);
      }
    } catch (error) {
      console.warn(chalk.yellow('Warning: Cleanup failed:'), error);
    }
  }

  getResults(): LatencyResult[] {
    return this.results;
  }
}

// CLI entry point
async function main() {
  const config = defaultLatencyConfig;
  
  // Allow command line overrides
  const args = process.argv.slice(2);
  if (args.length > 0) {
    config.iterations = parseInt(args[0]) || config.iterations;
  }
  if (args.length > 1) {
    config.batchSize = parseInt(args[1]) || config.batchSize;
  }
  if (args.length > 2) {
    config.concurrentPublishers = parseInt(args[2]) || config.concurrentPublishers;
  }

  const benchmark = new LatencyBenchmark(config);
  await benchmark.run();
}

if (require.main === module) {
  main().catch(console.error);
}
