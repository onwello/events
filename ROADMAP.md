# @logistically/events Library Roadmap

## 🎯 Overview

This roadmap combines critical user requirements with production readiness feedback to guide the evolution of the `@logistically/events` library. Items are prioritized based on production impact, user experience, and technical complexity. The roadmap includes enhanced features based on user feedback and addresses enterprise requirements for multi-tenant platforms, security, and comprehensive monitoring.

## 🚨 Critical Priority (Must Have)

### 1. Enhanced Stream Control & Configuration
**Issue**: Library publishes to unintended streams (e.g., "console" instead of intended stream)
**Impact**: High - affects data organization and consumption patterns

**Requirements**:
- [ ] **Explicit stream naming**: Allow developers to specify exact stream names
- [ ] **Dynamic stream resolution**: Support for payload-based stream naming
- [ ] **Stream validation**: Validate stream names before publishing
- [ ] **Default stream behavior**: Clear defaults that don't interfere with existing streams
- [ ] **Stream isolation**: Prevent accidental cross-contamination between test/prod streams
- [ ] **Security & tenancy controls**: Multi-tenant support with stream isolation
- [ ] **Warning system**: Alert when stream length exceeds 2x maxLength

**Implementation**:
```typescript
interface StreamConfiguration {
  defaultStream?: string;
  streamPrefix?: string;
  streamValidation?: boolean;
  streamNamingStrategy?: 'namespace' | 'explicit' | 'custom' | 'dynamic';
  customStreamResolver?: (eventType: string, payload?: any, metadata?: any) => string;
  streamIsolation?: {
    enabled: boolean;
    environment?: string; // 'dev', 'staging', 'prod'
    namespace?: string;
  };
  security?: {
    allowedStreams?: string[];
    deniedStreams?: string[];
    streamPatterns?: RegExp[];
    multiTenant?: boolean;
    tenantResolver?: (payload?: any, metadata?: any) => string;
  };
  warnings?: {
    streamLengthThreshold?: number; // Warn when stream exceeds 2x maxLength
    trimEffectivenessThreshold?: number; // Warn when trimming is ineffective
    onWarning?: (stream: string, warning: StreamWarning) => void;
  };
}

// Proposed API
const publisher = new EventPublisher({
  redis: transport,
  defaultStream: 'my-events', // Explicit default
  streamPrefix: 'prod', // Optional prefix for isolation
  streamValidation: true, // Validate stream names
  streamNamingStrategy: 'dynamic', // Dynamic resolution
  customStreamResolver: (eventType, payload) => {
    // Resolve stream based on payload type or metadata
    if (payload.tenant) return `${payload.tenant}-events`;
    if (payload.priority === 'high') return 'high-priority-events';
    return 'default-events';
  },
  security: {
    allowedStreams: ['user-events', 'order-events', 'payment-events'],
    multiTenant: true,
    tenantResolver: (payload) => payload.tenant || 'default'
  },
  warnings: {
    streamLengthThreshold: 20000, // Warn when stream exceeds 20k messages
    onWarning: (stream, warning) => {
      console.warn(`Stream ${stream} warning: ${warning.message}`);
    }
  }
});
```

### 2. Enhanced Consumer Group Management
**Issue**: Manual consumer group creation required, no automatic setup
**Impact**: High - affects developer experience and production deployment

**Requirements**:
- [ ] **Auto-create consumer groups**: Configurable automatic group creation
- [ ] **Group naming strategy**: Flexible naming conventions
- [ ] **Group validation**: Ensure groups exist before consumption
- [ ] **CLI tool for group management**: Separate tool for cleanup operations
- [ ] **PEL reprocessing after failover**: Handle unacknowledged messages after failover
- [ ] **Poison queue support**: Configurable max retry + DLQ stream

**Implementation**:
```typescript
interface ConsumerGroupConfig {
  autoCreateGroup?: boolean;
  groupNamingStrategy?: 'service-name' | 'custom' | 'explicit';
  customGroupName?: string;
  groupValidation?: boolean;
  // REMOVED: cleanupUnusedGroups - moved to CLI tool
  resumeUnackedMessages?: true | false | 'only-if-stale';
  staleMessageThreshold?: number; // milliseconds
  poisonQueue?: {
    enabled: boolean;
    maxRetries: number;
    deadLetterStream: string;
    retryDelayMs: number;
  };
}

// NEW: CLI Tool for Group Management
interface GroupManagementCLI {
  cleanupUnusedGroups(stream: string, maxAgeHours: number): Promise<void>;
  listGroups(stream: string): Promise<ConsumerGroupInfo[]>;
  resetGroup(stream: string, group: string, offset: string): Promise<void>;
  reprocessPEL(stream: string, group: string): Promise<void>;
}

// Proposed API
const consumer = new RedisStreamConsumer({
  redis: redis,
  stream: 'my-events',
  group: 'my-consumer-group',
  autoCreateGroup: true, // Auto-create if doesn't exist
  groupNamingStrategy: 'service-name', // or 'custom'
  resumeUnackedMessages: 'only-if-stale', // Handle stale messages after failover
  staleMessageThreshold: 300000, // 5 minutes
  poisonQueue: {
    enabled: true,
    maxRetries: 3,
    deadLetterStream: 'my-events-dlq',
    retryDelayMs: 1000
  }
});

// CLI Tool Usage
const cli = new GroupManagementCLI(redis);
await cli.cleanupUnusedGroups('my-events', 24); // Cleanup groups older than 24 hours
await cli.reprocessPEL('my-events', 'my-consumer-group'); // Reprocess unacknowledged messages
```

