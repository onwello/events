# Events Benchmarking Framework

A comprehensive benchmarking framework for the `@logistically/events` library, designed to measure performance, reliability, and scalability of different transport implementations.

## 🎯 Design Philosophy

The framework is built with the following principles:

1. **Isolation**: Each benchmark iteration is completely isolated from others
2. **Accuracy**: Precise message-level latency measurements
3. **Flexibility**: Easy to add new scenarios and transports
4. **Reliability**: Proper error handling and cleanup
5. **Observability**: Detailed metrics and statistical analysis

## 🏗️ Architecture

### Core Components

- **BenchmarkRunner**: Orchestrates the entire benchmarking process
- **BenchmarkScenario**: Defines test scenarios (e.g., E2E latency, throughput)
- **TransportBenchmark**: Abstracts transport-specific setup and configuration
- **MetricsCollector**: Processes raw results into meaningful metrics
- **StatisticalAnalyzer**: Provides statistical analysis of results

### Key Features

- ✅ **Isolated Iterations**: No interference between benchmark runs
- ✅ **Accurate Message Correlation**: Proper messageId-based tracking
- ✅ **Minimal Artificial Latency**: Optimized for performance testing
- ✅ **Extensible Design**: Easy to add new scenarios and transports
- ✅ **Comprehensive Metrics**: Latency, throughput, reliability, and statistical analysis

## 🚀 Quick Start

### Basic Usage

```bash
# Run E2E latency benchmark on Redis
npm run benchmark -- --transport redis --scenario e2e-latency

# Run throughput benchmark on memory transport
npm run benchmark -- --transport memory --scenario throughput

# Custom configuration
npm run benchmark -- \
  --transport redis \
  --scenario e2e-latency \
  --iterations 3 \
  --warmup 1 \
  --message-count 10000 \
  --message-size 1024 \
  --consumers 2 \
  --flush-interval 50
```

### Available Commands

```bash
# Full benchmark with CLI
npm run benchmark

# Build the framework
npm run build

# Run tests
npm run test
```

## 🔧 CLI Options

### Basic Options
- `--transport <transport>`: Transport to benchmark (redis, memory) - default: redis
- `--scenario <scenario>`: Scenario to run (e2e-latency, throughput) - default: e2e-latency
- `--iterations <number>`: Number of iterations - default: 3
- `--warmup <number>`: Number of warmup runs - default: 1
- `--message-count <number>`: Number of messages - default: 100
- `--message-size <number>`: Message size in bytes - default: 1024

### Performance Options
- `--batch-size <number>`: Batch size for throughput tests - default: 10
- `--flush-interval <number>`: Flush interval in milliseconds - default: 0
- `--publishers <number>`: Number of concurrent publishers - default: 1
- `--consumers <number>`: Number of concurrent consumers - default: 1
- `--multiple-transports`: Use separate transport instances for each publisher

### Example Usage
```bash
# High-throughput benchmark with optimized settings
npm run benchmark -- \
  --transport redis \
  --scenario e2e-latency \
  --message-count 20000 \
  --consumers 2 \
  --iterations 3

# Memory transport test
npm run benchmark -- \
  --transport memory \
  --scenario e2e-latency \
  --message-count 1000 \
  --iterations 1
```

## 📊 Available Scenarios

### E2E Latency Scenario
Measures end-to-end latency from publish to consume.

**Parameters:**
- `messageCount`: Number of messages (default: 10)
- `messageSize`: Message payload size in bytes (default: 1024)
- `concurrentConsumers`: Number of concurrent consumers (default: 1)
- `enablePartitioning`: Enable topic partitioning (default: false)
- `partitionCount`: Number of partitions (default: 1)

### Throughput Scenario
Measures maximum message throughput (messages per second).

**Parameters:**
- `messageCount`: Number of messages (default: 1000)
- `messageSize`: Message payload size in bytes (default: 1024)
- `batchSize`: Messages per batch (default: 10)
- `concurrentPublishers`: Number of concurrent publishers (default: 1)

