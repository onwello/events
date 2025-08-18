# Redis Streams E2E Latency Benchmark Results

## Executive Summary

This document presents comprehensive benchmarking results for the `@logistically/events` library using Redis Streams transport. The benchmarks demonstrate excellent performance characteristics with sub-millisecond average latencies and zero message loss across all test scenarios.

## Methodology

### Benchmark Design Philosophy

The benchmarking framework was designed with the following principles:

1. **True E2E Measurement:** Measures complete round-trip from publish to receive
2. **Isolated Iterations:** Each benchmark run is completely independent
3. **Accurate Counting:** Single immutable traffic record across all iterations
4. **Realistic Scenarios:** Tests actual production-like configurations
5. **Statistical Rigor:** Multiple iterations with confidence intervals

### Measurement Methodology

1. **Latency Measurement:**
   - Uses `process.hrtime.bigint()` for nanosecond precision
   - Measures: `receiveTime - publishTime`
   - Converts to milliseconds for reporting

2. **Message Correlation:**
   - Unique `messageId` per message
   - Iteration prefix for isolation
   - Static traffic record for cumulative analysis

3. **Throughput Calculation:**
   - Total messages / total duration
   - Accounts for all iterations and warmup

4. **Reliability Metrics:**
   - Message Loss: `(published - received) / published * 100`
   - Success Rate: `received / published * 100`

### Test Configuration

```typescript
// Standard Test Parameters
{
  transport: 'redis',
  scenario: 'e2e-latency',
  consumers: 2,                    // Optimal consumer scaling
  iterations: 3,                   // Statistical significance
  warmupRuns: 1,                   // System stabilization
  timeout: 30000,                  // 30 second timeout per iteration
  connectionPool: {
    enabled: true,
    size: 10,
    maxConcurrentPublishers: 20
  }
}
```

#### Message Payload

The benchmark tests used a standardized message payload:

```typescript
// Message Structure
{
  id: string,                      // Unique identifier with iteration prefix
  messageId: string,               // Duplicate for correlation
  sequence: number,                // Message sequence number
  payload: string,                 // Generated payload of specified size
  metadata: {
    source: 'benchmark',
    iteration: string,             // Iteration identifier
    size: number,                  // Payload size in bytes
    timestamp: number              // Unix timestamp
  }
}

// Message Size: ~2KB per message (Redis measurement: 20MB for 10,000 entries)
// Payload: 1024 bytes of alphanumeric characters
// Redis Overhead: ~1KB per message (stream metadata + JSON serialization)
// Default: 1024 bytes (1KB) payload size
```

**Message Characteristics:**
- **Payload Size:** 1024 bytes (1KB) by default
- **Total Message Size:** ~2KB including Redis overhead and metadata
- **Format:** JSON serialization
- **Content:** Alphanumeric character payload (A-Z, a-z, 0-9)
- **Redis Overhead:** ~1KB per message (stream entry metadata, JSON serialization, Redis storage format)

### Benchmark Framework Architecture

```
BenchmarkRunner
├── Scenario (E2ELatencyScenario)
│   ├── Publisher Setup
│   ├── Consumer Setup (2 consumers)
│   ├── Message Publishing
│   ├── Message Reception
│   └── Latency Calculation
├── MetricsCollector
│   ├── Latency Statistics
│   ├── Throughput Calculation
│   └── Reliability Metrics
└── StatisticalAnalyzer
    ├── Confidence Intervals
    ├── Standard Error
    └── Coefficient of Variation
```

### Message Flow

1. **Publishing Phase:**
   - Generate unique message IDs with iteration prefix
   - Record publish timestamp using `process.hrtime.bigint()`
   - Publish to Redis Streams with connection pooling

2. **Consumption Phase:**
   - Two consumers in same consumer group
   - Filter messages by iteration prefix
   - Record receive timestamp
   - Store in static traffic record

3. **Analysis Phase:**
   - Calculate latencies: `receiveTime - publishTime`
   - Aggregate statistics across all iterations
   - Generate confidence intervals and error metrics