### 3. Poison Message Handling & Visibility
**Issue**: No visibility into poison messages (invalid payloads, unacknowledged for too long, etc.)
**Impact**: High - affects debugging and production reliability

**Requirements**:
- [ ] **Poison message tracking**: Comprehensive tracking of failed messages
- [ ] **Configurable max retry**: Set retry limits per event type
- [ ] **Dead letter queue**: Automatic routing of failed messages
- [ ] **Poison message metrics**: Detailed metrics for monitoring
- [ ] **Alerting system**: Notify when poison message thresholds are exceeded

**Implementation**:
```typescript
interface PoisonMessageConfig {
  enabled: boolean;
  maxRetries: number;
  deadLetterStream: string;
  retryDelayMs: number;
  retryBackoff?: 'linear' | 'exponential';
  poisonMessageHandlers?: {
    onPoisonMessage?: (message: PoisonMessage) => void;
    onMaxRetriesExceeded?: (message: PoisonMessage) => void;
  };
}

interface PoisonMessage {
  id: string;
  stream: string;
  group: string;
  eventType: string;
  payload: any;
  error: string;
  retryCount: number;
  firstFailureTime: Date;
  lastFailureTime: Date;
  totalProcessingTime: number;
}

// Poison Message Monitor
class PoisonMessageMonitor {
  private redis: Redis;
  private config: PoisonMessageConfig;
  private poisonMessages: Map<string, PoisonMessage> = new Map();
  
  constructor(redis: Redis, config: PoisonMessageConfig) {
    this.redis = redis;
    this.config = config;
  }
  
  async trackFailedMessage(
    messageId: string, 
    stream: string, 
    group: string, 
    eventType: string, 
    payload: any, 
    error: Error
  ): Promise<void> {
    const existing = this.poisonMessages.get(messageId);
    
    if (existing) {
      existing.retryCount++;
      existing.lastFailureTime = new Date();
      existing.error = error.message;
      existing.totalProcessingTime = Date.now() - existing.firstFailureTime.getTime();
      
      if (existing.retryCount >= this.config.maxRetries) {
        await this.handleMaxRetriesExceeded(existing);
      } else {
        this.config.poisonMessageHandlers?.onPoisonMessage?.(existing);
      }
    } else {
      const poisonMessage: PoisonMessage = {
        id: messageId,
        stream,
        group,
        eventType,
        payload,
        error: error.message,
        retryCount: 1,
        firstFailureTime: new Date(),
        lastFailureTime: new Date(),
        totalProcessingTime: 0
      };
      
      this.poisonMessages.set(messageId, poisonMessage);
      this.config.poisonMessageHandlers?.onPoisonMessage?.(poisonMessage);
    }
  }
  
  getPoisonMessageStats(): {
    totalPoisonMessages: number;
    messagesByEventType: Record<string, number>;
    averageRetryCount: number;
    oldestPoisonMessage: Date | null;
  } {
    const messages = Array.from(this.poisonMessages.values());
    const eventTypeCounts: Record<string, number> = {};
    
    messages.forEach(msg => {
      eventTypeCounts[msg.eventType] = (eventTypeCounts[msg.eventType] || 0) + 1;
    });
    
    return {
      totalPoisonMessages: messages.length,
      messagesByEventType: eventTypeCounts,
      averageRetryCount: messages.length > 0 ? 
        messages.reduce((sum, msg) => sum + msg.retryCount, 0) / messages.length : 0,
      oldestPoisonMessage: messages.length > 0 ? 
        new Date(Math.min(...messages.map(msg => msg.firstFailureTime.getTime()))) : null
    };
  }
}
```

### 4. Configurable Trim Strategy with Warning System
**Issue**: No built-in stream trimming, leading to unbounded memory growth
**Impact**: High - critical for production memory management

**Requirements**:
- [ ] **Automatic trimming**: Configurable MAXLEN strategy
- [ ] **Manual trimming**: XTRIM operations with configurable parameters
- [ ] **Trim events**: Events triggered when trimming occurs
- [ ] **Memory monitoring**: Built-in memory usage tracking
- [ ] **Warning system**: Alert when trimming is ineffective

