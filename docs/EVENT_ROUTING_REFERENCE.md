# Event Routing System Reference

## Overview

The Event Routing System provides a flexible, pattern-based routing mechanism for events with support for origin-based isolation, topic mapping, and transport capabilities validation. This system is designed to handle complex routing scenarios while maintaining performance and reliability.

## Core Interfaces

### EventRoute

Defines a single routing rule for events.

```typescript
interface EventRoute {
  pattern: string;           // Pattern string (e.g., 'user.*', '*.user.*')
  transport: string;         // Transport name/identifier
  priority?: number;         // Higher priority routes are matched first
  options?: {
    topic?: string;          // Custom Redis topic (optional)
    partition?: number;      // Partition number for ordering
    ordering?: 'strict' | 'per-partition' | 'none';
    retention?: {
      maxAge?: number;       // Maximum age in milliseconds
      maxSize?: number;      // Maximum size in bytes
      maxMessages?: number;  // Maximum number of messages
    };
  };
}
```

**Pattern Examples:**
- `user.*` - Matches all user events (user.created, user.updated, etc.)
- `*.user.*` - Matches user events with any prefix/suffix
- `user.created` - Exact match for user.created events
- `order.*.completed` - Matches order events ending with completed

### RoutingConfig

Main configuration object for the routing system.

```typescript
interface RoutingConfig {
  routes: EventRoute[];                    // Array of routing rules
  validationMode: 'strict' | 'warn' | 'ignore';
  originPrefix?: string;                   // e.g., 'eu.de', 'us.ca', 'dz.ma'
  topicMapping: {                          // Pattern to topic name mapping
    [pattern: string]: string;             // e.g., '*.user.*' -> 'user'
  };
  defaultTopicStrategy: 'namespace' | 'custom';
  customTopicWord?: string;                // Used when strategy is 'custom'
  enablePatternRouting?: boolean;          // Enable pattern-based routing
  enableBatching?: boolean;                // Enable message batching
  enablePartitioning?: boolean;            // Enable message partitioning
  enableConsumerGroups?: boolean;          // Enable consumer groups
}
```

### RoutingValidationResult

Result of configuration validation.

```typescript
interface RoutingValidationResult {
  valid: boolean;              // Whether configuration is valid
  warnings: string[];          // Warning messages
  errors: string[];            // Error messages
  unsupportedFeatures: string[]; // Features not supported by transports
}
```

## Pattern Validation Rules

### Event Type Format
- **Allowed**: Alphanumeric characters and dots only
- **Examples**: `user.created`, `order.payment.processing`, `product123.inventory`
- **Invalid**: `user-created`, `user_created`, `user.created*`

### Pattern Format
- **Allowed**: Alphanumeric characters, dots, and asterisks
- **Cannot start or end with dot**: `.user.*` ❌, `user.*.` ❌
- **Cannot have consecutive dots**: `user..created` ❌
- **Cannot have consecutive asterisks**: `user.**.created` ❌
- **Asterisk must be standalone**: `user*created` ❌, `user.*created*` ❌

### Valid Pattern Examples
- `user.*` ✅
- `*.user.*` ✅
- `user.created` ✅
- `user.*.updated` ✅
- `*.created` ✅
- `user` ✅

### Invalid Pattern Examples
- `.user.*` ❌ (starts with dot)
- `user.*.` ❌ (ends with dot)
- `user..created` ❌ (consecutive dots)
- `user.**.created` ❌ (consecutive asterisks)
- `user*created` ❌ (asterisk mixed with characters)
- `user.*created*` ❌ (asterisk mixed with characters)

## Origin Prefix System

### Purpose
The origin prefix system provides regional isolation and namespace separation for events. It allows different regions or environments to have isolated event streams while maintaining the same logical structure.

### Configuration
```typescript
const config: RoutingConfig = {
  // ... other config
  originPrefix: 'eu.de',  // European Germany region
  // ... other config
};
```

### Behavior

#### With Origin Prefix Configured
- **Exact Patterns**: `user.created` only matches `eu.de.user.created`
- **Wildcard Patterns**: `user.*` matches `eu.de.user.created`, `eu.de.user.updated`
- **Patterns Starting with Asterisk**: `*.user.*` matches any origin prefix

#### Without Origin Prefix
- **Exact Patterns**: `user.created` matches `user.created` only
- **Wildcard Patterns**: `user.*` matches `user.created`, `user.updated`
- **Patterns Starting with Asterisk**: `*.user.*` matches any prefix

### Examples

