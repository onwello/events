// Core benchmarking framework
export { BenchmarkRunner } from './core/benchmark-runner';
export { MetricsCollector } from './core/metrics-collector';
export { StatisticalAnalyzer } from './core/statistical-analyzer';
export { EnvironmentDetector } from './core/environment-detector';
export { ConsoleLogger } from './core/console-logger';

// Transport benchmarks
export { RedisBenchmark } from './transports/redis-benchmark';

// Benchmark scenarios
export { E2ELatencyScenario } from './scenarios/e2e-latency-scenario';

// Types and interfaces
export * from './types';

// CLI entry point - CLI is run directly via ts-node