## ⚡ Performance Insights

### Consumer Configuration Optimization
The benchmark framework includes optimized consumer settings for high-throughput scenarios:

**Default Settings (Suboptimal):**
- `batchSize`: 10 (very low for high throughput)
- `blockTime`: 1ms (causing frequent polling)
- `pollInterval`: 1ms (excessive overhead)

**Optimized Settings (Recommended):**
- `batchSize`: 100 (10x increase for better throughput)
- `blockTime`: 50ms (50x increase to reduce polling frequency)
- `pollInterval`: 10ms (10x increase to reduce overhead)

### Performance Impact
- **Low-volume scenarios (1k messages):** Slight throughput reduction, improved latency
- **High-volume scenarios (5k-100k messages):** 42-52% throughput improvement
- **Memory usage:** Efficient scaling from 16 MB (1k) to 306 MB (100k)

### Iteration Count Impact
- **Single iteration:** Lower performance due to cold start effects
- **Multiple iterations (3+):** Better performance due to system warmup
- **Recommendation:** Use 3 iterations for accurate measurements

## 🔌 Available Transports

### Redis Transport
Full-featured Redis Streams transport with enterprise features.

**Features:**
- Consumer groups
- Message ordering
- Partitioning
- Dead letter queues
- Schema validation

### Memory Transport
In-memory transport for testing and development.

**Features:**
- Zero network overhead
- Instant message delivery
- Configurable processing delays
- Queue size limits

## 📈 Benchmark Results

### Recent Performance Measurements
The framework has been used to benchmark the `@logistically/events` library with Redis Streams transport:

**Performance Matrix:**
| Message Count | Throughput | Latency | Memory | Reliability |
|---------------|------------|---------|--------|-------------|
| 1,000         | 3,437 msg/s| 0.35ms  | 16 MB  | 100.00%     |
| 5,000         | 5,026 msg/s| 0.32ms  | 21 MB  | 100.00%     |
| 10,000        | 5,273 msg/s| 0.32ms  | 64 MB  | 100.00%     |
| 20,000        | 5,628 msg/s| 0.31ms  | 121 MB | 100.00%     |
| 100,000       | 5,708 msg/s| 0.31ms  | 306 MB | 100.00%     |

**Key Findings:**
- Sub-millisecond latency across all message volumes
- Consistent throughput scaling up to 100k messages
- Zero message loss with proper consumer configuration
- Efficient memory usage with predictable scaling

For detailed results and analysis, see [BENCHMARK_RESULTS.md](./BENCHMARK_RESULTS.md).

## 🔧 Extending the Framework

### Adding a New Scenario

Creating a new scenario is straightforward. Here's an example:

```typescript
import { BenchmarkScenario, BenchmarkContext, ScenarioParameter, IterationResult } from '../types';

export class ReliabilityScenario implements BenchmarkScenario {
  name = 'reliability';
  description = 'Tests message reliability under failure conditions';
  category = 'reliability' as const;
  
  requiredCapabilities = {
    supportsPublishing: true,
    supportsSubscription: true
  };

  parameters: ScenarioParameter[] = [
    {
      name: 'failureRate',
      type: 'number',
      defaultValue: 0.1,
      description: 'Simulated failure rate (0-1)',
      min: 0,
      max: 1
    }
  ];

  async execute(context: BenchmarkContext): Promise<IterationResult> {
    // Your scenario implementation here
    // Return IterationResult with latency data
  }
}
```

### Adding a New Transport

Adding a new transport is equally simple:

