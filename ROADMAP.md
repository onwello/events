# @logistically/events Library Roadmap

## 🎯 Overview

This roadmap combines critical user requirements with production readiness feedback to guide the evolution of the `@logistically/events` library. Items are prioritized based on production impact, user experience, and technical complexity.

## 🚨 Critical Priority (Must Have)

### 1. Stream Control & Configuration
**Issue**: Library publishes to unintended streams (e.g., "console" instead of intended stream)
**Impact**: High - affects data organization and consumption patterns

**Requirements**:
- [ ] **Explicit stream naming**: Allow developers to specify exact stream names
- [ ] **Stream validation**: Validate stream names before publishing
- [ ] **Default stream behavior**: Clear defaults that don't interfere with existing streams
- [ ] **Stream isolation**: Prevent accidental cross-contamination between test/prod streams

**Implementation**:
```javascript
// Proposed API
const publisher = new EventPublisher({
  redis: transport,
  defaultStream: 'my-events', // Explicit default
  streamPrefix: 'prod', // Optional prefix for isolation
  streamValidation: true // Validate stream names
});
```

### 2. Consumer Group Management
**Issue**: Manual consumer group creation required, no automatic setup
**Impact**: High - affects developer experience and production deployment

**Requirements**:
- [ ] **Auto-create consumer groups**: Configurable automatic group creation
- [ ] **Group naming strategy**: Flexible naming conventions
- [ ] **Group validation**: Ensure groups exist before consumption
- [ ] **Group cleanup**: Optional cleanup of unused groups

**Implementation**:
```javascript
// Proposed API
const consumer = new RedisStreamConsumer({
  redis: redis,
  stream: 'my-events',
  group: 'my-consumer-group',
  autoCreateGroup: true, // Auto-create if doesn't exist
  groupNamingStrategy: 'service-name', // or 'custom'
  cleanupUnusedGroups: false // Optional cleanup
});
```

## 🔥 High Priority (Production Critical)

### 3. Configurable Trim Strategy
**Issue**: No built-in stream trimming, leading to unbounded memory growth
**Impact**: High - critical for production memory management

**Requirements**:
- [ ] **Automatic trimming**: Configurable MAXLEN strategy
- [ ] **Manual trimming**: XTRIM operations with configurable parameters
- [ ] **Trim events**: Events triggered when trimming occurs
- [ ] **Memory monitoring**: Built-in memory usage tracking

**Implementation**:
```javascript
// Proposed API
const publisher = new EventPublisher({
  redis: transport,
  trimStrategy: {
    enabled: true,
    maxLength: 10000, // MAXLEN ~ 10000
    trimPolicy: 'minid', // or 'maxlen'
    trimThreshold: 0.8, // Trim when 80% full
    trimBatchSize: 1000 // Trim in batches
  }
});
```

### 4. Redis Failover & Cluster Support
**Issue**: No testing with Redis Sentinel or Cluster (from ChatGPT feedback)
**Impact**: High - critical for production high availability

**Requirements**:
- [ ] **Sentinel support**: Automatic failover handling
- [ ] **Cluster support**: Multi-shard Redis cluster
- [ ] **Failover recovery**: Message loss/duplication handling
- [ ] **Connection resilience**: Automatic reconnection strategies

**Implementation**:
```javascript
// Proposed API
const transport = new RedisTransport({
  sentinels: [
    { host: 'sentinel1', port: 26379 },
    { host: 'sentinel2', port: 26379 }
  ],
  name: 'mymaster',
  failoverStrategy: 'retry', // or 'failfast'
  maxRetries: 3
});
```

### 5. Backpressure & Slow Consumer Handling
**Issue**: No handling of consumer lag or backpressure (from ChatGPT feedback)
**Impact**: High - affects system stability under load

**Requirements**:
- [ ] **Backpressure detection**: Monitor pending list size
- [ ] **Slow consumer alerts**: Notify when consumers lag behind
- [ ] **Graceful degradation**: Handle consumer failures
- [ ] **Recovery strategies**: Automatic recovery mechanisms

**Implementation**:
```javascript
// Proposed API
const consumer = new RedisStreamConsumer({
  redis: redis,
  backpressureThreshold: 1000, // Alert when PEL > 1000
  slowConsumerThreshold: 5000, // Alert when lag > 5000ms
  recoveryStrategy: 'exponential-backoff',
  maxRetries: 5
});
```

## 🔶 Medium Priority (Important Features)

### 6. Postfix Handling for Targeted Replays
**Issue**: No support for targeted message replay scenarios
**Impact**: Medium - affects debugging and replay capabilities

**Requirements**:
- [ ] **Postfix support**: Configurable postfix for stream names
- [ ] **Replay scenarios**: Support for targeted replay testing
- [ ] **Stream isolation**: Separate replay streams from production
- [ ] **Replay cleanup**: Automatic cleanup of replay streams