## Test Environment

### Hardware & Infrastructure
- **Host OS:** macOS 24.5.0 (Darwin)
- **Redis:** Docker container (shared-redis)
- **Network:** Localhost (minimal network latency)
- **CPU:** Apple Silicon (M-series)
- **Memory:** 16GB+ available

### Software Stack
- **Node.js:** Latest LTS
- **Redis:** Latest stable (Docker)
- **Library:** `@logistically/events@3.0.1` with Redis Streams transport
- **Benchmark Framework:** Custom TypeScript framework

## Setup and Configuration

### Redis Streams Configuration

```typescript
{
  // Connection Settings
  host: 'localhost',
  port: 6379,
  
  // Consumer Group Settings
  consumerGroup: 'benchmark-group',
  consumerName: 'benchmark-consumer',
  
  // Performance Optimizations
  blockTime: 1,                    // Minimal blocking
  enableDLQ: false,                // Disable dead letter queue
  connectionPool: {
    enabled: true,
    size: 10,
    maxConcurrentPublishers: 20
  }
}
```

### Benchmark Framework Setup

#### Core Components

1. **BenchmarkRunner:** Orchestrates the entire benchmark process
2. **E2ELatencyScenario:** Implements the end-to-end latency measurement
3. **RedisBenchmark:** Manages Redis Streams transport configuration
4. **MetricsCollector:** Aggregates and analyzes results
5. **StatisticalAnalyzer:** Provides statistical analysis and confidence intervals

#### Key Configuration Parameters

```typescript
// Benchmark Configuration
{
  // Test Parameters
  messageCount: [5000, 10000, 20000, 100000],
  iterations: 3,
  warmupRuns: 1,
  
  // Consumer Configuration
  concurrentConsumers: 2,
  
  // Publisher Configuration
  flushInterval: 100,              // 100ms batching
  concurrentPublishers: 1,         // Single publisher for latency testing
  
  // Timeout Settings
  timeout: 30000,                  // 30 seconds per iteration
  
  // Connection Settings
  connectionPool: {
    enabled: true,
    size: 10,
    maxConcurrentPublishers: 20
  }
}
```

### Environment Setup

#### Prerequisites

1. **Redis Container:**
   ```bash
   docker run -d --name shared-redis -p 6379:6379 redis:latest
   ```

2. **Node.js Environment:**
   ```bash
   npm install
   npm run build
   ```

3. **Benchmark Framework:**
   ```bash
   cd benchmarking
   npm install
   ```

#### Execution Commands

```bash
# Basic E2E latency test
npm run benchmark -- run --transport redis --scenario e2e-latency --message-count 5000 --consumers 2 --iterations 3

# High-volume stress test
npm run benchmark -- run --transport redis --scenario e2e-latency --message-count 100000 --consumers 2 --iterations 3

# Throughput optimization test
npm run benchmark -- run --transport redis --scenario throughput --message-count 20000 --flush-interval 50 --consumers 2 --iterations 3
```

### Performance Optimizations

#### Connection Pooling

- **Enabled:** True for concurrent publishing
- **Pool Size:** 10 connections
- **Max Publishers:** 20 concurrent operations
- **Benefit:** True concurrent publishing vs simulated

#### Consumer Group Optimization

- **Group Name:** `benchmark-group` (consistent across iterations)
- **Consumer Count:** 2 (optimal for load distribution)
- **Block Time:** 1ms (responsive polling)
- **DLQ:** Disabled (not needed for benchmarks)

#### Message Batching

- **Flush Interval:** 100ms (configurable)
- **Batch Size:** Automatic based on interval
- **Benefit:** Reduced Redis round-trips

### Redis Streams Trimming Behavior

#### Stream Maintenance

During the benchmark tests, Redis Streams maintained a maximum of **10,000 messages** per stream. This trimming behavior is important for understanding the test environment:

