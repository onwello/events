import { EventPublisher, BatchedEventPublisher, EventConsumer, RedisStreamsConsumer } from '@logistically/events';
import { DefaultEventValidator } from '@logistically/events';
import { 
  setupRedisForBenchmarks, 
  cleanupRedis, 
  generateTestEvent,
  generateBatchEvents,
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
import * as cliProgress from 'cli-progress';

export interface E2EBenchmarkConfig {
  individualEvents: number;
  batchSize: number;
  batchCount: number;
  concurrentPublishers: number;
  concurrentConsumers: number;
  warmupIterations: number;
}

export const defaultE2EConfig: E2EBenchmarkConfig = {
  individualEvents: 5000,
  batchSize: 50,
  batchCount: 100,
  concurrentPublishers: 5,
  concurrentConsumers: 3,
  warmupIterations: 50
};

export interface E2EResult {
  name: string;
  publishedCount: number;
  consumedCount: number;
  lostCount: number;
  duration: number;
  throughput: number;
  latency: {
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

export class E2EBenchmark {
  private redis: any;
  private transport: any;
  private validator: DefaultEventValidator;
  private publisher: EventPublisher;
  private batchedPublisher: BatchedEventPublisher;
  private consumer: EventConsumer;
  private streamsConsumer: RedisStreamsConsumer;
  private results: E2EResult[] = [];

  constructor(private config: E2EBenchmarkConfig = defaultE2EConfig) {
    this.validator = new DefaultEventValidator({
      'user.created': UserCreatedSchema,
      'order.created': OrderCreatedSchema,
      'payment.processed': PaymentProcessedSchema
    });
  }

  async setup(): Promise<void> {
    console.log(chalk.blue('🚀 Setting up E2E Benchmark...'));
    
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

    this.consumer = new EventConsumer({
      handlers: {},
      validator: this.validator
    });

    this.streamsConsumer = new RedisStreamsConsumer(
      this.redis,
      {
        stream: 'user-events',
        group: 'benchmark-group',
        consumer: 'benchmark-consumer',
        blockMs: 1000,
        count: 10
      }
    );

    console.log('✅ Setup completed');
  }

  async runIndividualE2ETest(): Promise<E2EResult> {
    console.log(chalk.yellow('\n🔄 Testing Individual Event E2E (Publish → Consume)...'));
    
    const latencies: number[] = [];
    let consumedCount = 0;
    let publishedCount = 0;
    const targetCount = this.config.individualEvents;

    // Set up consumer handler
    this.streamsConsumer.addHandler('user.created', async (body: any, header: any) => {
      consumedCount++;
    });

    await this.streamsConsumer.start();

    const progressBar = new cliProgress.SingleBar({
      format: 'Individual E2E |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(targetCount, 0);

    const monitor = new PerformanceMonitor();
    monitor.start();

    // Publish events and measure end-to-end latency
    for (let i = 0; i < targetCount; i++) {
      const start = performance();
      const event = generateTestEvent('user.created');
      await this.publisher.publish('user.created', event);
      publishedCount++;

      // Wait for consumption with timeout
      const waitStart = performance();
      while (consumedCount <= i && (performance() - waitStart) < 5000) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      const end = performance();
      latencies.push(end - start);
      progressBar.increment();
    }

    const duration = monitor.end();
    const memoryUsage = monitor.getMemoryUsage();
    const throughput = (publishedCount / duration) * 1000;
    const lostCount = publishedCount - consumedCount;

    progressBar.stop();
    await this.streamsConsumer.stop();

    const latencyStats = calculateStats(latencies);

    return {
      name: 'Individual Event E2E',
      publishedCount,
      consumedCount,
      lostCount,
      duration,
      throughput,
      latency: latencyStats,
      memoryUsage
    };
  }

  async runBatchedE2ETest(): Promise<E2EResult> {
    console.log(chalk.yellow('\n📦 Testing Batched Event E2E (Publish → Consume)...'));
    
    const latencies: number[] = [];
    let consumedCount = 0;
    let publishedCount = 0;
    const targetBatches = this.config.batchCount;

    // Set up consumer handler
    this.streamsConsumer.addHandler('order.created', async (body: any, header: any) => {
      consumedCount++;
    });

    await this.streamsConsumer.start();

    const progressBar = new cliProgress.SingleBar({
      format: 'Batched E2E |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(targetBatches, 0);

    const monitor = new PerformanceMonitor();
    monitor.start();

    // Publish batched events and measure end-to-end latency
    for (let i = 0; i < targetBatches; i++) {
      const start = performance();
      const events = generateBatchEvents('order.created', this.config.batchSize);
      await this.batchedPublisher.publishBatch('order.created', events);
      publishedCount += events.length;

      // Wait for consumption with timeout
      const waitStart = performance();
      while (consumedCount < publishedCount && (performance() - waitStart) < 10000) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      const end = performance();
      latencies.push(end - start);
      progressBar.increment();
    }

    const duration = monitor.end();
    const memoryUsage = monitor.getMemoryUsage();
    const throughput = (publishedCount / duration) * 1000;
    const lostCount = publishedCount - consumedCount;

    progressBar.stop();
    await this.streamsConsumer.stop();

    const latencyStats = calculateStats(latencies);

    return {
      name: 'Batched Event E2E',
      publishedCount,
      consumedCount,
      lostCount,
      duration,
      throughput,
      latency: latencyStats,
      memoryUsage
    };
  }

  async runConcurrentE2ETest(): Promise<E2EResult> {
    console.log(chalk.yellow('\n⚡ Testing Concurrent Event E2E (Publish → Consume)...'));
    
    const latencies: number[] = [];
    let consumedCount = 0;
    let publishedCount = 0;
    const targetEvents = this.config.individualEvents;

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

    // Set up consumer handler
    this.streamsConsumer.addHandler('payment.processed', async (body: any, header: any) => {
      consumedCount++;
    });

    await this.streamsConsumer.start();

    const progressBar = new cliProgress.SingleBar({
      format: 'Concurrent E2E |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(targetEvents, 0);

    const monitor = new PerformanceMonitor();
    monitor.start();

    // Publish events concurrently and measure end-to-end latency
    const promises: Promise<number>[] = [];
    
    for (let i = 0; i < targetEvents; i++) {
      const publisher = publishers[i % publishers.length];
      const promise = (async () => {
        const start = performance();
        const event = generateTestEvent('payment.processed');
        await publisher.publish('payment.processed', event);
        publishedCount++;

        // Wait for consumption with timeout
        const waitStart = performance();
        while (consumedCount < publishedCount && (performance() - waitStart) < 5000) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }

        const end = performance();
        progressBar.increment();
        return end - start;
      })();
      promises.push(promise);
    }

    const results = await Promise.all(promises);
    latencies.push(...results);

    const duration = monitor.end();
    const memoryUsage = monitor.getMemoryUsage();
    const throughput = (publishedCount / duration) * 1000;
    const lostCount = publishedCount - consumedCount;

    progressBar.stop();
    await this.streamsConsumer.stop();

    const latencyStats = calculateStats(latencies);

    return {
      name: 'Concurrent Event E2E',
      publishedCount,
      consumedCount,
      lostCount,
      duration,
      throughput,
      latency: latencyStats,
      memoryUsage
    };
  }

  async runReliabilityTest(): Promise<E2EResult> {
    console.log(chalk.yellow('\n🛡️  Testing Reliability (Message Loss Prevention)...'));
    
    const latencies: number[] = [];
    let consumedCount = 0;
    let publishedCount = 0;
    const targetEvents = 1000;

    // Set up consumer handler with processing delay to test reliability
    this.streamsConsumer.addHandler('user.created', async (body: any, header: any) => {
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
      consumedCount++;
    });

    await this.streamsConsumer.start();

    const progressBar = new cliProgress.SingleBar({
      format: 'Reliability Test |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(targetEvents, 0);

    const monitor = new PerformanceMonitor();
    monitor.start();

    // Publish events rapidly to test reliability
    for (let i = 0; i < targetEvents; i++) {
      const start = performance();
      const event = generateTestEvent('user.created');
      await this.publisher.publish('user.created', event);
      publishedCount++;
      progressBar.increment();

      const end = performance();
      latencies.push(end - start);
    }

    // Wait for all events to be consumed
    const waitStart = performance();
    while (consumedCount < publishedCount && (performance() - waitStart) < 30000) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const duration = monitor.end();
    const memoryUsage = monitor.getMemoryUsage();
    const throughput = (publishedCount / duration) * 1000;
    const lostCount = publishedCount - consumedCount;

    progressBar.stop();
    await this.streamsConsumer.stop();

    const latencyStats = calculateStats(latencies);

    return {
      name: 'Reliability Test',
      publishedCount,
      consumedCount,
      lostCount,
      duration,
      throughput,
      latency: latencyStats,
      memoryUsage
    };
  }

  async run(): Promise<E2EResult[]> {
    try {
      await this.setup();

      console.log(chalk.green('\n🎯 Starting E2E Benchmarks...'));
      console.log(chalk.gray(`Configuration:`));
      console.log(chalk.gray(`  Individual Events: ${this.config.individualEvents.toLocaleString()}`));
      console.log(chalk.gray(`  Batch Size: ${this.config.batchSize}`));
      console.log(chalk.gray(`  Batch Count: ${this.config.batchCount}`));
      console.log(chalk.gray(`  Concurrent Publishers: ${this.config.concurrentPublishers}`));
      console.log(chalk.gray(`  Concurrent Consumers: ${this.config.concurrentConsumers}`));

      // Run individual E2E test
      const individualResult = await this.runIndividualE2ETest();
      this.results.push(individualResult);
      this.printE2EResult(individualResult);

      // Run batched E2E test
      const batchedResult = await this.runBatchedE2ETest();
      this.results.push(batchedResult);
      this.printE2EResult(batchedResult);

      // Run concurrent E2E test
      const concurrentResult = await this.runConcurrentE2ETest();
      this.results.push(concurrentResult);
      this.printE2EResult(concurrentResult);

      // Run reliability test
      const reliabilityResult = await this.runReliabilityTest();
      this.results.push(reliabilityResult);
      this.printE2EResult(reliabilityResult);

      // Print summary
      this.printE2ESummary();

      return this.results;

    } catch (error) {
      console.error(chalk.red('❌ E2E benchmark failed:'), error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private printE2EResult(result: E2EResult): void {
    console.log('\n' + chalk.blue('='.repeat(60)));
    console.log(chalk.yellow(`E2E Benchmark: ${result.name}`));
    console.log(chalk.blue('='.repeat(60)));
    
    console.log(chalk.green('Results:'));
    console.log(`  Published: ${result.publishedCount.toLocaleString()}`);
    console.log(`  Consumed: ${result.consumedCount.toLocaleString()}`);
    console.log(`  Lost: ${result.lostCount.toLocaleString()}`);
    console.log(`  Loss Rate: ${((result.lostCount / result.publishedCount) * 100).toFixed(2)}%`);
    console.log(`  Duration: ${PerformanceMonitor.formatDuration(result.duration)}`);
    console.log(`  Throughput: ${PerformanceMonitor.formatThroughput(result.throughput)}`);
    
    console.log(chalk.cyan('\nLatency Statistics (ms):'));
    console.log(`  Min: ${result.latency.min.toFixed(3)}`);
    console.log(`  Max: ${result.latency.max.toFixed(3)}`);
    console.log(`  Mean: ${result.latency.mean.toFixed(3)}`);
    console.log(`  Median: ${result.latency.median.toFixed(3)}`);
    console.log(`  P95: ${result.latency.p95.toFixed(3)}`);
    console.log(`  P99: ${result.latency.p99.toFixed(3)}`);
    
    console.log(chalk.cyan('\nMemory Usage:'));
    console.log(`  RSS: ${PerformanceMonitor.formatBytes(result.memoryUsage.rss)}`);
    console.log(`  Heap Used: ${PerformanceMonitor.formatBytes(result.memoryUsage.heapUsed)}`);
    console.log(`  Heap Total: ${PerformanceMonitor.formatBytes(result.memoryUsage.heapTotal)}`);
    console.log(`  External: ${PerformanceMonitor.formatBytes(result.memoryUsage.external)}`);
    
    console.log(chalk.blue('='.repeat(60)) + '\n');
  }

  private printE2ESummary(): void {
    console.log('\n' + chalk.magenta('📊 E2E BENCHMARK SUMMARY'));
    console.log(chalk.magenta('='.repeat(60)));
    
    this.results.forEach(result => {
      console.log(chalk.yellow(`${result.name}:`));
      console.log(`  Throughput: ${PerformanceMonitor.formatThroughput(result.throughput)}`);
      console.log(`  Loss Rate: ${((result.lostCount / result.publishedCount) * 100).toFixed(2)}%`);
      console.log(`  P95 Latency: ${result.latency.p95.toFixed(3)}ms`);
      console.log(`  Memory: ${PerformanceMonitor.formatBytes(result.memoryUsage.heapUsed)}`);
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
      if (this.streamsConsumer) {
        await this.streamsConsumer.stop();
      }
      if (this.redis) {
        await cleanupRedis(this.redis);
      }
    } catch (error) {
      console.warn(chalk.yellow('Warning: Cleanup failed:'), error);
    }
  }

  getResults(): E2EResult[] {
    return this.results;
  }
}

// CLI entry point
async function main() {
  const config = defaultE2EConfig;
  
  // Allow command line overrides
  const args = process.argv.slice(2);
  if (args.length > 0) {
    config.individualEvents = parseInt(args[0]) || config.individualEvents;
  }
  if (args.length > 1) {
    config.batchSize = parseInt(args[1]) || config.batchSize;
  }
  if (args.length > 2) {
    config.concurrentPublishers = parseInt(args[2]) || config.concurrentPublishers;
  }

  const benchmark = new E2EBenchmark(config);
  await benchmark.run();
}

if (require.main === module) {
  main().catch(console.error);
}