**Implementation**:
```javascript
// Proposed API
const publisher = new EventPublisher({
  redis: transport,
  postfix: 'replay-2024-01-15', // For replay scenarios
  replayMode: false, // Enable replay-specific behavior
  replayCleanup: true // Auto-cleanup replay streams
});
```

### 7. Schema Flexibility
**Issue**: Library enforces Zod schema, limiting flexibility
**Impact**: Medium - affects developer choice and adoption

**Requirements**:
- [ ] **Optional validation**: Make Zod schema optional
- [ ] **Custom validators**: Support for custom validation functions
- [ ] **Schema recommendations**: Keep Zod as recommended default
- [ ] **Validation events**: Events for validation failures

**Implementation**:
```javascript
// Proposed API
const publisher = new EventPublisher({
  redis: transport,
  validation: {
    enabled: true, // Optional validation
    schema: zodSchema, // Optional Zod schema
    customValidator: (event) => boolean, // Custom validation
    strictMode: false // Allow unknown fields
  }
});
```

### 8. Comprehensive Metrics & Monitoring
**Issue**: Limited metrics for production monitoring (from ChatGPT feedback)
**Impact**: Medium - affects production observability

**Requirements**:
- [ ] **Built-in metrics**: Publish/consume latency, throughput
- [ ] **Redis metrics**: CPU, memory, stream length
- [ ] **Prometheus integration**: Standard metrics format
- [ ] **Health checks**: Library health status

**Implementation**:
```javascript
// Proposed API
const metrics = new EventMetrics({
  enabled: true,
  prometheus: true,
  customMetrics: ['custom.metric'],
  healthCheck: {
    enabled: true,
    interval: 30000 // 30s
  }
});
```

## 🔵 Low Priority (Nice to Have)

### 9. Advanced Event Loop Monitoring
**Issue**: No correlation of latency spikes with system events (from ChatGPT feedback)
**Impact**: Low - affects debugging but not core functionality

**Requirements**:
- [ ] **Event loop monitoring**: Track Node.js event loop delays
- [ ] **Latency correlation**: Correlate spikes with system events
- [ ] **Performance profiling**: Built-in performance analysis
- [ ] **Debugging tools**: Enhanced debugging capabilities

### 10. Extended Load Testing Framework
**Issue**: Limited long-running tests (from ChatGPT feedback)
**Impact**: Low - affects confidence but not core functionality

**Requirements**:
- [ ] **24+ hour tests**: Long-running stability tests
- [ ] **Memory leak detection**: Automatic leak detection
- [ ] **Stress testing**: Built-in stress test scenarios
- [ ] **Performance regression**: Automated regression detection

## 📊 Implementation Timeline

### Phase 1 (Critical - 2-4 weeks)
1. **Stream Control & Configuration** - Week 1-2
2. **Consumer Group Management** - Week 2-3
3. **Configurable Trim Strategy** - Week 3-4

### Phase 2 (High Priority - 4-6 weeks)
4. **Redis Failover & Cluster Support** - Week 5-7
5. **Backpressure & Slow Consumer Handling** - Week 7-9

### Phase 3 (Medium Priority - 6-8 weeks)
6. **Postfix Handling for Targeted Replays** - Week 10-11
7. **Schema Flexibility** - Week 11-12
8. **Comprehensive Metrics & Monitoring** - Week 12-15

### Phase 4 (Low Priority - 8-12 weeks)
9. **Advanced Event Loop Monitoring** - Week 16-20
10. **Extended Load Testing Framework** - Week 20-24

## 🎯 Success Criteria

### Phase 1 Success
- [ ] All publishing goes to intended streams
- [ ] Consumer groups auto-create when needed
- [ ] Streams are automatically trimmed to prevent memory growth

### Phase 2 Success
- [ ] Library works seamlessly with Redis Sentinel/Cluster
- [ ] System gracefully handles consumer lag and backpressure
- [ ] No message loss during failover scenarios

### Phase 3 Success
- [ ] Developers can use custom validation or none at all
- [ ] Replay scenarios are supported with postfix handling
- [ ] Comprehensive metrics are available for production monitoring

### Phase 4 Success
- [ ] Advanced debugging and monitoring capabilities
- [ ] Long-running stability is validated
- [ ] Performance regression detection is automated

## 🔧 Technical Considerations

### Breaking Changes
- **Stream naming**: May require migration for existing users
- **Schema validation**: Optional validation may affect existing code
- **Consumer group naming**: Auto-creation may conflict with existing groups

### Migration Strategy
- **Backward compatibility**: Maintain existing APIs where possible
- **Deprecation warnings**: Clear migration path for breaking changes
- **Documentation updates**: Comprehensive migration guides

### Testing Strategy
- **Unit tests**: Comprehensive test coverage for new features
- **Integration tests**: Redis cluster/sentinel testing
- **Performance tests**: Validate no performance regression
- **Migration tests**: Ensure smooth upgrades

---

*This roadmap prioritizes user requirements and production readiness feedback to guide the evolution of the @logistically/events library.*