```typescript
// With originPrefix: 'eu.de'
router.matchesPattern('eu.de.user.created', 'user.created');     // ✅ true
router.matchesPattern('user.created', 'user.created');           // ❌ false
router.matchesPattern('us.ca.user.created', 'user.created');     // ❌ false

router.matchesPattern('eu.de.user.created', 'user.*');           // ✅ true
router.matchesPattern('us.ca.user.created', 'user.*');           // ✅ true (any prefix allowed)

router.matchesPattern('user.created', '*.user.*');               // ✅ true
router.matchesPattern('eu.de.user.created', '*.user.*');        // ✅ true
router.matchesPattern('us.ca.user.created', '*.user.*');        // ✅ true
```

## Topic Resolution

### Topic Mapping
Topic mapping allows you to define custom topic names for specific event patterns.

```typescript
const config: RoutingConfig = {
  // ... other config
  topicMapping: {
    'user.created': 'user',
    'user.*': 'user',
    '*.created': 'created',
    'order.*': 'order'
  },
  // ... other config
};
```

### Resolution Strategy
1. **Exact Pattern Match**: Check if event type exactly matches a mapped pattern
2. **Wildcard Pattern Match**: Check if event type matches any wildcard patterns
3. **Suffix Matching**: For exact patterns, allow matching as suffix (e.g., `user.created` matches `eu.de.user.created`)
4. **Fallback**: Apply default topic strategy if no mapping found

### Default Topic Strategy

#### Namespace Strategy
Uses the first segment of the event type as the topic name.

```typescript
const config: RoutingConfig = {
  // ... other config
  defaultTopicStrategy: 'namespace',
  // ... other config
};

// Examples:
// 'user.created' -> 'user-events'
// 'order.payment.processing' -> 'order-events'
// 'product.inventory.updated' -> 'product-events'
```

#### Custom Strategy
Uses a configured word as the topic name.

```typescript
const config: RoutingConfig = {
  // ... other config
  defaultTopicStrategy: 'custom',
  customTopicWord: 'app',
  // ... other config
};

// Examples:
// 'user.created' -> 'app-events'
// 'order.completed' -> 'app-events'
// 'product.updated' -> 'app-events'
```

**Note**: Custom strategy requires `customTopicWord` to be specified, otherwise validation will fail.

### Topic Name Format
- **Allowed**: Lowercase alphanumeric characters and hyphens only
- **Examples**: `user-events`, `order-processing`, `product-inventory`
- **Invalid**: `User_Events`, `order.events`, `product-events!`

## Transport Capabilities Validation

### Supported Features
The routing system validates that configured transports support the required features:

- **Pattern Routing**: `supportsPatternRouting`
- **Batching**: `supportsBatching`
- **Partitioning**: `supportsPartitioning`
- **Consumer Groups**: `supportsConsumerGroups`

### Validation Modes

#### Strict Mode
- **Errors**: Configuration fails if any required features are unsupported
- **Warnings**: Configuration fails if there are warnings

```typescript
const config: RoutingConfig = {
  validationMode: 'strict',
  enablePatternRouting: true,
  // ... other config
};

// Will throw error if no transports support pattern routing
```

#### Warn Mode
- **Errors**: Configuration fails if any required features are unsupported
- **Warnings**: Configuration succeeds with warnings logged

```typescript
const config: RoutingConfig = {
  validationMode: 'warn',
  enablePatternRouting: true,
  // ... other config
};

// Will succeed with warnings if some transports don't support features
```

#### Ignore Mode
- **Errors**: Configuration fails if any required features are unsupported
- **Warnings**: Warnings are ignored

```typescript
const config: RoutingConfig = {
  validationMode: 'ignore',
  enablePatternRouting: true,
  // ... other config
};

// Will succeed and ignore warnings
```

## Usage Examples

### Basic Configuration

```typescript
import { createEventRouter, RoutingConfig } from './event-routing';

const config: RoutingConfig = {
  routes: [
    {
      pattern: 'user.*',
      transport: 'redis',
      priority: 1
    },
    {
      pattern: 'order.*',
      transport: 'memory',
      priority: 2
    }
  ],
  validationMode: 'warn',
  topicMapping: {
    'user.created': 'user',
    'order.completed': 'order'
  },
  defaultTopicStrategy: 'namespace',
  enablePatternRouting: true,
  enableBatching: false,
  enablePartitioning: false,
  enableConsumerGroups: false
};

const router = createEventRouter(config, transportCapabilities);
```

### Origin-Based Routing

