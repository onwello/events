# Publishing Throughput Benchmark Results

## Methodology

### Overview
This document presents the results of comprehensive publishing throughput benchmarks for the `@logistically/events` library using Redis Streams transport. The benchmarks focus on measuring raw publishing performance, batching efficiency, and the impact of various configuration parameters.

### Benchmark Framework
- **Framework**: Custom TypeScript benchmarking framework
- **Transport**: Redis Streams with enhanced configuration
- **Scenario**: `publishing-throughput` - measures pure publishing performance without consumers
- **Metrics**: Throughput (msg/s), memory usage, CPU usage, execution time

### Test Configuration
- **Message Counts**: 1,000 - 100,000 messages per test
- **Message Sizes**: 128 bytes, 4KB
- **Batch Sizes**: 1 (non-batch), 1,000, 3,000, 4,000, 5,000
- **Concurrent Publishers**: 1, 5
- **Flush Intervals**: 0ms, 20ms
- **Iterations**: 3 benchmark iterations + 1 warmup iteration
- **Warmup**: 1 iteration to stabilize JIT compilation and connections

### Test Environment
- **Redis**: Local Redis instance (localhost:6379)
- **Node.js**: Latest LTS version
- **Hardware**: macOS with Intel/Apple Silicon processor
- **Network**: Localhost (minimal network latency)

### Key Optimizations Tested
1. **Efficient Batching**: Bundling multiple messages into single EventEnvelope
2. **Pipelining**: Multiple batch envelopes in single network round-trip
3. **Connection Pooling**: Reusing Redis connections for concurrent operations
4. **Concurrent Publishing**: Multiple parallel publishing streams

### Measurement Methodology
- **Throughput**: Messages published per second (calculated from total messages / total duration)
- **Memory Usage**: Peak memory consumption during benchmark execution
- **CPU Usage**: Average CPU utilization across all iterations
- **Framework Overhead**: Measured separately and subtracted from results
- **Traffic Record Memory**: Memory used for logging (subtracted for accurate library memory usage)

### Statistical Approach
- **Sample Size**: 3 iterations per configuration
- **Warmup**: 1 iteration excluded from results
- **Outliers**: All iterations included (no outlier removal)
- **Reporting**: Average values across iterations

## Setup and Configuration

### Prerequisites
- Node.js 18+ installed
- Redis server running on localhost:6379
- `@logistically/events` library installed

### Benchmark Framework Setup
```bash
cd benchmarking
npm install
```

### Redis Configuration
The benchmarks use the following Redis Streams configuration:
- **Stream Prefix**: `stream:`
- **Max Length**: 10,000 messages per stream
- **Trim Strategy**: MAXLEN
- **Consumer Groups**: Enabled for message ordering
- **Connection Pool**: Enabled with configurable size

### Transport Configuration
```typescript
{
  enableBatching: true,
  enablePublisherBatching: {
    enabled: true,
    maxSize: [batchSize],
    maxWaitMs: [flushInterval]
  },
  enablePipelining: true,
  pipelineSize: 1000,
  connectionPool: {
    enabled: true,
    size: 10,
    maxConcurrentPublishers: [concurrentPublishers]
  }
}
```