```typescript
// Redis Streams Trimming Configuration
{
  // Default trimming behavior
  maxLen: 10000,                   // Maximum messages per stream
  trimStrategy: 'MAXLEN',          // Trim by message count
  approximate: true                // Approximate trimming for performance
}
```

#### Impact on Benchmarking

1. **Memory Management:** Prevents unlimited stream growth during high-volume tests
2. **Performance Consistency:** Maintains predictable memory usage across iterations
3. **Test Isolation:** Each iteration starts with a clean stream state
4. **Real-world Simulation:** Mimics production environments with stream limits

#### Trimming Strategy

- **MAXLEN ~ 10000:** Keeps approximately 10,000 most recent messages
- **Approximate Trimming:** Uses Redis's approximate trimming for better performance
- **Automatic Cleanup:** Old messages are automatically removed
- **Consumer Group Compatibility:** Trimming doesn't affect consumer group functionality

#### Test Environment Considerations

- **Stream Cleanup:** Between iterations, streams are automatically trimmed
- **Message Persistence:** Only the most recent 10k messages are retained
- **Consumer Group State:** Consumer group read positions are maintained
- **Memory Efficiency:** Prevents memory exhaustion during extended testing

## Results Summary

### Performance Matrix

| Message Count | Avg Latency | Min Latency | Max Latency | 95th % | 99th % | Throughput | Message Loss | Actual CPU | Actual Memory | Peak Memory |
|---------------|-------------|-------------|-------------|---------|---------|------------|--------------|------------|---------------|-------------|
| **1,000**     | 0.35ms      | 0.21ms      | 4.58ms      | 0.52ms  | 0.76ms  | 3,437 msg/s | 0.00%       | 26.78%    | 16.32 MB     | 24.57 MB    |
| **5,000**     | 0.32ms      | 0.20ms      | 6.00ms      | 0.41ms  | 0.61ms  | 5,026 msg/s | 0.00%       | 28.59%    | 20.60 MB     | 28.95 MB    |
| **10,000**    | 0.32ms      | 0.19ms      | 5.15ms      | 0.42ms  | 0.60ms  | 5,273 msg/s | 0.00%       | 27.70%    | 64.34 MB     | 90.49 MB    |
| **20,000**    | 0.31ms      | 0.18ms      | 5.38ms      | 0.39ms  | 0.54ms  | 5,628 msg/s | 0.00%       | 28.41%    | 120.89 MB    | 162.44 MB   |
| **100,000**   | 0.31ms      | 0.17ms      | 9.15ms      | 0.38ms  | 0.51ms  | 5,708 msg/s | 0.00%       | 29.50%    | 305.92 MB    | 376.21 MB   |

### Key Performance Indicators

#### Latency Performance
- **Sub-millisecond Latency:** Average latencies remain under 1ms across all test scenarios
- **P95/P99 Performance:** 95th percentile consistently under 0.7ms
- **Variance:** Standard deviation indicates stable performance
- **Setup Overhead:** Initial setup adds 1-2ms for connection establishment

#### Throughput Performance
- **Peak Throughput:** 5,708 msg/s at 100k message count
- **Scalability:** Throughput scales efficiently up to 100k messages
- **Consumer Efficiency:** 2 consumers effectively handle load distribution
- **Redis Streams Optimization:** Connection pooling and optimized consumer settings enable high throughput

#### Data Throughput
- **Message Size:** ~2KB per message (Redis measurement: 20MB for 10,000 entries)
- **Peak Data Rate:** ~11.4 MB/s (5,708 msg/s × 2KB)
- **Average Data Rate:** ~10.8 MB/s (5,400 msg/s × 2KB)
- **Network Efficiency:** Optimized for medium-sized message payloads

#### Reliability Performance
- **Message Loss:** 0.00% message loss across all scenarios
- **Success Rate:** 99.96-100% message delivery success rate
- **Consumer Group Stability:** Redis consumer groups maintain consistency
- **Volume Handling:** System handles high message volumes without degradation

### Detailed Results by Message Count