```typescript
const config: RoutingConfig = {
  routes: [
    {
      pattern: 'user.*',
      transport: 'eu-redis',
      options: { topic: 'eu-user' }
    },
    {
      pattern: 'user.*',
      transport: 'us-redis',
      options: { topic: 'us-user' }
    }
  ],
  validationMode: 'strict',
  originPrefix: 'eu.de',
  topicMapping: {
    'user.created': 'user',
    'user.updated': 'user'
  },
  defaultTopicStrategy: 'namespace',
  enablePatternRouting: true,
  enableBatching: false,
  enablePartitioning: false,
  enableConsumerGroups: false
};
```

### Advanced Pattern Matching

```typescript
const config: RoutingConfig = {
  routes: [
    {
      pattern: '*.user.*',
      transport: 'redis',
      options: {
        topic: 'user-events',
        partition: 1,
        ordering: 'strict'
      }
    },
    {
      pattern: 'user.*.completed',
      transport: 'memory',
      options: {
        topic: 'user-completed',
        retention: {
          maxAge: 86400000, // 24 hours
          maxMessages: 1000
        }
      }
    }
  ],
  validationMode: 'warn',
  topicMapping: {
    '*.user.*': 'user',
    'user.*.completed': 'user-completed'
  },
  defaultTopicStrategy: 'custom',
  customTopicWord: 'events',
  enablePatternRouting: true,
  enableBatching: true,
  enablePartitioning: true,
  enableConsumerGroups: true
};
```

## Factory Functions

### createEventRouter

Creates a new EventRouter instance with validation.

```typescript
function createEventRouter(
  config: RoutingConfig, 
  transportCapabilities: Map<string, TransportCapabilities>
): EventRouter
```

### createBasicRoutingConfig

Creates a basic routing configuration with sensible defaults.

```typescript
function createBasicRoutingConfig(
  routes: EventRoute[],
  validationMode: 'strict' | 'warn' | 'ignore' = 'warn',
  originPrefix?: string,
  topicMapping: { [pattern: string]: string } = {},
  defaultTopicStrategy: 'namespace' | 'custom' = 'namespace',
  customTopicWord?: string
): RoutingConfig
```

## Error Handling

### Configuration Validation Errors
- **Invalid patterns**: Malformed pattern strings
- **Invalid topic names**: Non-compliant topic name format
- **Missing custom word**: Custom strategy without customTopicWord
- **Unsupported features**: Required features not supported by transports

### Runtime Errors
- **Pattern validation**: Invalid patterns during matching
- **Topic resolution**: Unable to resolve topic for event type
- **Transport validation**: Transport not found or capabilities mismatch

## Performance Considerations

### Pattern Matching
- **Regex compilation**: Patterns are compiled to regex objects for efficient matching
- **Priority ordering**: Routes are processed in priority order (higher priority first)
- **Early termination**: Matching stops at first successful match

### Memory Usage
- **Pattern caching**: Compiled regex patterns are cached
- **Validation caching**: Configuration validation results are cached
- **Transport capabilities**: Capabilities are stored in Map for O(1) lookup

### Scalability
- **Route count**: Supports large numbers of routes efficiently
- **Pattern complexity**: Complex patterns may impact matching performance
- **Origin prefix**: Origin prefix validation adds minimal overhead

## Best Practices

### Pattern Design
1. **Use specific patterns first**: `user.created` before `user.*`
2. **Limit wildcard usage**: Avoid overly broad patterns like `*.*.*`
3. **Consider origin prefixes**: Design patterns with regional isolation in mind

### Configuration Management
1. **Validate early**: Use strict mode in development, warn in production
2. **Monitor warnings**: Address transport capability warnings
3. **Test patterns**: Verify pattern matching behavior with real event types

### Performance Optimization
1. **Route priority**: Order routes by frequency of use
2. **Pattern complexity**: Keep patterns simple and efficient
3. **Transport selection**: Choose transports based on actual capabilities

## Limitations

### Pattern Support
- **No nested wildcards**: `user.*.created.*` is not supported
- **No regex features**: Only basic wildcard patterns supported
- **No lookahead/lookbehind**: Advanced regex features not available

### Origin Prefix
- **Single prefix**: Only one origin prefix per router instance
- **No dynamic prefixes**: Prefix cannot be changed after router creation
- **Limited isolation**: Patterns starting with `*` bypass origin restrictions

### Topic Resolution
- **No dynamic mapping**: Topic mapping is static configuration
- **No fallback chains**: Simple fallback to default strategy only
- **No conditional logic**: Mapping cannot depend on event content
