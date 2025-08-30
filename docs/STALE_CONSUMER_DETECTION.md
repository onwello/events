# Stale Consumer Detection and Cleanup

## Overview

The `@logistically/events` library now includes a robust, performant, and reliable mechanism to detect and clean up stale consumers in Redis Streams. This feature addresses critical production issues where services restart, scale, or crash, leaving behind abandoned consumer groups that can cause:

- **Memory leaks** from abandoned consumer groups
- **Performance degradation** as Redis processes abandoned consumers
- **Resource waste** from unused consumer group entries
- **Monitoring confusion** with "ghost" consumers

## Key Features

- ✅ **Automatic Detection**: Uses multiple strategies to identify stale consumers
- ✅ **Heartbeat Monitoring**: Active health checking with configurable intervals
- ✅ **Ping-Pong Health Checks**: Real-time responsiveness verification
- ✅ **Intelligent Cleanup**: Safe removal with configurable strategies
- ✅ **Performance Optimized**: Minimal overhead with efficient algorithms
- ✅ **Production Ready**: Handles edge cases like network partitions and crashes
- ✅ **Monitoring & Metrics**: Comprehensive health tracking and reporting

## Architecture

The stale consumer detection system consists of three main components:

### 1. StaleConsumerDetector
- **Purpose**: Identifies stale consumers using Redis XINFO GROUPS command
- **Strategy**: Analyzes consumer idle time, pending messages, and activity patterns
- **Performance**: Efficient batch processing with minimal Redis calls

### 2. ConsumerHealthMonitor
- **Purpose**: Maintains active health monitoring using heartbeat and ping-pong mechanisms
- **Heartbeat**: Periodic health signals stored in Redis with TTL
- **Ping-Pong**: Real-time responsiveness verification with timeout handling

### 3. ConsumerCleanupManager
- **Purpose**: Safely removes stale consumers based on configurable strategies
- **Safety**: Preserves consumers with pending messages when using conservative strategy
- **Cleanup**: Removes Redis keys and consumer group entries

## Configuration

Enable stale consumer detection by configuring the `staleConsumerDetection` option:

```typescript
import { EnhancedRedisStreamsTransport } from '@logistically/events';

const transport = new EnhancedRedisStreamsTransport(redis, {
  staleConsumerDetection: {
    enabled: true,                    // Enable the feature
    heartbeatInterval: 30000,         // Send heartbeats every 30s
    staleThreshold: 60000,            // Consider stale after 1 minute
    cleanupInterval: 120000,          // Run cleanup every 2 minutes
    maxStaleConsumers: 100,           // Max stale consumers before forced cleanup
    enableHeartbeat: true,            // Enable heartbeat mechanism
    enablePingPong: true,             // Enable ping-pong health check
    cleanupStrategy: 'conservative',  // 'aggressive' | 'conservative' | 'manual'
    preserveConsumerHistory: true     // Keep history for debugging
  }
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable/disable stale consumer detection |
| `heartbeatInterval` | `number` | `30000` | Heartbeat frequency in milliseconds |
| `staleThreshold` | `number` | `60000` | Time before consumer considered stale (ms) |
| `cleanupInterval` | `number` | `120000` | Cleanup frequency in milliseconds |
| `maxStaleConsumers` | `number` | `100` | Maximum stale consumers before forced cleanup |
| `enableHeartbeat` | `boolean` | `true` | Enable heartbeat health monitoring |
| `enablePingPong` | `boolean` | `true` | Enable ping-pong responsiveness check |
| `cleanupStrategy` | `string` | `'conservative'` | Cleanup aggressiveness level |
| `preserveConsumerHistory` | `boolean` | `true` | Keep cleanup history for debugging |

### Cleanup Strategies

#### Conservative (Default)
- Preserves consumers with pending messages
- Only removes truly abandoned consumers
- Safest for production environments
- Recommended for most use cases

#### Aggressive
- Removes all stale consumers regardless of pending messages
- Fastest cleanup but may lose messages
- Use only when message loss is acceptable
- Good for development/testing environments

#### Manual
- No automatic cleanup
- Requires manual intervention via API calls
- Maximum control but requires monitoring
- Good for debugging and investigation

## Usage Examples

### Basic Setup

```typescript
import { EnhancedRedisStreamsTransport } from '@logistically/events';