```typescript
import { TransportBenchmark, TransportCapabilities } from '../types';

export class KafkaBenchmark implements TransportBenchmark {
  name = 'kafka';
  capabilities: TransportCapabilities = {
    supportsPublishing: true,
    supportsSubscription: true,
    // ... other capabilities
  };

  async createTransport(config: any): Promise<any> {
    // Create and configure your transport
  }

  getDefaultConfig(): any {
    return {
      // Default configuration
    };
  }

  validateConfig(config: any): { valid: boolean; errors: string[] } {
    // Validate configuration
  }
}
```

### Registering New Components

To use new scenarios or transports, simply import and register them in the CLI:

```typescript
// In cli.ts
import { ReliabilityScenario } from './scenarios/reliability-scenario';
import { KafkaBenchmark } from './transports/kafka-benchmark';

// Add to transport selection
switch (options.transport) {
  case 'kafka':
    transport = new KafkaBenchmark();
    break;
  // ...
}

// Add to scenario selection
switch (options.scenario) {
  case 'reliability':
    scenario = new ReliabilityScenario();
    break;
  // ...
}
```

## 📈 Understanding Results

### Latency Metrics
- **Average**: Mean latency across all messages
- **Min/Max**: Minimum and maximum observed latencies
- **95th/99th Percentile**: Latency thresholds for 95% and 99% of messages
- **Standard Deviation**: Measure of latency variability

### Throughput Metrics
- **Messages/sec**: Messages processed per second
- **Bytes/sec**: Data throughput in bytes per second
- **Total Messages**: Total number of messages processed

### Reliability Metrics
- **Success Rate**: Percentage of successful message deliveries
- **Message Loss**: Percentage of messages not received
- **Error Rate**: Percentage of messages that encountered errors

### Statistical Analysis
- **Confidence Intervals**: Statistical confidence in the results
- **Standard Error**: Measure of result precision
- **Coefficient of Variation**: Relative variability of results

## 🛠️ Configuration

### Environment Variables

```bash
# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Benchmark Configuration
BENCHMARK_ITERATIONS=10
BENCHMARK_WARMUP=2
BENCHMARK_COOLDOWN=100
```

### Custom Configuration Files

You can create custom configuration files for specific test scenarios:

```json
{
  "transport": "redis",
  "scenario": "e2e-latency",
  "parameters": {
    "messageCount": 1000,
    "messageSize": 2048,
    "concurrentConsumers": 4
  },
  "iterations": 20,
  "warmupRuns": 5,
  "cooldownMs": 200
}
```

## 🎯 Best Practices

### For Accurate Results
1. **Run multiple iterations**: Use at least 3-5 iterations for reliable results
2. **Include warmup runs**: Allow the system to stabilize before measurement
3. **Use appropriate message counts**: Balance between accuracy and test duration
4. **Monitor system resources**: Ensure the system isn't resource-constrained

### For Performance Testing
1. **Disable unnecessary features**: Turn off logging, metrics, validation for pure performance
2. **Use minimal message sizes**: Test with realistic payload sizes
3. **Test different configurations**: Vary batch sizes, concurrency, etc.
4. **Compare across environments**: Test on similar hardware for fair comparison

### For Reliability Testing
1. **Enable error handling**: Test with retries, DLQs, etc.
2. **Simulate failures**: Test network partitions, service restarts
3. **Monitor error rates**: Track message loss and error patterns
4. **Test recovery**: Verify system behavior after failures

## 🔍 Troubleshooting

### Common Issues

**High Latency:**
- Check network connectivity
- Verify Redis performance
- Disable unnecessary EventSystem features
- Monitor system resources

**Message Loss:**
- Check consumer group configuration
- Verify topic mapping
- Monitor error logs
- Test with smaller message counts

**Inconsistent Results:**
- Increase iteration count
- Add warmup runs
- Check for external interference
- Verify isolation between runs

## 📝 Contributing

To contribute new scenarios or transports:

1. Create your scenario/transport class
2. Implement the required interfaces
3. Add to the CLI registration
4. Update documentation
5. Add tests if applicable

The framework is designed to be easily extensible while maintaining accuracy and reliability.
