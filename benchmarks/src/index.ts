import { ThroughputBenchmark } from './throughput-benchmark';
import { LatencyBenchmark } from './latency-benchmark';
import { E2EBenchmark } from './e2e-benchmark';
import { BenchmarkReporter, BenchmarkResult } from './utils';
import * as chalk from 'chalk';

export interface BenchmarkSuiteConfig {
  runThroughput: boolean;
  runLatency: boolean;
  runE2E: boolean;
  throughputConfig?: any;
  latencyConfig?: any;
  e2eConfig?: any;
}

export const defaultBenchmarkConfig: BenchmarkSuiteConfig = {
  runThroughput: true,
  runLatency: true,
  runE2E: true
};

export interface BenchmarkSuiteResult {
  throughput?: BenchmarkResult[];
  latency?: any[];
  e2e?: any[];
  summary: {
    totalDuration: number;
    totalTests: number;
    averageThroughput: number;
    averageLatency: number;
    averageMemoryUsage: number;
  };
}

export class BenchmarkSuite {
  private results: BenchmarkSuiteResult = {
    summary: {
      totalDuration: 0,
      totalTests: 0,
      averageThroughput: 0,
      averageLatency: 0,
      averageMemoryUsage: 0
    }
  };

  constructor(private config: BenchmarkSuiteConfig = defaultBenchmarkConfig) {}

  async run(): Promise<BenchmarkSuiteResult> {
    console.log(chalk.magenta('🚀 @logistically/events Performance Benchmark Suite'));
    console.log(chalk.magenta('='.repeat(60)));
    console.log(chalk.gray('Running comprehensive performance tests...\n'));

    const startTime = Date.now();

    try {
      // Run throughput benchmarks
      if (this.config.runThroughput) {
        console.log(chalk.blue('📊 Running Throughput Benchmarks...'));
        const throughputBenchmark = new ThroughputBenchmark(this.config.throughputConfig);
        this.results.throughput = await throughputBenchmark.run();
        console.log(chalk.green('✅ Throughput benchmarks completed\n'));
      }

      // Run latency benchmarks
      if (this.config.runLatency) {
        console.log(chalk.blue('⏱️  Running Latency Benchmarks...'));
        const latencyBenchmark = new LatencyBenchmark(this.config.latencyConfig);
        this.results.latency = await latencyBenchmark.run();
        console.log(chalk.green('✅ Latency benchmarks completed\n'));
      }

      // Run E2E benchmarks
      if (this.config.runE2E) {
        console.log(chalk.blue('🔄 Running E2E Benchmarks...'));
        const e2eBenchmark = new E2EBenchmark(this.config.e2eConfig);
        this.results.e2e = await e2eBenchmark.run();
        console.log(chalk.green('✅ E2E benchmarks completed\n'));
      }

      // Calculate summary statistics
      this.calculateSummary(startTime);

      // Print final summary
      this.printFinalSummary();

      return this.results;

    } catch (error) {
      console.error(chalk.red('❌ Benchmark suite failed:'), error);
      throw error;
    }
  }

  private calculateSummary(startTime: number): void {
    const totalDuration = Date.now() - startTime;
    let totalTests = 0;
    let totalThroughput = 0;
    let totalLatency = 0;
    let totalMemory = 0;
    let testCount = 0;

    // Aggregate throughput results
    if (this.results.throughput) {
      this.results.throughput.forEach(result => {
        totalThroughput += result.throughput;
        totalMemory += result.memoryUsage.heapUsed;
        testCount++;
      });
      totalTests += this.results.throughput.length;
    }

    // Aggregate latency results
    if (this.results.latency) {
      this.results.latency.forEach(result => {
        totalLatency += result.stats.median;
        totalMemory += result.memoryUsage.heapUsed;
        testCount++;
      });
      totalTests += this.results.latency.length;
    }

    // Aggregate E2E results
    if (this.results.e2e) {
      this.results.e2e.forEach(result => {
        totalThroughput += result.throughput;
        totalLatency += result.latency.median;
        totalMemory += result.memoryUsage.heapUsed;
        testCount++;
      });
      totalTests += this.results.e2e.length;
    }

    this.results.summary = {
      totalDuration,
      totalTests,
      averageThroughput: testCount > 0 ? totalThroughput / testCount : 0,
      averageLatency: testCount > 0 ? totalLatency / testCount : 0,
      averageMemoryUsage: testCount > 0 ? totalMemory / testCount : 0
    };
  }