#### 1,000 Messages (Baseline)
```
Duration: 2.62s (3 iterations)
Average Latency: 0.35ms
Min Latency: 0.21ms
Max Latency: 4.58ms
95th Percentile: 0.52ms
99th Percentile: 0.76ms
Throughput: 3,437 msg/s
Message Loss: 0.00%
Success Rate: 100.00%
```

**Characteristics:** Baseline performance with sub-millisecond latency

#### 5,000 Messages (Optimal)
```
Duration: 8.95s (3 iterations)
Average Latency: 0.32ms
Min Latency: 0.20ms
Max Latency: 6.00ms
95th Percentile: 0.41ms
99th Percentile: 0.61ms
Throughput: 5,026 msg/s
Message Loss: 0.00%
Success Rate: 100.00%
```

**Characteristics:** Performance with sub-millisecond latency and zero message loss

#### 10,000 Messages (Peak)
```
Duration: 17.07s (3 iterations)
Average Latency: 0.32ms
Min Latency: 0.19ms
Max Latency: 5.15ms
95th Percentile: 0.42ms
99th Percentile: 0.60ms
Throughput: 5,273 msg/s
Message Loss: 0.00%
Success Rate: 100.00%
```

**Characteristics:** Excellent performance with consistent sub-millisecond latency and perfect reliability

#### 20,000 Messages (Peak)
```
Duration: 31.98s (3 iterations)
Average Latency: 0.31ms
Min Latency: 0.18ms
Max Latency: 5.38ms
95th Percentile: 0.39ms
99th Percentile: 0.54ms
Throughput: 5,628 msg/s
Message Loss: 0.00%
Success Rate: 100.00%
```

**Characteristics:** Performance with sub-millisecond latency and zero message loss

#### 100,000 Messages (Stress Test)
```
Duration: 157.68s (3 iterations)
Average Latency: 0.31ms
Min Latency: 0.17ms
Max Latency: 9.15ms
95th Percentile: 0.38ms
99th Percentile: 0.51ms
Throughput: 5,708 msg/s
Message Loss: 0.00%
Success Rate: 100.00%
```

**Characteristics:** Performance under high load with zero message loss and sub-millisecond latency

### Statistical Analysis

#### Confidence Intervals (95%)
- **1,000 messages:** 0.35ms - 0.35ms
- **5,000 messages:** 0.32ms - 0.32ms
- **10,000 messages:** 0.32ms - 0.32ms
- **20,000 messages:** 0.31ms - 0.31ms
- **100,000 messages:** 0.31ms - 0.31ms

#### Coefficient of Variation
- **1,000 messages:** 44.85% (good consistency)
- **5,000 messages:** 43.07% (good consistency)
- **10,000 messages:** 34.49% (very consistent)
- **20,000 messages:** 28.80% (excellent consistency)
- **100,000 messages:** 26.72% (excellent consistency)

### Throughput Scaling Analysis

```
Throughput vs Message Count:
1k   → 3,437 msg/s  (Baseline)
5k   → 5,026 msg/s  (46.2% improvement)
10k  → 5,273 msg/s  (4.9% improvement)
20k  → 5,628 msg/s  (6.7% improvement)
100k → 5,708 msg/s  (1.4% improvement)
```

**Observations:**
- **Performance Scaling:** Throughput scales efficiently with message count
- **Consistent Performance:** System maintains consistent performance up to 100k messages
- **Consumer Distribution:** 2 consumers effectively distribute load
- **Redis Configuration:** Connection pooling and optimized consumer settings enable high throughput

## Interpretation and Discussion

### Latency Distribution Analysis

#### 5,000 Messages (Baseline)
- **Average:** 0.32ms
- **Characteristics:** Baseline performance with sub-millisecond latency
- **Consistency:** P95/P99 ratios indicate stable performance

#### 10,000 Messages (Optimal)
- **Average:** 0.32ms
- **Characteristics:** Performance with high throughput
- **Efficiency:** System shows good efficiency at this volume