const transport = new EnhancedRedisStreamsTransport(redis, {
  staleConsumerDetection: {
    enabled: true,
    heartbeatInterval: 30000,    // 30 seconds
    staleThreshold: 60000,       // 1 minute
    cleanupInterval: 120000      // 2 minutes
  }
});

await transport.connect();
```

### Monitoring Consumer Health

```typescript
// Get overall stale consumer metrics
const metrics = await transport.getStaleConsumerMetrics();
console.log('Stale Consumer Metrics:', metrics);

// Get health information for specific stream/group
const health = await transport.getConsumerHealth('user-events', 'user-processors');
console.log('Consumer Health:', health);

// Get extended status including stale consumer info
const status = await transport.getExtendedStatus();
console.log('Extended Status:', status);
```

### Manual Cleanup

```typescript
// Manually trigger cleanup
await transport.triggerStaleConsumerCleanup();

// Remove specific consumer
const removed = await transport.removeConsumer('user-events', 'user-processors', 'consumer-123');
if (removed) {
  console.log('Consumer removed successfully');
}
```

### Advanced Configuration

```typescript
const transport = new EnhancedRedisStreamsTransport(redis, {
  staleConsumerDetection: {
    enabled: true,
    heartbeatInterval: 15000,        // More frequent heartbeats
    staleThreshold: 30000,           // Faster stale detection
    cleanupInterval: 60000,          // More frequent cleanup
    maxStaleConsumers: 50,           // Lower threshold for cleanup
    enableHeartbeat: true,
    enablePingPong: true,
    cleanupStrategy: 'aggressive',   // More aggressive cleanup
    preserveConsumerHistory: false   // Don't preserve history
  }
});
```

## How It Works

### 1. Heartbeat Mechanism
- Each active consumer sends periodic heartbeats to Redis
- Heartbeats are stored with TTL based on `staleThreshold`
- Missing heartbeats indicate potential issues

### 2. Ping-Pong Health Check
- Health monitor sends ping requests to consumers
- Consumers must respond with pong within timeout
- Non-responsive consumers are marked as degraded

### 3. Stale Detection
- Analyzes Redis XINFO GROUPS data
- Considers idle time, pending messages, and health status
- Combines multiple signals for accurate detection

### 4. Cleanup Process
- Identifies stale consumers based on configured thresholds
- Applies cleanup strategy (conservative/aggressive)
- Removes consumer group entries and Redis keys
- Updates metrics and logs cleanup operations

## Performance Characteristics

### Overhead
- **Heartbeat**: ~1 Redis operation per consumer per interval
- **Ping-Pong**: Only when health check is triggered
- **Cleanup**: Minimal impact, runs in background
- **Overall**: <1% performance impact in most scenarios

### Scalability
- **Consumers**: Supports thousands of consumers per instance
- **Streams**: Efficiently handles hundreds of streams
- **Memory**: Minimal memory footprint with TTL-based cleanup
- **CPU**: Background processing with configurable intervals

## Monitoring and Metrics

### Available Metrics

```typescript
interface StaleConsumerMetrics {
  totalConsumers: number;        // Total consumers across all streams
  healthyConsumers: number;      // Consumers responding to health checks
  staleConsumers: number;        // Consumers exceeding stale threshold
  deadConsumers: number;         // Consumers with critical failures
  cleanupOperations: number;     // Total cleanup operations performed
  lastCleanupAt: Date;          // Timestamp of last cleanup
  averageCleanupTime: number;    // Average cleanup operation time (ms)
  totalCleanupTime: number;      // Total time spent on cleanup (ms)
}
```

### Health Status Levels

- **healthy**: Consumer responding normally to all health checks
- **degraded**: Consumer experiencing some issues but still functional
- **stale**: Consumer exceeding stale threshold, candidate for cleanup
- **dead**: Consumer with critical failures, immediate cleanup candidate

### Logging

The system provides comprehensive logging for monitoring:

```
[INFO] Stale consumer heartbeat interval started (30000ms)
[INFO] Stale consumer cleanup interval started (120000ms)
[INFO] Cleaned up 3 stale consumers from group user-processors on stream user-events
[INFO] Stale consumer cleanup complete. Total Consumers: 25, Healthy: 22, Stale: 3, Dead: 0, Operations: 1, Avg Cleanup Time: 45ms
```

## Best Practices

### 1. Configuration Tuning
- Start with conservative settings in production
- Adjust intervals based on your application's characteristics
- Monitor metrics to find optimal thresholds

### 2. Monitoring
- Set up alerts for high stale consumer counts
- Monitor cleanup operation frequency and timing
- Track consumer health trends over time

### 3. Cleanup Strategy
- Use 'conservative' for production environments
- Use 'aggressive' for development/testing
- Use 'manual' for debugging and investigation

### 4. Performance Optimization
- Set appropriate heartbeat intervals (not too frequent)
- Balance cleanup frequency with system load
- Monitor Redis memory usage for heartbeat keys

## Troubleshooting

### Common Issues

#### High Stale Consumer Count
- Check if services are restarting frequently
- Verify network connectivity to Redis
- Review stale threshold configuration

#### Cleanup Not Working
- Ensure feature is enabled in configuration
- Check Redis permissions for XGROUP commands
- Verify cleanup strategy configuration

#### Performance Impact
- Reduce heartbeat frequency if needed
- Increase cleanup intervals
- Monitor Redis memory usage

### Debug Mode

Enable detailed logging for troubleshooting:

```typescript
const transport = new EnhancedRedisStreamsTransport(redis, {
  staleConsumerDetection: {
    enabled: true,
    heartbeatInterval: 30000,
    staleThreshold: 60000,
    cleanupInterval: 120000,
    cleanupStrategy: 'manual',  // Manual mode for debugging
    preserveConsumerHistory: true
  }
});