  private printFinalSummary(): void {
    console.log(chalk.magenta('\n🎯 FINAL BENCHMARK SUMMARY'));
    console.log(chalk.magenta('='.repeat(60)));
    
    console.log(chalk.green('Overall Performance:'));
    console.log(`  Total Duration: ${(this.results.summary.totalDuration / 1000).toFixed(2)}s`);
    console.log(`  Total Tests: ${this.results.summary.totalTests}`);
    console.log(`  Average Throughput: ${BenchmarkReporter.formatThroughput(this.results.summary.averageThroughput)}`);
    console.log(`  Average Latency: ${this.results.summary.averageLatency.toFixed(3)}ms`);
    console.log(`  Average Memory: ${BenchmarkReporter.formatBytes(this.results.summary.averageMemoryUsage)}`);

    console.log(chalk.cyan('\nKey Findings:'));
    
    if (this.results.throughput) {
      const individual = this.results.throughput.find(r => r.name.includes('Individual'));
      const batched = this.results.throughput.find(r => r.name.includes('Batched'));
      const concurrent = this.results.throughput.find(r => r.name.includes('Concurrent'));
      
      if (individual) {
        console.log(`  Individual Publishing: ${BenchmarkReporter.formatThroughput(individual.throughput)}`);
      }
      if (batched) {
        console.log(`  Batched Publishing: ${BenchmarkReporter.formatThroughput(batched.throughput)}`);
      }
      if (concurrent) {
        console.log(`  Concurrent Publishing: ${BenchmarkReporter.formatThroughput(concurrent.throughput)}`);
      }
    }

    if (this.results.latency) {
      const individual = this.results.latency.find(r => r.name.includes('Individual'));
      if (individual) {
        console.log(`  P95 Latency: ${individual.stats.p95.toFixed(3)}ms`);
        console.log(`  P99 Latency: ${individual.stats.p99.toFixed(3)}ms`);
      }
    }

    if (this.results.e2e) {
      const reliability = this.results.e2e.find(r => r.name.includes('Reliability'));
      if (reliability) {
        console.log(`  Message Loss Rate: ${((reliability.lostCount / reliability.publishedCount) * 100).toFixed(2)}%`);
      }
    }

    console.log(chalk.magenta('='.repeat(60)));
    console.log(chalk.green('✅ All benchmarks completed successfully!'));
  }

  getResults(): BenchmarkSuiteResult {
    return this.results;
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const config = { ...defaultBenchmarkConfig };

  // Parse command line arguments
  if (args.includes('--throughput-only')) {
    config.runLatency = false;
    config.runE2E = false;
  }
  if (args.includes('--latency-only')) {
    config.runThroughput = false;
    config.runE2E = false;
  }
  if (args.includes('--e2e-only')) {
    config.runThroughput = false;
    config.runLatency = false;
  }

  // Parse custom configurations
  const throughputIndex = args.indexOf('--throughput-config');
  if (throughputIndex !== -1 && args[throughputIndex + 1]) {
    try {
      config.throughputConfig = JSON.parse(args[throughputIndex + 1]);
    } catch (error) {
      console.warn(chalk.yellow('Warning: Invalid throughput config JSON'));
    }
  }

  const latencyIndex = args.indexOf('--latency-config');
  if (latencyIndex !== -1 && args[latencyIndex + 1]) {
    try {
      config.latencyConfig = JSON.parse(args[latencyIndex + 1]);
    } catch (error) {
      console.warn(chalk.yellow('Warning: Invalid latency config JSON'));
    }
  }

  const e2eIndex = args.indexOf('--e2e-config');
  if (e2eIndex !== -1 && args[e2eIndex + 1]) {
    try {
      config.e2eConfig = JSON.parse(args[e2eIndex + 1]);
    } catch (error) {
      console.warn(chalk.yellow('Warning: Invalid E2E config JSON'));
    }
  }

  const suite = new BenchmarkSuite(config);
  await suite.run();
}

if (require.main === module) {
  main().catch(console.error);
}