**Implementation**:
```typescript
interface TrimStrategy {
  enabled: boolean;
  maxLength: number;
  trimPolicy: 'maxlen' | 'minid';
  trimThreshold: number; // 0.0 to 1.0, when to trigger trim
  trimBatchSize: number;
  trimInterval: number; // milliseconds
  trimOnPublish?: boolean; // Trim immediately on publish
  warnings?: {
    ineffectiveTrimThreshold?: number; // Warn when trimming doesn't reduce size significantly
    onIneffectiveTrim?: (stream: string, beforeLength: number, afterLength: number) => void;
  };
}

// Stream Trimmer with Warning System
class StreamTrimmer {
  private redis: Redis;
  private trimConfig: TrimStrategy;
  private trimIntervals: Map<string, NodeJS.Timeout> = new Map();
  private streamLengths: Map<string, number> = new Map();
  
  constructor(redis: Redis, trimConfig: TrimStrategy) {
    this.redis = redis;
    this.trimConfig = trimConfig;
  }
  
  async checkAndTrim(streamName: string): Promise<void> {
    if (!this.trimConfig.enabled) return;
    
    try {
      const streamLength = await this.redis.xlen(streamName);
      this.streamLengths.set(streamName, streamLength);
      
      const threshold = this.trimConfig.maxLength * this.trimConfig.trimThreshold;
      
      if (streamLength > threshold) {
        await this.trimStream(streamName, streamLength);
      }
    } catch (error) {
      console.error(`Error trimming stream ${streamName}:`, error);
    }
  }
  
  private async trimStream(streamName: string, currentLength: number): Promise<void> {
    const targetLength = this.trimConfig.maxLength;
    const trimAmount = currentLength - targetLength;
    
    if (trimAmount <= 0) return;
    
    try {
      const trimPolicy = this.trimConfig.trimPolicy === 'minid' ? 'MINID' : 'MAXLEN';
      const trimValue = this.trimConfig.trimPolicy === 'minid' ? 
        `~ ${targetLength}` : targetLength;
      
      await this.redis.xtrim(streamName, trimPolicy, trimValue);
      
      // Check if trimming was effective
      const newLength = await this.redis.xlen(streamName);
      const reduction = currentLength - newLength;
      const effectiveness = reduction / trimAmount;
      
      if (effectiveness < (this.trimConfig.warnings?.ineffectiveTrimThreshold || 0.5)) {
        this.trimConfig.warnings?.onIneffectiveTrim?.(streamName, currentLength, newLength);
      }
      
      // Emit trim event if configured
      this.emitTrimEvent(streamName, {
        originalLength: currentLength,
        targetLength,
        trimmedAmount: trimAmount,
        effectiveness,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`Failed to trim stream ${streamName}:`, error);
    }
  }
}

// Proposed API
const publisher = new EventPublisher({
  redis: transport,
  trimStrategy: {
    enabled: true,
    maxLength: 10000, // MAXLEN ~ 10000
    trimPolicy: 'minid', // or 'maxlen'
    trimThreshold: 0.8, // Trim when 80% full
    trimBatchSize: 1000, // Trim in batches
    trimOnPublish: true, // Trim immediately on publish
    warnings: {
      ineffectiveTrimThreshold: 0.5, // Warn when trimming reduces size by less than 50%
      onIneffectiveTrim: (stream, before, after) => {
        console.warn(`Ineffective trimming on ${stream}: ${before} -> ${after}`);
      }
    }
  }
});
```

## 🔥 High Priority (Production Critical)

### 5. Enhanced Redis Failover & Cluster Support
**Issue**: No testing with Redis Sentinel or Cluster, no PEL reprocessing after failover
**Impact**: High - critical for production high availability

**Requirements**:
- [ ] **Sentinel support**: Automatic failover handling
- [ ] **Cluster support**: Multi-shard Redis cluster
- [ ] **Failover recovery**: Message loss/duplication handling
- [ ] **Connection resilience**: Automatic reconnection strategies
- [ ] **PEL reprocessing**: Handle unacknowledged messages after failover

