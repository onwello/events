#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
// Force-enable colors for chalk in environments where auto-detection fails
if (!process.env.FORCE_COLOR) {
  process.env.FORCE_COLOR = '1';
}
import ora from 'ora';
import { BenchmarkRunner } from './core/benchmark-runner';
import { RedisBenchmark } from './transports/redis-benchmark';
import { MemoryBenchmark } from './transports/memory-benchmark';
import { E2ELatencyScenario } from './scenarios/e2e-latency-scenario';
import { ThroughputScenario } from './scenarios/throughput-scenario';
import { PublishingThroughputScenario } from './scenarios/publishing-throughput-scenario';
import { ConsoleLogger } from './core/console-logger';
import { BenchmarkConfiguration } from './types';

const program = new Command();

program
  .name('events-benchmark')
  .description('Benchmark framework for @logistically/events')
  .version('1.0.0');

program
  .command('run')
  .description('Run benchmarks')
  .option('-t, --transport <transport>', 'Transport to benchmark (redis, memory)', 'redis')
  .option('-s, --scenario <scenario>', 'Scenario to run (e2e-latency, throughput, publishing-throughput)', 'e2e-latency')
  .option('-i, --iterations <number>', 'Number of iterations', '3')
  .option('-w, --warmup <number>', 'Number of warmup runs', '1')
  .option('-c, --message-count <number>', 'Number of messages', '100')
  .option('-z, --message-size <number>', 'Message size in bytes', '1024')
  .option('-b, --batch-size <number>', 'Batch size for throughput tests', '10')
  .option('-f, --flush-interval <number>', 'Flush interval in milliseconds', '0')
  .option('-p, --publishers <number>', 'Number of concurrent publishers', '1')
  .option('-m, --multiple-transports', 'Use separate transport instances for each publisher', false)
  .option('-c, --consumers <number>', 'Number of concurrent consumers', '1')
  .action(async (options) => {
    const spinner = ora('Initializing benchmark...').start();
    
    try {
      // Select transport
      let transport;
      switch (options.transport) {
        case 'redis':
          transport = new RedisBenchmark();
          break;
        case 'memory':
          transport = new MemoryBenchmark();
          break;
        default:
          throw new Error(`Unsupported transport: ${options.transport}`);
      }
      
      // Select scenario
      let scenario;
      switch (options.scenario) {
        case 'e2e-latency':
          scenario = new E2ELatencyScenario();
          break;
        case 'throughput':
          scenario = new ThroughputScenario();
          break;
        case 'publishing-throughput':
          scenario = new PublishingThroughputScenario();
          break;
        default:
          throw new Error(`Unsupported scenario: ${options.scenario}`);
      }
      
      // Build transport config and override batching-related settings from CLI options
      const transportConfig = {
        ...transport.getDefaultConfig(),
        // Ensure batching-related options are applied at the transport layer
        batchSize: parseInt(options.batchSize),
        flushInterval: parseInt(options.flushInterval),
        concurrentPublishers: parseInt(options.publishers)
      };

      // Build configuration
      const config: BenchmarkConfiguration = {
        transport: options.transport,
        transportConfig,
        scenario: options.scenario,
        parameters: {
          messageCount: parseInt(options.messageCount),
          messageSize: parseInt(options.messageSize),
          batchSize: parseInt(options.batchSize),
          flushInterval: parseInt(options.flushInterval),
          concurrentPublishers: parseInt(options.publishers),
          concurrentConsumers: parseInt(options.consumers),
          useMultipleTransports: options.multipleTransports
        },
        iterations: parseInt(options.iterations),
        warmupRuns: parseInt(options.warmup),
        cooldownMs: 100
      };
      
      spinner.text = 'Running benchmark...';
      
      const logger = new ConsoleLogger();
      const runner = new BenchmarkRunner(logger);
      
      const result = await runner.runScenario(scenario, transport, config);
      
      spinner.succeed('Benchmark completed!');
      
      // Display results
      console.log('\n' + chalk.bold.blue('📊 Benchmark Results'));
      console.log('='.repeat(50));
      console.log(chalk.cyan(`Transport: ${chalk.white(result.transport)}`));
      console.log(chalk.cyan(`Scenario: ${chalk.white(result.name)}`));
      console.log(chalk.cyan(`Duration: ${chalk.white((result.duration / 1e6).toFixed(2))}ms`));
      console.log(chalk.cyan(`Samples: ${chalk.white(result.sampleCount)}`));
      
      console.log('\n' + chalk.bold.green('📈 Latency Metrics'));
      console.log('-'.repeat(30));
      console.log(`Average: ${chalk.white((result.metrics.latency.mean / 1e6).toFixed(2))}ms`);
      console.log(`Min: ${chalk.white((result.metrics.latency.min / 1e6).toFixed(2))}ms`);
      console.log(`Max: ${chalk.white((result.metrics.latency.max / 1e6).toFixed(2))}ms`);
      console.log(`95th %: ${chalk.white((result.metrics.latency.p95 / 1e6).toFixed(2))}ms`);
      console.log(`99th %: ${chalk.white((result.metrics.latency.p99 / 1e6).toFixed(2))}ms`);
      
      console.log('\n' + chalk.bold.yellow('⚡ Throughput Metrics'));
      console.log('-'.repeat(30));
      console.log(`Messages/sec: ${chalk.white(result.metrics.throughput.messagesPerSecond.toFixed(2))}`);
      console.log(`Bytes/sec: ${chalk.white((result.metrics.throughput.bytesPerSecond / 1024).toFixed(2))} KB/s`);
      console.log(`Total Messages: ${chalk.white(result.metrics.throughput.totalMessages)}`);
      
      console.log('\n' + chalk.bold.red('🛡️ Reliability Metrics'));
      console.log('-'.repeat(30));
      console.log(`Success Rate: ${chalk.white(((1 - result.metrics.reliability.errorRate) * 100).toFixed(2))}%`);
      console.log(`Message Loss: ${chalk.white((result.metrics.reliability.messageLoss * 100).toFixed(2))}%`);
      console.log(`Error Rate: ${chalk.white((result.metrics.reliability.errorRate * 100).toFixed(2))}%`);
      
      console.log('\n' + chalk.bold.cyan('💻 Resource Usage'));
      console.log('-'.repeat(30));
      console.log(`Average CPU Usage: ${chalk.white(result.metrics.resources.cpuUsage.toFixed(2))}% (actual)`);
      console.log(`Average Memory Usage: ${chalk.white(result.metrics.resources.memoryUsage.toFixed(2))} MB (actual)`);
      if (result.metrics.resources.maxMemoryUsage) {
        console.log(`Peak Memory Usage: ${chalk.white(result.metrics.resources.maxMemoryUsage.toFixed(2))} MB`);
      }
      
      // Display framework overhead if available
                  if (result.metrics.resources.frameworkOverhead) {
              const overhead = result.metrics.resources.frameworkOverhead;
              console.log(`Framework Overhead: ${chalk.gray(`${overhead.cpuUsage.toFixed(2)}% CPU, ${overhead.memoryUsage.toFixed(2)} MB, ${overhead.cpuTimeMicroseconds?.toFixed(0) || 'N/A'}μs CPU time`)}`);
            }
            if (result.metrics.resources.trafficRecordMemory !== undefined) {
              console.log(`Traffic Record Memory: ${chalk.gray(`${result.metrics.resources.trafficRecordMemory.toFixed(2)} MB`)}`);
            }
      
      if (result.statisticalSummary) {
        console.log('\n' + chalk.bold.magenta('📊 Statistical Analysis'));
        console.log('-'.repeat(30));
        console.log(`Confidence Interval (95%): ${chalk.white((result.statisticalSummary.confidenceInterval95.lower / 1e6).toFixed(2))}ms - ${chalk.white((result.statisticalSummary.confidenceInterval95.upper / 1e6).toFixed(2))}ms`);
        console.log(`Standard Error: ${chalk.white((result.statisticalSummary.standardError / 1e6).toFixed(2))}ms`);
        console.log(`Coefficient of Variation: ${chalk.white((result.statisticalSummary.coefficientOfVariation * 100).toFixed(2))}%`);
      }
      
    } catch (error) {
      spinner.fail('Benchmark failed!');
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
