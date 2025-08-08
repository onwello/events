# @logistically/events Performance Benchmarks

This directory contains comprehensive performance benchmarks for the `@logistically/events` library, testing throughput, memory usage, and latency across various publishing scenarios.

## 📁 Files Overview

### Core Benchmark Files
- **`comprehensive-benchmark.js`** - Main benchmark suite with detailed analysis
- **`simple-benchmark.js`** - Quick verification benchmark using direct Redis
- **`BENCHMARK_DOCUMENTATION.md`** - Detailed methodology and results
- **`BENCHMARK_SUMMARY.md`** - Quick reference with key findings

### Configuration Files
- **`package.json`** - Benchmark dependencies
- **`tsconfig.json`** - TypeScript configuration

## 🚀 Quick Start

### Prerequisites
1. **Redis Container**: Ensure Redis is running (Docker recommended)
2. **Library Built**: Run `npm run build` in the root directory
3. **Dependencies**: Install benchmark dependencies

```bash
# From the root directory
npm run build
cd benchmarks
npm install
```

### Running Benchmarks

#### 1. Comprehensive Benchmark (Recommended)
```bash
node comprehensive-benchmark.js
```

This runs the full benchmark suite including:
- Individual event publishing
- Batched publishing with detailed analysis
- Concurrent publishing
- Memory efficiency tests
- End-to-end latency tests
- High-throughput stress tests

#### 2. Simple Verification
```bash
node simple-benchmark.js
```

Quick verification using direct Redis operations to validate the setup.

## 📊 Expected Results

### Performance Targets
- **Individual Publishing**: ~30,000 ops/sec
- **Batched Publishing**: ~32,000 ops/sec (batch size 200)
- **High-Throughput**: ~47,000 ops/sec (batch size 1000)
- **End-to-End Latency**: <12ms

### Memory Usage
- **Individual**: ~19 MB
- **Batched**: ~24 MB
- **High-Throughput**: ~35 MB

## 🔧 Configuration

### Redis Setup
```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or using local Redis
redis-server
```

### Environment Variables
- `REDIS_URL` - Redis connection string (default: localhost:6379)
- `BENCHMARK_ITERATIONS` - Number of test iterations (default: 1000)

## 📈 Understanding Results

### Key Metrics
1. **Throughput (ops/sec)**: Events processed per second
2. **Memory Usage (MB)**: Heap memory consumption
3. **Efficiency (ops/sec/MB)**: Throughput per memory unit
4. **Latency (ms)**: End-to-end processing time

### Performance Categories
- **Individual Publishing**: Baseline performance
- **Batched Publishing**: Optimized for bulk operations
- **Concurrent Publishing**: Multi-threaded scenarios
- **High-Throughput**: Maximum performance under load

## 🐛 Troubleshooting

### Common Issues

#### 1. Redis Connection Failed
```bash
# Check Redis is running
redis-cli ping
# Should return PONG
```

#### 2. Library Not Found
```bash
# Ensure library is built
cd .. && npm run build
cd benchmarks
```

#### 3. Memory Issues
```bash
# Increase Node.js heap size
node --max-old-space-size=4096 comprehensive-benchmark.js
```

#### 4. Performance Variations
- **System load**: Run benchmarks on dedicated machine
- **Redis configuration**: Ensure Redis is optimized for performance
- **Network latency**: Use local Redis for accurate results

## 📋 Benchmark Types

### 1. Individual Publishing Test
- **Purpose**: Baseline performance measurement
- **Method**: Sequential event publishing
- **Metrics**: Throughput, memory, duration

### 2. Batched Publishing Test
- **Purpose**: Measure batching effectiveness
- **Batch Sizes**: 10, 25, 50, 100, 200 messages
- **Metrics**: Messages/sec, batches/sec, memory

### 3. Concurrent Publishing Test
- **Purpose**: Multi-threaded performance
- **Concurrency**: 10 simultaneous publishers
- **Metrics**: Throughput under concurrent load

### 4. Memory Efficiency Test
- **Purpose**: Memory usage analysis
- **Method**: Focused memory measurement
- **Metrics**: RSS, heap usage, external memory

### 5. End-to-End Latency Test
- **Purpose**: Complete system performance
- **Method**: Publish → Consume → Measure
- **Metrics**: Round-trip latency, throughput

### 6. High-Throughput Stress Test
- **Purpose**: Maximum performance under load
- **Batch Sizes**: 100, 250, 500, 1000 messages
- **Metrics**: Maximum throughput, memory under stress

## 📊 Result Interpretation

### Performance Analysis
1. **Throughput Comparison**: Compare individual vs batched performance
2. **Memory Efficiency**: Analyze ops/sec/MB ratios
3. **Batch Size Optimization**: Find optimal batch sizes for your use case
4. **Concurrency Impact**: Understand multi-threaded performance

### Key Insights
- **Batching Benefits**: 4.6% throughput improvement with 200 batch size
- **Memory Trade-offs**: Higher memory usage for throughput gains
- **Concurrency Overhead**: Poor performance with multiple publishers
- **Optimal Configurations**: 200 for general use, 1000 for high-throughput

## 🔄 Continuous Benchmarking

### Automated Testing
```bash
# Run benchmarks on code changes
npm run benchmark

# Performance regression testing
npm run benchmark:regression
```

### Historical Tracking
- Results are logged to `benchmark-results.json`
- Performance trends tracked over time
- Regression alerts on performance degradation

## 📚 Additional Resources

- **Detailed Documentation**: See `BENCHMARK_DOCUMENTATION.md`
- **Quick Reference**: See `BENCHMARK_SUMMARY.md`
- **Library Documentation**: See main README.md
- **API Reference**: See docs/API.md

## 🤝 Contributing

### Adding New Benchmarks
1. Create new benchmark file in `src/`
2. Follow existing patterns for consistency
3. Add documentation in `BENCHMARK_DOCUMENTATION.md`
4. Update this README with new benchmark details

### Benchmark Improvements
- **Performance**: Optimize benchmark execution
- **Accuracy**: Improve measurement precision
- **Coverage**: Add new test scenarios
- **Documentation**: Enhance result interpretation

---

*For detailed methodology and comprehensive results, see `BENCHMARK_DOCUMENTATION.md`*