**Implementation**:
```typescript
interface RedisClusterConfig {
  sentinels?: Array<{ host: string; port: number }>;
  sentinelName?: string;
  clusterNodes?: Array<{ host: string; port: number }>;
  failoverStrategy: 'retry' | 'failfast' | 'round-robin';
  maxRetries: number;
  retryDelay: number;
  connectionTimeout: number;
  commandTimeout: number;
  failoverRecovery?: {
    enabled: boolean;
    resumeUnackedMessages: true | false | 'only-if-stale';
    staleMessageThreshold: number; // milliseconds
    recoveryTimeout: number; // milliseconds
  };
}

// Enhanced Redis Client with Failover Recovery
export class RedisStreamsClientProxy extends ClientProxy {
  private async handleFailoverRecovery(): Promise<void> {
    if (!this.clusterConfig?.failoverRecovery?.enabled) return;
    
    const recovery = this.clusterConfig.failoverRecovery;
    
    try {
      // Check for unacknowledged messages in all known streams
      const streams = await this.getKnownStreams();
      
      for (const stream of streams) {
        const groups = await this.getConsumerGroups(stream);
        
        for (const group of groups) {
          await this.recoverUnackedMessages(stream, group, recovery);
        }
      }
    } catch (error) {
      console.error('Error during failover recovery:', error);
    }
  }
  
  private async recoverUnackedMessages(
    stream: string, 
    group: string, 
    recovery: NonNullable<RedisClusterConfig['failoverRecovery']>
  ): Promise<void> {
    try {
      const pending = await this.client.xpending(stream, group);
      const pendingCount = pending[0];
      
      if (pendingCount === 0) return;
      
      console.log(`[FailoverRecovery] Found ${pendingCount} unacknowledged messages in ${stream}:${group}`);
      
      if (recovery.resumeUnackedMessages === 'only-if-stale') {
        const staleMessages = await this.getStaleMessages(stream, group, recovery.staleMessageThreshold);
        if (staleMessages.length > 0) {
          console.log(`[FailoverRecovery] Reprocessing ${staleMessages.length} stale messages`);
          await this.reprocessMessages(stream, group, staleMessages);
        }
      } else if (recovery.resumeUnackedMessages === true) {
        console.log(`[FailoverRecovery] Reprocessing all ${pendingCount} unacknowledged messages`);
        await this.reprocessAllMessages(stream, group);
      }
    } catch (error) {
      console.error(`Error recovering unacknowledged messages for ${stream}:${group}:`, error);
    }
  }
}

// Proposed API
const transport = new RedisTransport({
  sentinels: [
    { host: 'sentinel1', port: 26379 },
    { host: 'sentinel2', port: 26379 }
  ],
  name: 'mymaster',
  failoverStrategy: 'retry', // or 'failfast'
  maxRetries: 3,
  failoverRecovery: {
    enabled: true,
    resumeUnackedMessages: 'only-if-stale',
    staleMessageThreshold: 300000, // 5 minutes
    recoveryTimeout: 60000 // 1 minute
  }
});
```

### 6. Enhanced Backpressure & Slow Consumer Handling
**Issue**: No handling of consumer lag or backpressure, limited poison message visibility
**Impact**: High - affects system stability under load

**Requirements**:
- [ ] **Backpressure detection**: Monitor pending list size
- [ ] **Slow consumer alerts**: Notify when consumers lag behind
- [ ] **Graceful degradation**: Handle consumer failures
- [ ] **Recovery strategies**: Automatic recovery mechanisms
- [ ] **Poison message integration**: Enhanced monitoring with poison messages

**Implementation**:
```typescript
interface BackpressureConfig {
  backpressureThreshold: number; // Alert when PEL > threshold
  slowConsumerThreshold: number; // Alert when lag > threshold (ms)
  recoveryStrategy: 'exponential-backoff' | 'linear-backoff' | 'immediate';
  maxRetries: number;
  monitoring?: {
    enabled: boolean;
    metricsInterval: number; // milliseconds
    alertCallbacks?: {
      onBackpressure?: (stream: string, group: string, pendingCount: number) => void;
      onSlowConsumer?: (stream: string, group: string, lag: number) => void;
      onPoisonMessage?: (message: PoisonMessage) => void;
    };
  };
  poisonMessageConfig?: PoisonMessageConfig;
}

// Enhanced Backpressure Monitor
class EnhancedBackpressureMonitor {
  private redis: Redis;
  private config: BackpressureConfig;
  private poisonMonitor?: PoisonMessageMonitor;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(redis: Redis, config: BackpressureConfig) {
    this.redis = redis;
    this.config = config;
    
    if (config.poisonMessageConfig) {
      this.poisonMonitor = new PoisonMessageMonitor(redis, config.poisonMessageConfig);
    }
  }
  
  async startEnhancedMonitoring(stream: string, group: string): Promise<void> {
    const interval = setInterval(async () => {
      await this.checkBackpressure(stream, group);
      await this.checkPoisonMessages(stream, group);
    }, this.config.monitoring?.metricsInterval || 5000);
    
    this.monitoringIntervals.set(`${stream}:${group}`, interval);
  }
  
  private async checkPoisonMessages(stream: string, group: string): Promise<void> {
    if (!this.poisonMonitor) return;
    
    try {
      const stats = this.poisonMonitor.getPoisonMessageStats();
      
      if (stats.totalPoisonMessages > 0) {
        console.warn(`[BackpressureMonitor] Found ${stats.totalPoisonMessages} poison messages in ${stream}:${group}`);
        
        // Alert on poison messages
        this.config.monitoring?.alertCallbacks?.onPoisonMessage?.({
          id: 'summary',
          stream,
          group,
          eventType: 'poison_summary',
          payload: stats,
          error: 'Multiple poison messages detected',
          retryCount: 0,
          firstFailureTime: stats.oldestPoisonMessage || new Date(),
          lastFailureTime: new Date(),
          totalProcessingTime: 0
        });
      }
    } catch (error) {
      console.error(`Error checking poison messages for ${stream}:${group}:`, error);
    }
  }
}

// Proposed API
const consumer = new RedisStreamConsumer({
  redis: redis,
  backpressureThreshold: 1000, // Alert when PEL > 1000
  slowConsumerThreshold: 5000, // Alert when lag > 5000ms
  recoveryStrategy: 'exponential-backoff',
  maxRetries: 5,
  monitoring: {
    enabled: true,
    metricsInterval: 5000,
    alertCallbacks: {
      onBackpressure: (stream, group, pendingCount) => {
        console.warn(`Backpressure detected: ${stream}:${group} has ${pendingCount} pending messages`);
      },
      onSlowConsumer: (stream, group, lag) => {
        console.warn(`Slow consumer detected: ${stream}:${group} lagging by ${lag}ms`);
      },
      onPoisonMessage: (message) => {
        console.error(`Poison message detected: ${message.eventType} in ${message.stream}:${message.group}`);
      }
    }
  },
  poisonMessageConfig: {
    enabled: true,
    maxRetries: 3,
    deadLetterStream: 'poison-messages-dlq',
    retryDelayMs: 1000
  }
});
```

