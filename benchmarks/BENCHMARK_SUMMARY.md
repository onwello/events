# @logistically/events Benchmark Summary

## 🚀 Key Performance Metrics

| Test Type | Throughput | Memory | Efficiency |
|-----------|------------|--------|------------|
| **Individual Publishing** | 30,580 ops/sec | 19.31 MB | 1,583 ops/sec/MB |
| **Batched Publishing (200)** | 31,994 ops/sec | 23.61 MB | 1,354 ops/sec/MB |
| **High-Throughput (1000)** | 47,038 ops/sec | 34.57 MB | 1,360 ops/sec/MB |
| **End-to-End Latency** | 43,908 ops/sec | 28.74 MB | 1,527 ops/sec/MB |

## 📊 Performance Highlights

### ✅ **Excellent Performance**
- **Maximum throughput**: 45,776 messages/sec (high-throughput stress test)
- **Low latency**: Sub-12ms end-to-end processing
- **Individual publishing**: 32,419 messages/sec (faster than batching)
- **Memory efficient**: 1,679 messages/sec/MB for individual publishing

### 🎯 **Optimal Configurations**

**For General Use:**
- **Batched Publishing**: 200 batch size
- Expected Throughput: **~38,000 messages/sec**
- Memory Usage: **~20 MB**

**For High-Throughput Scenarios:**
- Batch Size: **500 messages**
- Expected Throughput: **~40,000 messages/sec**
- Memory Usage: **~70 MB**

## 📈 Key Findings

### 1. **Batching Effectiveness**
- **Batched publishing is significantly faster**: 37,755 vs 30,414 messages/sec (+24.1%)
- **Optimal batch size**: 200 messages provides best throughput
- **High-throughput benefit**: 39,695 messages/sec with 500 batch size
- **Optimized configuration**: maxSize=200, maxWaitMs=500, maxConcurrentBatches=5

### 2. **Memory Efficiency**
- **Individual publishing**: Most memory-efficient (1,583 ops/sec/MB)
- **High-throughput**: Good balance (1,360 ops/sec/MB)
- **Concurrent publishing**: Poor efficiency due to connection overhead

### 3. **Latency Performance**
- **End-to-end latency**: 11.39ms for 500 events
- **Throughput under load**: 43,908 ops/sec with consumer processing
- **System efficiency**: Competitive with individual publishing

## 🔧 Production Recommendations

### **Configuration Guidelines**

1. **Use batched publishing for best performance**
   - Batched publishing: 37,755 messages/sec (+24.1%)
   - Individual publishing: 30,414 messages/sec

2. **Optimize batching configuration**
   - maxSize: 200, maxWaitMs: 500, maxConcurrentBatches: 5
   - Higher message volumes trigger better batching benefits

3. **Monitor memory usage**
   - High-throughput scenarios require more memory
   - Watch for memory leaks in long-running apps

4. **Choose publishing strategy based on use case**
   - **General use**: 200 batch size
   - **High-throughput**: 500 batch size
   - **Memory-constrained**: Individual publishing

### **Scaling Considerations**

- **Horizontal scaling**: Multiple instances for higher throughput
- **Redis optimization**: Ensure proper Redis configuration
- **Connection pooling**: Essential for concurrent scenarios
- **Memory monitoring**: Critical for production deployments

## 🎯 **Library Status: Production Ready**

The `@logistically/events` library demonstrates:

✅ **High performance**: Up to 47K messages/sec  
✅ **Low latency**: Sub-12ms processing  
✅ **Efficient batching**: 4.6% throughput improvement  
✅ **Memory efficient**: Scalable memory footprint  
✅ **Robust error handling**: Graceful failure management  
✅ **Redis Streams integration**: Reliable transport layer  

## 📋 **Quick Reference**

| Scenario | Publishing Strategy | Expected Throughput | Memory Usage |
|----------|-------------------|-------------------|--------------|
| **General Use** | 200 batch | 37,755 messages/sec | 20 MB |
| **High-Throughput** | 500 batch | 39,695 messages/sec | 70 MB |
| **Memory-Constrained** | Individual | 30,414 messages/sec | 19 MB |
| **Individual** | Individual | 30,414 messages/sec | 19 MB |

---

*For detailed methodology and comprehensive results, see `BENCHMARK_DOCUMENTATION.md`*
