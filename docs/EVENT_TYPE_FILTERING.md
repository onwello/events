# Event Type Filtering in Redis Transport

## Overview

The Redis transport now supports sophisticated event type filtering through a **single, intelligent `subscribe` method** that automatically detects whether you're subscribing to an exact event type or a pattern. This eliminates the complexity of choosing between different subscription methods while providing powerful message routing capabilities.

## Key Features

- ✅ **Single Subscribe Method**: One method handles both exact and pattern subscriptions
- ✅ **Automatic Pattern Detection**: Patterns are detected by presence of `*` wildcards
- ✅ **Exact Event Type Filtering**: Subscribe to specific event types only
- ✅ **Pattern-Based Filtering**: Use wildcard patterns for flexible matching
- ✅ **Mixed Subscription Types**: Combine exact and pattern subscriptions
- ✅ **High Performance**: Efficient filtering without message duplication
- ✅ **Backward Compatibility**: Existing code continues to work unchanged
- ✅ **Scalable Design**: One stream can handle multiple event types efficiently
- ✅ **Simplified Client Code**: No need to choose between methods

## Architecture

### Message Flow

```
Publisher → Redis Stream (location-events)
                ↓
        Single Subscribe Method
                ↓
    Automatic Pattern Detection
                ↓
    Event Type Filtering Layer
                ↓
    Handler Execution (Filtered)
```

### Subscription Types

1. **Exact Subscriptions**: No wildcards - only receive messages with exact event type match
2. **Pattern Subscriptions**: Contains `*` wildcards - automatically detected and handled
3. **Mixed Subscriptions**: Both types can coexist on the same stream seamlessly

## Usage Examples

### Single Subscribe Method - Auto-Detects Patterns

The transport now uses a single `subscribe` method that automatically detects whether you're subscribing to an exact event type or a pattern:

```typescript
// Exact event type subscription (no wildcards)
await consumer.subscribe('location.user.invite.created', handler);

// Pattern subscription (contains wildcards) - automatically detected
await consumer.subscribe('location.user.invite.*', handler);

// Complex pattern - automatically detected
await consumer.subscribe('*.user.*.updated', handler);
```

### Exact Event Type Subscription

```typescript
// Subscribe to exact event type
await consumer.subscribe('location.user.invite.created', handler);

// This handler will ONLY receive 'location.user.invite.created' events
// It will NOT receive 'location.user.invite.status.updated' events
```

### Pattern-Based Subscription

```typescript
// Subscribe to pattern (wildcards are auto-detected)
await consumer.subscribe('location.user.invite.*', handler);

// This handler will receive ALL invite-related events:
// - location.user.invite.created
// - location.user.invite.status.updated
// - location.user.invite.deleted
// - etc.
```

### Complex Pattern Matching

```typescript
// Subscribe to complex pattern (auto-detected)
await consumer.subscribe('*.user.*.updated', handler);

// This handler will receive:
// - eu.de.user.profile.updated
// - us.ca.user.settings.updated
// - user.profile.updated
// But NOT:
// - eu.de.user.created
// - eu.de.order.user.updated
```

### Multiple Subscriptions to Same Stream

```typescript
// Subscribe to different event types on same stream
await consumer.subscribe('location-events', handler1, {}, 'location.user.invite.created');
await consumer.subscribe('location-events', handler2, {}, 'location.user.invite.status.updated');

// Each handler receives only its specific event type
// No message duplication or cross-contamination
```

## Pattern Syntax

### Wildcard Patterns

- `*` - Matches any segment (e.g., `user.*` matches `user.created`, `user.updated`)
- `*.user.*` - Matches any prefix and suffix around `user`
- `user.*.updated` - Matches any middle segment between `user` and `updated`

### Pattern Examples

| Pattern | Matches | Does Not Match |
|---------|---------|----------------|
| `user.*` | `user.created`, `user.updated`, `user.deleted` | `order.created`, `user` |
| `*.created` | `user.created`, `order.created`, `product.created` | `user.updated`, `created` |
| `*.user.*.updated` | `eu.de.user.profile.updated`, `us.ca.user.settings.updated` | `user.profile.updated`, `eu.de.user.created` |
| `user.profile.*` | `user.profile.updated`, `user.profile.deleted` | `user.settings.updated`, `user.profile` |

## Implementation Details

### Transport Interface Updates

```typescript
interface Transport {
  // Updated to support event type filtering
  subscribe(topic: string, handler: MessageHandler, options?: SubscribeOptions, eventType?: string): Promise<void>;
}

interface AdvancedTransport extends Transport {
  // Pattern-based routing
  subscribePattern(pattern: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void>;
  unsubscribePattern(pattern: string): Promise<void>;
}
```

### Subscription Storage

```typescript
interface StreamSubscription {
  streamName: string;
  groupId: string;
  consumerId: string;
  handler: MessageHandler;
  eventType?: string;        // For exact subscriptions
  isPattern?: boolean;       // Whether this is a pattern subscription
  pattern?: string;          // For pattern subscriptions
  // ... other fields
}
```

### Message Filtering Logic

```typescript
private shouldProcessMessage(subscription: StreamSubscription, envelope: EventEnvelope): boolean {
  const messageEventType = envelope.header.type;
  
  if (subscription.isPattern && subscription.pattern) {
    // Pattern subscription - check if message matches pattern
    return this.matchesEventPattern(messageEventType, subscription.pattern);
  } else if (subscription.eventType) {
    // Exact subscription - check if event types match exactly
    return messageEventType === subscription.eventType;
  }
  
  // Backward compatibility - process all messages if no filtering criteria
  return true;
}
```

## Performance Characteristics

### Filtering Overhead

- **Exact Matching**: O(1) string comparison
- **Pattern Matching**: O(n) regex matching where n is pattern complexity
- **Memory Usage**: Minimal overhead per subscription
- **CPU Impact**: Negligible for most workloads

### Scalability

- **Stream Efficiency**: One stream handles multiple event types
- **Subscription Scaling**: Linear scaling with number of subscriptions
- **Message Throughput**: No degradation with filtering enabled
- **Memory Scaling**: Constant memory per subscription

## Testing

### Unit Tests

```bash
# Run unit tests for event type filtering
npm test -- --testPathPattern=enhanced-redis-streams-transport.spec.ts
```

### Integration Tests

```bash
# Run integration tests (requires Redis)
npm test -- --testPathPattern=event-type-filtering-integration.spec.ts
```

### Test Coverage

- ✅ Exact event type matching
- ✅ Pattern-based matching
- ✅ Mixed subscription types
- ✅ Error handling and resilience
- ✅ Performance and scalability
- ✅ Backward compatibility

## Migration Guide

### From Previous Version

**No changes required** - existing code continues to work unchanged:

```typescript
// This still works exactly as before
await consumer.subscribe('topic', handler);
```

### To Use New Features

**Optional** - add event type filtering when needed:

```typescript
// Before: Received all messages from stream
await consumer.subscribe('location-events', handler);

// After: Receive only specific event types
await consumer.subscribe('location-events', handler, {}, 'location.user.invite.created');
```