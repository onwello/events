import { EventPublisher, BatchedEventPublisher } from '@logistically/events';
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
  measureThroughput, 
  BenchmarkReporter, 
  BenchmarkResult,
  PerformanceMonitor 
} from './utils';
import * as chalk from 'chalk';
import * as cliProgress from 'cli-progress';

export interface ThroughputBenchmarkConfig {
  individualEvents: number;
  batchSize: number;
  batchCount: number;
  concurrentPublishers: number;
  concurrentEvents: number;
  warmupIterations: number;
}

export const defaultThroughputConfig: ThroughputBenchmarkConfig = {
  individualEvents: 10000,
  batchSize: 100,
  batchCount: 50,
  concurrentPublishers: 10,
  concurrentEvents: 1000,
  warmupIterations: 100
};

export class ThroughputBenchmark {
  private redis: any;
  private transport: any;
  private validator: DefaultEventValidator;
  private publisher: EventPublisher;
  private batchedPublisher: BatchedEventPublisher;
  private results: BenchmarkResult[] = [];

  constructor(private config: ThroughputBenchmarkConfig = defaultThroughputConfig) {
    this.validator = new DefaultEventValidator({
      'TEST.user.created': UserCreatedSchema,
      'TEST.order.created': OrderCreatedSchema,
      'TEST.payment.processed': PaymentProcessedSchema
    });
  }

  async setup(): Promise<void> {
    console.log(chalk.blue('🚀 Setting up Throughput Benchmark...'));
    
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
          maxConcurrentBatches: 5
        }
      }
    );

    console.log('✅ Setup completed');
  }

  async runIndividualThroughputTest(): Promise<BenchmarkResult> {
    console.log(chalk.yellow('\n📊 Testing Individual Event Publishing Throughput...'));
    
    const progressBar = new cliProgress.SingleBar({
      format: 'Individual Events |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(this.config.individualEvents, 0);

    const result = await measureThroughput(
      'Individual Event Publishing',
      async () => {
        const event = generateTestEvent('TEST.user.created');
        await this.publisher.publish('TEST.user.created', event);
        progressBar.increment();
      },
      this.config.individualEvents,
      this.config.warmupIterations
    );

    progressBar.stop();
    return result;
  }

  async runBatchedThroughputTest(): Promise<BenchmarkResult> {
    console.log(chalk.yellow('\n📦 Testing Batched Event Publishing Throughput...'));
    
    const progressBar = new cliProgress.SingleBar({
      format: 'Batched Events |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(this.config.batchCount, 0);

    const result = await measureThroughput(
      'Batched Event Publishing',
      async () => {
        const events = generateBatchEvents('TEST.order.created', this.config.batchSize);
        await this.batchedPublisher.publishBatch('TEST.order.created', events);
        progressBar.increment();
      },
      this.config.batchCount,
      this.config.warmupIterations
    );

    progressBar.stop();
    return result;
  }

  async runConcurrentThroughputTest(): Promise<BenchmarkResult> {
    console.log(chalk.yellow('\n⚡ Testing Concurrent Event Publishing Throughput...'));
    
    const progressBar = new cliProgress.SingleBar({
      format: 'Concurrent Events |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(this.config.concurrentEvents, 0);

    const monitor = new PerformanceMonitor();
    monitor.start();

    // Create multiple concurrent publishers
    const publishers = Array.from({ length: this.config.concurrentPublishers }, () => 
      new EventPublisher(
        { redis: this.transport },
        {
          originServiceName: 'benchmark-service',
          validator: this.validator
        }
      )
    );

    const promises: Promise<void>[] = [];
    let completed = 0;

    for (let i = 0; i < this.config.concurrentEvents; i++) {
      const publisher = publishers[i % publishers.length];
      const promise = publisher.publish('TEST.payment.processed', generateTestEvent('TEST.payment.processed'))
        .then(() => {
          completed++;
          progressBar.update(completed);
        });
      promises.push(promise);
    }

    await Promise.all(promises);
    const duration = monitor.end();
    const memoryUsage = monitor.getMemoryUsage();
    const throughput = (this.config.concurrentEvents / duration) * 1000;

    progressBar.stop();

    return {
      name: 'Concurrent Event Publishing',
      duration,
      count: this.config.concurrentEvents,
      throughput,
      memoryUsage,
      gcStats: monitor.getGCStats()
    };
  }

  async runMemoryEfficiencyTest(): Promise<BenchmarkResult> {
    console.log(chalk.yellow('\n🧠 Testing Memory Efficiency...'));
    
    const monitor = new PerformanceMonitor();
    monitor.start();

    // Publish events and monitor memory growth
    const events = generateBatchEvents('user.created', 1000);
    let totalMemory = 0;
    let memorySamples = 0;

    for (let i = 0; i < 10; i++) {
      const beforeMemory = process.memoryUsage().heapUsed;
      
      for (let j = 0; j < 100; j++) {
        await this.publisher.publish('TEST.user.created', events[j]);
      }
      
      const afterMemory = process.memoryUsage().heapUsed;
      totalMemory += (afterMemory - beforeMemory);
      memorySamples++;
    }

    const duration = monitor.end();
    const memoryUsage = monitor.getMemoryUsage();
    const avgMemoryGrowth = totalMemory / memorySamples;
    const throughput = (1000 / duration) * 1000;

    return {
      name: 'Memory Efficiency Test',
      duration,
      count: 1000,
      throughput,
      memoryUsage: {
        ...memoryUsage,
        heapUsed: avgMemoryGrowth // Use average memory growth as metric
      },
      gcStats: monitor.getGCStats()
    };
  }

  async run(): Promise<BenchmarkResult[]> {
    try {
      await this.setup();

      console.log(chalk.green('\n🎯 Starting Throughput Benchmarks...'));
      console.log(chalk.gray(`Configuration:`));
      console.log(chalk.gray(`  Individual Events: ${this.config.individualEvents.toLocaleString()}`));
      console.log(chalk.gray(`  Batch Size: ${this.config.batchSize}`));
      console.log(chalk.gray(`  Batch Count: ${this.config.batchCount}`));
      console.log(chalk.gray(`  Concurrent Publishers: ${this.config.concurrentPublishers}`));
      console.log(chalk.gray(`  Concurrent Events: ${this.config.concurrentEvents.toLocaleString()}`));

      // Run individual throughput test
      const individualResult = await this.runIndividualThroughputTest();
      this.results.push(individualResult);
      BenchmarkReporter.printResult(individualResult);

      // Run batched throughput test
      const batchedResult = await this.runBatchedThroughputTest();
      this.results.push(batchedResult);
      BenchmarkReporter.printResult(batchedResult);

      // Run concurrent throughput test
      const concurrentResult = await this.runConcurrentThroughputTest();
      this.results.push(concurrentResult);
      BenchmarkReporter.printResult(concurrentResult);

      // Run memory efficiency test
      const memoryResult = await this.runMemoryEfficiencyTest();
      this.results.push(memoryResult);
      BenchmarkReporter.printResult(memoryResult);

      // Print summary
      BenchmarkReporter.printSummary(this.results);

      return this.results;

    } catch (error) {
      console.error(chalk.red('❌ Benchmark failed:'), error);
      throw error;
    } finally {
      await this.cleanup();
    }
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

  getResults(): BenchmarkResult[] {
    return this.results;
  }
}

// CLI entry point
async function main() {
  const config = defaultThroughputConfig;
  
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

  const benchmark = new ThroughputBenchmark(config);
  await benchmark.run();
}

if (require.main === module) {
  main().catch(console.error);
}