## 🔶 Medium Priority (Important Features)

### 7. Replay & Time Travel CLI
**Issue**: No support for targeted message replay scenarios
**Impact**: Medium - affects debugging and replay capabilities

**Requirements**:
- [ ] **Replay CLI tool**: Command-line tool for replay operations
- [ ] **Time travel functionality**: Replay from specific timestamps
- [ ] **Readonly mode**: Prevent accidental replays back into production
- [ ] **Stream isolation**: Separate replay streams from production
- [ ] **Replay cleanup**: Automatic cleanup of replay streams

**Implementation**:
```typescript
interface ReplayConfiguration {
  enabled: boolean;
  mode: 'readonly' | 'readwrite';
  postfix?: string;
  timestamp?: string; // ISO timestamp for time travel
  streamOffset?: string; // Redis stream offset
  maxEvents?: number; // Limit number of events to replay
  filters?: {
    eventTypes?: string[];
    timeRange?: { start: string; end: string };
    payloadFilters?: Record<string, any>;
  };
  cleanup?: {
    enabled: boolean;
    autoCleanup: boolean;
    cleanupAfterHours: number;
  };
}

// Replay & Time Travel CLI
class ReplayCLI {
  private redis: Redis;
  
  constructor(redis: Redis) {
    this.redis = redis;
  }
  
  async replayFromTimestamp(
    sourceStream: string,
    targetStream: string,
    timestamp: string,
    options: ReplayOptions = {}
  ): Promise<ReplayResult> {
    const startTime = new Date(timestamp).getTime();
    const offset = `${startTime}-0`;
    
    return this.replayFromOffset(sourceStream, targetStream, offset, options);
  }
  
  async replayFromOffset(
    sourceStream: string,
    targetStream: string,
    offset: string,
    options: ReplayOptions = {}
  ): Promise<ReplayResult> {
    const result: ReplayResult = {
      eventsProcessed: 0,
      eventsReplayed: 0,
      errors: [],
      duration: 0
    };
    
    const startTime = Date.now();
    
    try {
      const messages = await this.redis.xread(
        'STREAMS', sourceStream, offset,
        'COUNT', options.batchSize || 100
      );
      
      if (!messages || messages.length === 0) {
        return result;
      }
      
      const [stream, streamMessages] = messages[0];
      
      for (const [id, fields] of streamMessages) {
        try {
          // Apply filters
          if (options.filters && !this.matchesFilters(fields, options.filters)) {
            continue;
          }
          
          // Replay to target stream
          await this.redis.xadd(targetStream, '*', 'data', fields.data);
          result.eventsReplayed++;
        } catch (error) {
          result.errors.push({
            messageId: id,
            error: (error as Error).message
          });
        }
        
        result.eventsProcessed++;
        
        // Check limits
        if (options.maxEvents && result.eventsReplayed >= options.maxEvents) {
          break;
        }
      }
    } catch (error) {
      result.errors.push({
        messageId: 'unknown',
        error: (error as Error).message
      });
    }
    
    result.duration = Date.now() - startTime;
    return result;
  }
}

// CLI Usage Examples
const cli = new ReplayCLI(redis);

// Replay from timestamp
await cli.replayFromTimestamp(
  'user-events',
  'user-events-replay',
  '2024-01-15T10:00:00Z',
  { maxEvents: 1000, batchSize: 100 }
);

// Replay from offset
await cli.replayFromOffset(
  'user-events',
  'user-events-replay',
  '1705312800000-0',
  { 
    filters: { 
      eventTypes: ['user.created', 'user.updated'] 
    } 
  }
);
```

