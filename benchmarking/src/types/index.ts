import { TransportCapabilities } from '@logistically/events/event-transport/transport.interface';

// Core benchmark result types
export interface BenchmarkResult {
  id: string;
  name: string;
  transport: string;
  timestamp: string;
  duration: number;
  sampleCount: number;
  metrics: BenchmarkMetrics;
  environment: EnvironmentInfo;
  configuration: BenchmarkConfiguration;
  statisticalSummary: StatisticalSummary;
}

export interface BenchmarkMetrics {
  // Latency metrics (nanoseconds)
  latency: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p50: number;
    p95: number;
    p99: number;
    p99_9: number;
    standardDeviation: number;
    samples: number[];
  };
  
  // Throughput metrics
  throughput: {
    messagesPerSecond: number;
    bytesPerSecond: number;
    totalMessages: number;
    totalBytes: number;
  };
  
  // Resource utilization
  resources: {
    cpuUsage: number;
    memoryUsage: number;
    maxMemoryUsage?: number;
    cpuUsages?: number[];
    memoryUsages?: number[];
    frameworkOverhead?: {
      cpuUsage: number;
      memoryUsage: number;
      cpuTimeMicroseconds: number;
    };
    trafficRecordMemory?: number;
    networkIO?: number;
    diskIO?: number;
  };
  
  // Reliability metrics
  reliability: {
    messageLoss: number;
    duplicateMessages: number;
    poisonMessages: number;
    retryCount: number;
    errorRate: number;
  };
}

export interface StatisticalSummary {
  confidenceInterval95: {
    lower: number;
    upper: number;
    marginOfError: number;
  };
  confidenceInterval99: {
    lower: number;
    upper: number;
    marginOfError: number;
  };
  standardError: number;
  coefficientOfVariation: number;
  isNormalDistribution: boolean;
  outlierCount: number;
}

export interface EnvironmentInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  cpus: number;
  memory: {
    total: number;
    free: number;
  };
  timestamp: string;
  gitCommit?: string;
  gitBranch?: string;
}

export interface BenchmarkConfiguration {
  transport: string;
  transportConfig: any;
  scenario: string;
  parameters: Record<string, any>;
  iterations: number;
  warmupRuns: number;
  cooldownMs: number;
}

// Benchmark scenario definitions
export interface BenchmarkScenario {
  name: string;
  description: string;
  category: 'latency' | 'throughput' | 'reliability' | 'scalability' | 'stress';
  requiredCapabilities: Partial<TransportCapabilities>;
  parameters: ScenarioParameter[];
  execute: (context: BenchmarkContext) => Promise<IterationResult>;
}

export interface ScenarioParameter {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  defaultValue: any;
  description: string;
  options?: any[];
  min?: number;
  max?: number;
}

export interface BenchmarkContext {
  transport: any;
  capabilities: TransportCapabilities;
  configuration: BenchmarkConfiguration;
  environment: EnvironmentInfo;
  logger: BenchmarkLogger;
  iteration: number;
  iterationId: string;
}

// New interface for iteration results
export interface IterationResult {
  iteration: number;
  iterationId: string;
  duration: number;
  publishedCount: number;
  receivedCount: number;
  messageLatencies: Array<{
    messageId: string;
    publishTime: number;
    receiveTime: number;
    latency: number;
  }>;
  errors: string[];
  metadata?: Record<string, any>;
  systemMetrics?: {
    start: any;
    end: any;
    cpuUsage: number;
    memoryUsage: number;
    frameworkOverhead?: {
      cpuUsage: number;
      memoryUsage: number;
      cpuTimeMicroseconds: number;
    };
    trafficRecordMemory?: number;
  };
}

// Transport benchmark interface
export interface TransportBenchmark {
  name: string;
  capabilities: TransportCapabilities;
  createTransport(config: any, iteration?: number): Promise<any>;
  cleanup(): Promise<void>;
  getDefaultConfig(): any;
  validateConfig(config: any): { valid: boolean; errors: string[] };
}

// Benchmark suite interface
export interface BenchmarkSuite {
  name: string;
  description: string;
  scenarios: BenchmarkScenario[];
  transports: string[];
  run(transport: string, config?: any): Promise<BenchmarkSuiteResult>;
}

export interface BenchmarkSuiteResult {
  suite: string;
  transport: string;
  timestamp: string;
  results: BenchmarkResult[];
  summary: SuiteSummary;
}

export interface SuiteSummary {
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  averageLatency: number;
  averageThroughput: number;
  overallScore: number;
}

// Logger interface
export interface BenchmarkLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  progress(message: string): void;
}

// Report generation
export interface ReportOptions {
  format: 'html' | 'json' | 'csv' | 'console';
  outputPath?: string;
  includeCharts?: boolean;
  includeRawData?: boolean;
}

export interface BenchmarkReport {
  generate(options: ReportOptions): Promise<string>;
  save(options: ReportOptions): Promise<string>;
}