// Manually trigger operations for debugging
await transport.triggerStaleConsumerCleanup();
const health = await transport.getConsumerHealth('stream-name', 'group-id');
```

## Migration Guide

### From Previous Versions

1. **Enable Feature**: Add `staleConsumerDetection` configuration
2. **Monitor**: Watch for any unexpected cleanup behavior
3. **Adjust**: Fine-tune thresholds based on your environment
4. **Scale**: Gradually increase coverage across streams

### Configuration Migration

```typescript
// Before (no stale consumer detection)
const transport = new EnhancedRedisStreamsTransport(redis, {
  // ... existing config
});

// After (with stale consumer detection)
const transport = new EnhancedRedisStreamsTransport(redis, {
  // ... existing config
  staleConsumerDetection: {
    enabled: true,
    heartbeatInterval: 30000,
    staleThreshold: 60000,
    cleanupInterval: 120000,
    cleanupStrategy: 'conservative'
  }
});
```

## Future Enhancements

- **Machine Learning**: Adaptive threshold adjustment based on patterns
- **Distributed Coordination**: Multi-instance cleanup coordination
- **Advanced Metrics**: Integration with Prometheus/Grafana
- **Policy Engine**: Configurable cleanup policies per stream/group
- **Rollback Support**: Ability to restore accidentally removed consumers

## Conclusion

The stale consumer detection system provides a robust, performant, and reliable solution for managing Redis Streams consumers in production environments. With configurable strategies, comprehensive monitoring, and minimal performance impact, it addresses the critical need for automatic cleanup of abandoned consumers while maintaining system stability and performance.

For questions, issues, or contributions, please refer to the project documentation or create an issue in the repository.