### Benchmark Command Structure
```bash
npm run benchmark -- run \
  --transport redis \
  --scenario publishing-throughput \
  --message-count [count] \
  --batch-size [size] \
  --flush-interval [ms] \
  --publishers [count] \
  --iterations 3 \
  --warmup 1 \
  --message-size [bytes]

## Batch Size Optimization Results

### Test Parameters
- **Message Count**: 100,000 messages
- **Message Size**: 128 bytes
- **Iterations**: 3 + 1 warmup
- **Concurrent Publishers**: 1
- **Flush Interval**: 20ms

### Results Summary

| Batch Size | Throughput (msg/s) | Memory Usage (MB) | CPU Usage (%) | Duration (s) |
|------------|-------------------|-------------------|---------------|--------------|
| 3,000      | 68,847            | 1,187             | 99.18         | 1.43         |
| 4,000      | 73,076            | 956               | 99.16         | 1.37         |
| 5,000      | 70,710            | 1,234             | 99.10         | 1.41         |

### Key Findings

**Optimal Batch Size**: 4,000 messages per batch envelope

**Performance Characteristics**:
- 4,000 batch size achieves highest throughput (73,076 msg/s)
- 4,000 batch size uses lowest memory (956 MB)
- 5,000 batch size shows diminishing returns with higher memory usage
- 3,000 batch size provides good performance but lower throughput

**Memory Efficiency**:
- 4,000 batch size: 956 MB (most efficient)
- 3,000 batch size: 1,187 MB (+24% memory usage)
- 5,000 batch size: 1,234 MB (+29% memory usage)

**Throughput Performance**:
- 4,000 batch size: 73,076 msg/s (baseline)
- 3,000 batch size: 68,847 msg/s (-5.8% throughput)
- 5,000 batch size: 70,710 msg/s (-3.2% throughput)

## Batching vs Non-Batching Performance Comparison

### Test Parameters
- **Message Count**: 100,000 messages
- **Message Size**: 128 bytes
- **Iterations**: 3 + 1 warmup
- **Concurrent Publishers**: 1, 5
- **Batch Size**: 1 (non-batch), 4,000 (batching)
- **Flush Interval**: 0ms (non-batch), 20ms (batching)

### Results Summary

| Configuration | Throughput (msg/s) | Memory Usage (MB) | CPU Usage (%) | Duration (s) | Improvement |
|---------------|-------------------|-------------------|---------------|--------------|-------------|
| 1 Publisher, Non-Batch | 2,197 | 357 | 24 | 47 | Baseline |
| 5 Publishers, Non-Batch | 7,222 | 672 | 66 | 14 | +229% |
| 1 Publisher, 4k Batch | 73,076 | 956 | 99 | 1.4 | +3,225% |
| 5 Publishers, 4k Batch | 70,161 | 718 | 99 | 1.4 | +3,093% |

### Performance Analysis

**Non-Batch Publishing**:
- Single publisher: 2,197 msg/s
- 5 concurrent publishers: 7,222 msg/s (+229% improvement)
- Concurrency provides 3.3x performance increase for non-batch publishing

**Batched Publishing**:
- Single publisher: 73,076 msg/s
- 5 concurrent publishers: 70,161 msg/s (-4% performance)
- Concurrency does not improve batched publishing performance

**Batching vs Concurrency**:
- Batching provides 33x performance improvement over non-batch
- Concurrency provides 3.3x improvement for non-batch only
- Batching is significantly more effective than concurrency

### Resource Usage Comparison

**Memory Efficiency**:
- Non-batch: 357-672 MB (lower memory usage)
- Batched: 718-956 MB (higher memory usage)
- Memory increase is proportional to performance improvement

**CPU Utilization**:
- Non-batch: 24-66% (lower CPU usage)
- Batched: 99% (higher CPU usage)
- CPU usage correlates with throughput performance

## Message Size Impact Analysis

### Test Parameters
- **Message Count**: 10,000 messages
- **Message Sizes**: 128 bytes, 4KB (4,096 bytes)
- **Iterations**: 3 + 1 warmup
- **Concurrent Publishers**: 1
- **Batch Size**: 1 (non-batch), 4,000 (batching)
- **Flush Interval**: 0ms (non-batch), 20ms (batching)

### Results Summary

| Message Size | Configuration | Throughput (msg/s) | Bytes/sec (KB/s) | Memory Usage (MB) | CPU Usage (%) |
|--------------|---------------|-------------------|------------------|-------------------|---------------|
| 128B | Non-Batch | 2,197 | 274 | 357 | 24 |
| 128B | 4k Batch | 73,076 | 9,135 | 956 | 99 |
| 4KB | Non-Batch | 1,435 | 5,739 | 1,673 | 72 |
| 4KB | 4k Batch | 4,734 | 18,935 | 1,589 | 99 |

### Performance Analysis

**Throughput Impact**:
- 128B messages: 73,076 msg/s (batched), 2,197 msg/s (non-batch)
- 4KB messages: 4,734 msg/s (batched), 1,435 msg/s (non-batch)
- Large messages reduce absolute throughput by 93% (128B vs 4KB)

**Data Throughput**:
- 128B messages: 9,135 KB/s (batched), 274 KB/s (non-batch)
- 4KB messages: 18,935 KB/s (batched), 5,739 KB/s (non-batch)
- Large messages increase data throughput by 107% (4KB vs 128B)

**Batching Effectiveness**:
- 128B messages: 33x improvement with batching
- 4KB messages: 3.3x improvement with batching
- Batching benefit decreases with larger message sizes

### Resource Usage Impact

**Memory Usage**:
- 128B messages: 357-956 MB
- 4KB messages: 1,435-1,673 MB
- Large messages require 3-4x more memory

**CPU Utilization**:
- 128B messages: 24-99% (depending on batching)
- 4KB messages: 72-99% (depending on batching)
- Large messages increase CPU usage for non-batch publishing

## Conclusions and Recommendations

### Key Findings

**Optimal Configuration**:
- **Batch Size**: 4,000 messages per batch envelope
- **Concurrent Publishers**: 1 (single publisher optimal)
- **Flush Interval**: 20ms
- **Message Size**: Performance scales inversely with message size

**Performance Characteristics**:
- **Maximum Throughput**: 73,076 msg/s (128B messages, 4k batch, single publisher)
- **Batching Impact**: 33x improvement over non-batch publishing
- **Concurrency Impact**: 3.3x improvement for non-batch only
- **Memory Efficiency**: 956 MB for optimal configuration

### Technical Insights

**Batching Effectiveness**:
- Efficient batching (bundling messages in single EventEnvelope) provides dramatic performance improvements
- Pipelining multiple batch envelopes further optimizes network utilization
- Batching benefit decreases with larger message sizes (33x for 128B, 3.3x for 4KB)

**Concurrency Limitations**:
- Multiple concurrent publishers do not improve batched publishing performance
- Concurrency provides benefits only for non-batch publishing
- Single publisher with optimal batching achieves best performance

**Resource Utilization**:
- CPU usage correlates directly with throughput performance
- Memory usage increases proportionally with performance improvements
- Large messages require significantly more memory (3-4x increase)

### Configuration Recommendations

**For High-Throughput Scenarios**:
- Use 4,000 batch size with 20ms flush interval
- Single publisher configuration
- Optimize for small message sizes when possible

**For Large Message Scenarios**:
- Batching still provides 3.3x improvement over non-batch
- Expect reduced absolute throughput but higher data throughput
- Monitor memory usage for large message volumes

**For Resource-Constrained Environments**:
- Non-batch publishing uses less memory and CPU
- Consider trade-offs between performance and resource usage
- Multiple publishers can improve non-batch performance

### Benchmark Limitations

**Test Environment**:
- Localhost Redis instance (minimal network latency)
- Single machine testing (no distributed system testing)
- Limited to publishing performance (no consumer testing)

**Scope**:
- Focused on Redis Streams transport only
- No comparison with other message brokers
- No durability or persistence testing

**Future Considerations**:
- Distributed Redis cluster testing
- Network latency impact analysis
- Consumer scaling benchmarks
- Different message broker comparisons
```