### 8. Schema Flexibility with Middleware Support
**Issue**: Library enforces Zod schema, limiting flexibility
**Impact**: Medium - affects developer choice and adoption

**Requirements**:
- [ ] **Optional validation**: Make Zod schema optional
- [ ] **Custom validators**: Support for custom validation functions
- [ ] **Middleware system**: Extensible architecture for idempotency and other features
- [ ] **Pluggable transports**: Future-proof architecture for Kafka/AMQP support
- [ ] **Idempotency support**: Event deduplication as middleware

**Implementation**:
```typescript
// Middleware System
interface EventMiddleware {
  name: string;
  priority: number; // Lower numbers execute first
  process?: (event: EventEnvelope, context: MiddlewareContext) => Promise<EventEnvelope>;
  validate?: (event: EventEnvelope, context: MiddlewareContext) => Promise<ValidationResult>;
}

interface MiddlewareContext {
  eventType: string;
  stream: string;
  metadata?: Record<string, any>;
}

// Enhanced Event Processor with Middleware
class EventProcessor {
  private middlewares: EventMiddleware[] = [];
  
  addMiddleware(middleware: EventMiddleware): void {
    this.middlewares.push(middleware);
    this.middlewares.sort((a, b) => a.priority - b.priority);
  }
  
  async processEvent(event: EventEnvelope, context: MiddlewareContext): Promise<EventEnvelope> {
    let processedEvent = event;
    
    for (const middleware of this.middlewares) {
      if (middleware.process) {
        processedEvent = await middleware.process(processedEvent, context);
      }
    }
    
    return processedEvent;
  }
  
  async validateEvent(event: EventEnvelope, context: MiddlewareContext): Promise<ValidationResult> {
    for (const middleware of this.middlewares) {
      if (middleware.validate) {
        const result = await middleware.validate(event, context);
        if (!result.valid) {
          return result;
        }
      }
    }
    
    return { valid: true };
  }
}

// Idempotency Middleware
class IdempotencyMiddleware implements EventMiddleware {
  name = 'idempotency';
  priority = 100; // High priority
  
  constructor(private redis: Redis, private ttlSeconds: number = 3600) {}
  
  async process(event: EventEnvelope, context: MiddlewareContext): Promise<EventEnvelope> {
    const key = `idempotency:${context.eventType}:${event.header.hash}`;
    
    // Check if already processed
    const exists = await this.redis.exists(key);
    if (exists) {
      throw new Error(`Event already processed: ${event.header.hash}`);
    }
    
    // Mark as processed
    await this.redis.setex(key, this.ttlSeconds, JSON.stringify({
      processedAt: new Date().toISOString(),
      eventId: event.header.id
    }));
    
    return event;
  }
}

// Pluggable Transport System
interface Transport {
  name: string;
  publish(event: EventEnvelope, options?: any): Promise<void>;
  subscribe(stream: string, handler: EventHandler): Promise<void>;
  close(): Promise<void>;
}

// Proposed API
const publisher = new EventPublisher({
  redis: transport,
  validation: {
    enabled: true, // Optional validation
    schema: zodSchema, // Optional Zod schema
    customValidator: (event) => boolean, // Custom validation
    strictMode: false // Allow unknown fields
  },
  middleware: {
    enabled: true,
    middlewares: [
      new IdempotencyMiddleware(redis, 3600),
      new CustomValidationMiddleware(),
      new LoggingMiddleware()
    ]
  }
});

// Add middleware dynamically
publisher.addMiddleware(new IdempotencyMiddleware(redis));
publisher.addMiddleware(new CustomValidationMiddleware());
```

### 9. Phased Metrics & Monitoring
**Issue**: Limited metrics for production monitoring
**Impact**: Medium - affects production observability

**Requirements**:
- [ ] **Phase 1: Basic Metrics** (Week 1-2): Core publish/consume metrics, health checks
- [ ] **Phase 2: Enhanced Metrics** (Week 3-4): Stream-level metrics, basic alerting
- [ ] **Phase 3: Advanced Metrics** (Week 5-6): Poison message tracking, Prometheus integration

**Implementation**:

#### **Phase 1: Basic Metrics (Week 1-2)**
```typescript
// Basic metrics interface - minimal but useful
interface BasicEventMetrics {
  publishedEvents: number;
  failedEvents: number;
  consumedEvents: number;
  failedConsumption: number;
  publishLatency: {
    min: number;
    max: number;
    average: number;
  };
  consumeLatency: {
    min: number;
    max: number;
    average: number;
  };
}

// Simple metrics collector - no external dependencies
class BasicMetricsCollector {
  private publishedEvents = 0;
  private failedEvents = 0;
  private consumedEvents = 0;
  private failedConsumption = 0;
  private publishLatencies: number[] = [];
  private consumeLatencies: number[] = [];
  
  recordPublish(latencyMs: number, success: boolean): void {
    if (success) {
      this.publishedEvents++;
      this.publishLatencies.push(latencyMs);
    } else {
      this.failedEvents++;
    }
  }
  
  recordConsume(latencyMs: number, success: boolean): void {
    if (success) {
      this.consumedEvents++;
      this.consumeLatencies.push(latencyMs);
    } else {
      this.failedConsumption++;
    }
  }
  
  getMetrics(): BasicEventMetrics {
    return {
      publishedEvents: this.publishedEvents,
      failedEvents: this.failedEvents,
      consumedEvents: this.consumedEvents,
      failedConsumption: this.failedConsumption,
      publishLatency: this.calculateLatencyStats(this.publishLatencies),
      consumeLatency: this.calculateLatencyStats(this.consumeLatencies)
    };
  }
}

// Basic health check interface
interface BasicHealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  redis: 'connected' | 'disconnected';
  publisher: {
    queueCount: number;
    failedMessages: number;
  };
  consumer: {
    isConnected: boolean;
    pendingMessages: number;
  };
  timestamp: string;
}

// Integration into existing classes
export class EventPublisher implements EventPublisherInterface {
  private metricsCollector: BasicMetricsCollector;
  private healthChecker: BasicHealthChecker;
  
  constructor(
    private transports: Record<string, ClientProxy>,
    private options: EventPublisherOptions,
    private routingConfig: typeof eventRoutingConfig = eventRoutingConfig
  ) {
    // ... existing initialization ...
    
    this.metricsCollector = new BasicMetricsCollector();
    this.healthChecker = new BasicHealthChecker(
      (this.transports.redis as any)?.client,
      undefined,
      undefined
    );
  }
  
  async publish<T>(eventType: string, body: T): Promise<void> {
    const startTime = Date.now();
    
    try {
      // ... existing validation and publishing logic ...
      
      const latency = Date.now() - startTime;
      this.metricsCollector.recordPublish(latency, true);
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metricsCollector.recordPublish(latency, false);
      throw error;
    }
  }
  
  // NEW: Basic metrics and health methods
  getMetrics(): BasicEventMetrics {
    return this.metricsCollector.getMetrics();
  }
  
  async getHealth(): Promise<BasicHealthCheck> {
    return this.healthChecker.checkHealth();
  }
}
```

#### **Phase 2: Enhanced Metrics (Week 3-4)**
```typescript
// Enhanced metrics with stream-level tracking
interface StreamMetrics {
  streamName: string;
  messageCount: number;
  consumerGroups: number;
  averageLatency: number;
  errorRate: number;
  lastMessageTime: string;
}

interface EnhancedEventMetrics extends BasicEventMetrics {
  streams: Record<string, StreamMetrics>;
  memoryUsage: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  uptime: number;
}

// Basic alerting system
interface AlertConfig {
  errorRateThreshold: number; // 0.1 = 10%
  latencyThreshold: number; // milliseconds
  memoryThreshold: number; // MB
  alertCallbacks?: {
    onHighErrorRate?: (stream: string, errorRate: number) => void;
    onHighLatency?: (stream: string, latency: number) => void;
    onHighMemoryUsage?: (usage: number) => void;
  };
}
```