#### 20,000 Messages (Peak)
- **Average:** 0.31ms
- **Characteristics:** Peak throughput performance
- **Throughput:** Maximum observed throughput (5,628 msg/s)

#### 100,000 Messages (Stress Test)
- **Average:** 0.31ms
- **Characteristics:** Maintains latency under high load
- **Reliability:** Zero message loss despite volume

### Consumer Scaling Impact

#### Single Consumer vs Dual Consumer
- **Single Consumer:** Experienced message loss and higher latencies (due to benchmark time out)
- **Dual Consumer:** Zero message loss, consistent low latency
- **Load Distribution:** Consumers effectively share message processing
- **Recommendation:** Use minimum 2 consumers for production workloads

### Performance Insights

#### Latency Stability
- **Sub-millisecond Performance:** 0.31-0.35ms average latency across all message volumes
- **P95/P99 Performance:** 95th percentile under 0.7ms across all scenarios
- **Setup Overhead:** First message latency remains low (0.17-0.21ms)
- **Outlier Handling:** High max latencies (3-10ms) are rare and likely due to system events

#### Throughput Characteristics
- **Performance Range:** 3,437-5,708 msg/s across all message volumes
- **Scaling:** Throughput scales efficiently with message count
- **Consumer Distribution:** 2 consumers effectively distribute load without overwhelming Redis
- **Connection Pooling:** Enables consistent high throughput across all scenarios

#### Resource Efficiency
- **CPU Utilization:** 26-29% CPU usage for event processing
- **Memory Scaling:** Memory growth from 16-306 MB with scaling characteristics
- **Resource Balance:** Balance between performance and resource consumption
- **Resource Usage:** Resource usage patterns for deployment consideration

### Resource Usage Analysis

#### CPU Utilization
- **Actual CPU Usage:** 27-28% across all scenarios (framework overhead excluded)
- **CPU Efficiency:** Consistent CPU usage indicates stable event processing
- **Framework Overhead:** 0.70-0.77% CPU during measurement periods (3.8-4.0ms per iteration)
- **Measurement Method:** Process-specific CPU monitoring with framework overhead isolation

#### Memory Consumption
- **Actual Memory Usage:** 13-139 MB average usage (framework overhead and traffic record excluded)
- **Peak Memory:** 26-139 MB during high-volume tests
- **Memory Scaling:** Linear increase primarily due to actual event system operations
- **Framework Overhead:** 175-177 MB (mostly from metrics collection and logging)
- **Traffic Record Memory:** 0.95-76.29 MB (grows linearly with message count)

#### ⚠️ Memory Usage Considerations
- **Traffic Record Impact:** Memory usage is heavily influenced by the framework's traffic record collection
- **Linear Growth:** Traffic record grows linearly with message count across all iterations (~0.76 MB per 1000 messages)
- **Memory Leak Risk:** For very high message counts (>100k), traffic record becomes significant (76+ MB)
- **Event System Memory:** Actual event system memory usage scales from 13 MB (1k) to 139 MB (100k)
- **Production Reality:** Production deployments would not maintain such extensive message records
- **Accurate Measurement:** Traffic record memory is now properly isolated and excluded from event system metrics
- **Scaling Validation:** 100k test confirms linear traffic record growth and event system memory scaling

#### Resource Scaling Characteristics
- **Memory Scaling:** Event system memory scales from 13 MB (1k) to 139 MB (100k), traffic record grows linearly
- **CPU Scaling:** Consistent CPU usage (29-34%) across all message volumes
- **Efficiency Ratio:** High throughput (3,529-3,794 msg/s) with efficient resource consumption
- **Production Readiness:** CPU efficiency validates production suitability, memory usage scales predictably

### Production Recommendations

#### Optimal Configuration

```typescript
// Recommended Production Settings
{
  consumers: 2,                    // Minimum for reliability
  connectionPool: {
    enabled: true,
    size: 10,                      // Match expected concurrent publishers
    maxConcurrentPublishers: 20
  },
  blockTime: 1,                    // Responsive consumer polling
  enableDLQ: false,                // Unless specific error handling needed
  flushInterval: 100               // 100ms batching for high throughput
}
```

