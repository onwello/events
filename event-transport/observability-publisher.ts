import { RedisStreamsClientProxy, RedisStreamsClientOptions } from './redis-streams.client';
import { EventPublisher, EventPublisherOptions } from '../event-publisher';
import { EventValidator, DefaultEventValidator } from '../event-types';
import { z } from 'zod';

// Observability event schemas
const ObservabilityLogSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  service: z.string(),
  context: z.record(z.string(), z.any()).optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
});

const ObservabilityMetricSchema = z.object({
  metric: z.string(),
  value: z.number(),
  labels: z.record(z.string(), z.string()).optional(),
  service: z.string(),
});

const ObservabilityAuditSchema = z.object({
  actorId: z.string(),
  action: z.string(),
  targetId: z.string().optional(),
  details: z.record(z.string(), z.any()).optional(),
  service: z.string(),
});

const ObservabilitySecuritySchema = z.object({
  eventType: z.string(),
  userId: z.string().optional(),
  actorId: z.string().optional(),
  details: z.record(z.string(), z.any()).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  service: z.string(),
});

export class ObservabilityEventPublisher {
  private publisher: EventPublisher;
  private validator: EventValidator;

  constructor(
    options: RedisStreamsClientOptions, 
    originServiceName: string,
    stream: string = 'observability'
  ) {
    // Create observability-specific validator
    this.validator = new DefaultEventValidator({
      'observability.log': ObservabilityLogSchema,
      'observability.metric': ObservabilityMetricSchema,
      'observability.audit': ObservabilityAuditSchema,
      'observability.security': ObservabilitySecuritySchema,
    });

    // Create Redis Streams client
    const redisClient = new RedisStreamsClientProxy({
      ...options,
      stream,
    });

    // Create publisher with observability validator
    this.publisher = new EventPublisher(
      { redis: redisClient },
      { originServiceName, validator: this.validator }
    );
  }

  async log(event: z.infer<typeof ObservabilityLogSchema>) {
    await this.publisher.publish('observability.log', event);
  }

  async metric(event: z.infer<typeof ObservabilityMetricSchema>) {
    await this.publisher.publish('observability.metric', event);
  }

  async audit(event: z.infer<typeof ObservabilityAuditSchema>) {
    await this.publisher.publish('observability.audit', event);
  }

  async security(event: z.infer<typeof ObservabilitySecuritySchema>) {
    await this.publisher.publish('observability.security', event);
  }

  async close() {
    // Close the underlying publisher if it has a close method
    if (this.publisher && typeof this.publisher.close === 'function') {
      await this.publisher.close();
    }
  }
} 