#### **Phase 3: Advanced Metrics (Week 5-6)**
```typescript
// Poison message metrics (building on previous poison message work)
interface PoisonMessageMetrics {
  totalPoisonMessages: number;
  messagesByEventType: Record<string, number>;
  messagesByErrorType: Record<string, number>;
  averageRetryCount: number;
  oldestPoisonMessage: Date | null;
  recentPoisonMessages: PoisonMessage[];
}

// Optional Prometheus integration
interface PrometheusConfig {
  enabled: boolean;
  port?: number;
  path?: string;
}

class PrometheusMetricsExporter {
  generatePrometheusMetrics(): string {
    const metrics = this.getMetrics();
    const poisonMetrics = this.getPoisonMetrics();
    
    let prometheusOutput = '';
    
    // Basic metrics
    prometheusOutput += `# HELP events_published_total Total number of published events\n`;
    prometheusOutput += `# TYPE events_published_total counter\n`;
    prometheusOutput += `events_published_total ${metrics.publishedEvents}\n\n`;
    
    // Stream metrics
    for (const [streamName, streamMetrics] of Object.entries(metrics.streams)) {
      prometheusOutput += `# HELP stream_messages_total Total messages per stream\n`;
      prometheusOutput += `# TYPE stream_messages_total counter\n`;
      prometheusOutput += `stream_messages_total{stream="${streamName}"} ${streamMetrics.messageCount}\n`;
    }
    
    return prometheusOutput;
  }
}
```

## 🔵 Low Priority (Nice to Have)

### 10. Advanced Event Loop Monitoring
**Issue**: No correlation of latency spikes with system events
**Impact**: Low - affects debugging but not core functionality

**Requirements**:
- [ ] **Event loop monitoring**: Track Node.js event loop delays
- [ ] **Latency correlation**: Correlate spikes with system events
- [ ] **Performance profiling**: Built-in performance analysis
- [ ] **Debugging tools**: Enhanced debugging capabilities

### 11. Extended Load Testing Framework
**Issue**: Limited long-running tests
**Impact**: Low - affects confidence but not core functionality

**Requirements**:
- [ ] **24+ hour tests**: Long-running stability tests
- [ ] **Memory leak detection**: Automatic leak detection
- [ ] **Stress testing**: Built-in stress test scenarios
- [ ] **Performance regression**: Automated regression detection

## 📊 Implementation Timeline

### **Phase 1 (Critical - 3-5 weeks)**
1. **Enhanced Stream Control & Configuration** - Week 1-2
   - Dynamic stream resolution
   - Security/tenancy controls
   - Warning system for ineffective trimming
2. **Enhanced Consumer Group Management** - Week 2-3
   - Remove runtime auto-cleanup
   - Add CLI tool for group management
   - PEL reprocessing after failover
3. **Poison Message Handling** - Week 3-4
   - Visibility into poison messages
   - Configurable max retry + DLQ stream
   - Poison message monitoring
4. **Enhanced Trim Strategy** - Week 4-5
   - Warning system for ineffective trimming
   - Memory monitoring improvements

### **Phase 2 (High Priority - 5-7 weeks)**
5. **Enhanced Redis Failover & Cluster Support** - Week 6-7
   - PEL reprocessing after failover
   - Enhanced failover recovery
6. **Enhanced Backpressure & Slow Consumer Handling** - Week 7-8
   - Poison message integration
   - Enhanced monitoring

### **Phase 3 (Medium Priority - 7-10 weeks)**
7. **Replay & Time Travel CLI** - Week 9-10
   - CLI tool for replay operations
   - Time travel functionality
   - Readonly mode support
8. **Schema Flexibility with Middleware** - Week 10-11
   - Idempotency middleware
   - Pluggable transport system
9. **Phased Metrics & Monitoring** - Week 11-12
   - Phase 1: Basic metrics (Week 1-2)
   - Phase 2: Enhanced metrics (Week 3-4)
   - Phase 3: Advanced metrics (Week 5-6)

### **Phase 4 (Low Priority - 10-14 weeks)**
10. **Advanced Event Loop Monitoring** - Week 13-14
11. **Extended Load Testing Framework** - Week 14-15

## 🎯 Success Criteria

### **Phase 1 Success**
- [ ] All publishing goes to intended streams with dynamic resolution
- [ ] Consumer groups auto-create when needed, cleanup via CLI only
- [ ] Poison messages are visible and configurable
- [ ] Streams are automatically trimmed with warning system
- [ ] Security/tenancy controls are in place
- [ ] Basic metrics and health checks are available

### **Phase 2 Success**
- [ ] Library works seamlessly with Redis Sentinel/Cluster
- [ ] PEL reprocessing works after failover
- [ ] System gracefully handles consumer lag and backpressure
- [ ] Poison message handling is comprehensive
- [ ] Enhanced metrics provide stream-level visibility

### **Phase 3 Success**
- [ ] Replay & Time Travel CLI is functional
- [ ] Middleware system supports idempotency
- [ ] Pluggable transport system is extensible
- [ ] Advanced metrics include poison message tracking
- [ ] Prometheus integration works (optional)

### **Phase 4 Success**
- [ ] Advanced debugging and monitoring capabilities
- [ ] Long-running stability is validated
- [ ] Performance regression detection is automated

## 🔧 Technical Considerations

### **Breaking Changes**
- **Stream naming**: May require migration for existing users
- **Schema validation**: Optional validation may affect existing code
- **Consumer group naming**: Auto-creation may conflict with existing groups
- **Metrics integration**: All metrics are opt-in with zero breaking changes

### **Migration Strategy**
- **Backward compatibility**: Maintain existing APIs where possible
- **Deprecation warnings**: Clear migration path for breaking changes
- **Documentation updates**: Comprehensive migration guides
- **Gradual adoption**: All new features are opt-in

### **Testing Strategy**
- **Unit tests**: Comprehensive test coverage for new features
- **Integration tests**: Redis cluster/sentinel testing
- **Performance tests**: Validate no performance regression
- **Migration tests**: Ensure smooth upgrades
- **Load tests**: Long-running stability validation

### **Security Considerations**
- **Multi-tenant isolation**: Stream-level tenant isolation
- **Access controls**: Stream allowlist/denylist
- **Audit logging**: Comprehensive audit trails
- **Encryption**: Support for encrypted streams

### **Performance Considerations**
- **Metrics overhead**: Minimal impact from metrics collection
- **Memory management**: Automatic cleanup of old data
- **Stream trimming**: Configurable to prevent memory growth
- **Connection pooling**: Efficient Redis connection management

---

*This roadmap prioritizes user requirements and production readiness feedback to guide the evolution of the @logistically/events library. The phased approach ensures immediate value while building toward comprehensive enterprise features.*