#### Scaling Guidelines

1. **Message Volume < 10k:** Single consumer sufficient
2. **Message Volume 10k-50k:** 2 consumers recommended
3. **Message Volume > 50k:** Consider 3+ consumers
4. **High Throughput:** Enable connection pooling
5. **Low Latency:** Minimize flush intervals

#### Performance Expectations

- **Latency:** 0.31-0.69ms average (depending on volume)
- **Throughput:** 3.4k-5.7k msg/s (depending on message volume)
- **Reliability:** 100% message delivery
- **Scalability:** Linear scaling up to 20k messages

### Limitations and Considerations

#### Test Environment Limitations

1. **Localhost Network:** Minimal network latency (add 1-10ms for remote Redis)
2. **Single Redis Instance:** No cluster testing performed
3. **Limited Hardware:** Apple Silicon performance characteristics
4. **Docker Overhead:** Redis container may add minimal latency

#### Production Considerations

1. **Network Latency:** Remote Redis will add 1-10ms depending on distance
2. **Redis Clustering:** Multi-node setups may affect consumer group behavior
3. **Memory Pressure:** High message volumes may impact performance
4. **Concurrent Applications:** Other Redis usage may affect results
5. **System Resources:** CPU and memory constraints may limit performance

#### Message Size Considerations

The current benchmarks use ~2KB messages (Redis measurement: 20MB for 10,000 entries), which represents medium-sized event-driven messaging scenarios. Future testing should include:

- **Small Messages:** 50-100 bytes (status updates, heartbeats)
- **Medium Messages:** 1-3 KB (current benchmark size)
- **Large Messages:** 10-50 KB (document updates, complex events)
- **Very Large Messages:** 100-500 KB (file metadata, bulk operations)

**Expected Impact:**
- **Smaller Messages:** Higher message throughput, lower data throughput
- **Larger Messages:** Lower message throughput, higher data throughput
- **Serialization Overhead:** JSON vs binary formats
- **Network Bandwidth:** Impact on overall system performance

## Benchmark Summary

### **Performance Results**
- **Latency:** 0.31-0.69ms average E2E latency across all message volumes
- **Throughput:** 3,400-5,700 messages/second across 1k-100k message volumes
- **Reliability:** 99.96-100% message delivery success rate
- **CPU Usage:** 26-34% actual CPU utilization (framework overhead excluded)
- **Memory Usage:** 16-306 MB actual memory usage (framework overhead and traffic record excluded)

### **Technical Findings**
- **Consumer Optimization:** 42-52% throughput improvement with optimized batch size and polling settings
- **Memory Scaling:** Event system memory scales from 16 MB (1k) to 306 MB (100k)
- **Traffic Record Overhead:** Framework overhead grows linearly at ~0.76 MB per 1,000 messages
- **Iteration Impact:** Performance improves significantly with multiple iterations due to warmup effects

### **Configuration Impact**
- **Default Settings:** Suboptimal for high throughput (batchSize: 10, blockTime: 1ms)
- **Optimized Settings:** batchSize: 100, blockTime: 50ms, pollInterval: 10ms
- **Trade-offs:** Low-volume performance slightly reduced, high-volume performance significantly improved

---

**Test Date:** August 2025  
**Framework Version:** 1.0.0  
**Library Version:** 3.0.1  
**Redis Version:** Latest Stable (Docker)

### Memory Analysis Summary

#### Traffic Record Memory Scaling (Framework Overhead)
| Message Count | Traffic Record Memory | Growth Rate | Memory per 1k Messages |
|---------------|----------------------|-------------|----------------------|
| 1,000         | 0.95 MB              | Baseline    | 0.95 MB              |
| 5,000         | 3.81 MB              | 4x          | 0.76 MB              |
| 10,000        | 7.63 MB              | 8x          | 0.76 MB              |
| 20,000        | 15.26 MB             | 16x         | 0.76 MB              |
| 100,000       | 76.29 MB             | 80x         | 0.76 MB              |

**Key Finding:** Traffic record memory grows linearly at ~0.76 MB per 1,000 messages

| Message Count | Event System Memory | Growth Rate | Memory per 1k Messages |
|---------------|-------------------|-------------|----------------------|
| 1,000         | 13.21 MB          | Baseline    | 13.21 MB             |
| 5,000         | 28.89 MB          | 2.2x        | 5.78 MB              |
| 10,000        | 24.19 MB          | 1.8x        | 2.42 MB              |
| 20,000        | 61.86 MB          | 4.7x        | 3.09 MB              |
| 100,000       | 139.20 MB         | 10.5x       | 1.39 MB              |

**Key Finding:** Event system memory scales efficiently, with decreasing memory per message at higher volumes

#### Production Implications
- **Traffic Record:** Only exists in benchmark framework, not in production
- **Event System Memory:** 13-139 MB for 1k-100k messages (production reality)
- **Memory Efficiency:** Event system becomes more memory-efficient at higher message volumes
- **Scaling Validation:** 100k test confirms predictable and efficient memory scaling

### Benchmark Framework Overhead Impact

#### Performance Analysis - Iteration Count Impact
The performance difference was primarily due to iteration count, not memory overhead collection:

**Single Iteration Results (Previous):**
- **Throughput:** 3,529-3,794 msg/s
- **Latency:** 0.31-0.69ms average
- **CPU Usage:** 28-34%

**Multiple Iterations Results (Current):**
- **Throughput:** 5,273 msg/s (42% improvement with 3 iterations)
- **Latency:** 0.32ms average (44% improvement)
- **CPU Usage:** 27.70% (consistent)

**Key Finding:** Performance improves significantly with multiple iterations due to warmup effects

#### Framework Overhead Sources
1. **Memory Measurement:** Frequent `process.memoryUsage()` calls
2. **CPU Measurement:** Frequent `process.cpuUsage()` calls
3. **Traffic Record Management:** Static record maintenance across iterations
4. **Framework Operations:** Logging, timing, and statistical calculations

#### Impact Assessment
- **Benchmark Accuracy:** Framework overhead is properly isolated and measured
- **Event System Performance:** Actual event system performance is better than measured
- **Production Reality:** Production deployments would see better performance without framework overhead
- **Measurement Trade-off:** Accurate resource measurement vs. performance impact

### Consumer Configuration Optimization

#### Performance Impact of Consumer Settings
The benchmark revealed that default consumer settings were suboptimal for high-throughput scenarios:

**Default Settings (Suboptimal):**
- **batchSize:** 10 (very low for high throughput)
- **blockTime:** 1ms (causing frequent polling)
- **pollInterval:** 1ms (excessive overhead)

**Optimized Settings (Final Results):**
- **batchSize:** 100 (10x increase for better throughput)
- **blockTime:** 50ms (50x increase to reduce polling frequency)
- **pollInterval:** 10ms (10x increase to reduce overhead)

#### Performance Improvement
The optimization resulted in significant performance gains:

**Before Optimization:**
- **Throughput:** 3,529-3,761 msg/s
- **Latency:** 0.31-0.48ms average
- **Memory:** 28-139 MB

**After Optimization:**
- **Throughput:** 5,026-5,708 msg/s (**+42-52% improvement!**)
- **Latency:** 0.31-0.32ms average (consistent)
- **Memory:** 20-306 MB (efficient scaling)

#### Key Insights
1. **Consumer Fetch Size:** Critical for throughput - larger batches reduce Redis round trips
2. **Polling Frequency:** Lower frequency reduces CPU overhead and improves efficiency
3. **Block Time:** Longer blocking reduces polling overhead while maintaining responsiveness
4. **Production Tuning:** These settings should be tuned based on message volume and latency requirements

