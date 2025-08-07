import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';

// ===== ENVELOPE INFRASTRUCTURE =====

export interface EventHeader {
  id: string;
  type: string;
  origin: string;
  timestamp: string;
  hash: string; // SHA-256 hash of the body for idempotency
  version: string; // Schema version for future compatibility
}

export interface EventEnvelope<T = any> {
  header: EventHeader;
  body: T;
}

// ===== IDEMPOTENCY UTILITIES =====

export function generateEventId(): string {
  return randomUUID();
}

export function generateEventHash(body: any): string {
  const bodyString = JSON.stringify(body);
  return createHash('sha256').update(bodyString).digest('hex');
}

export function createEventHeader(
  eventType: string, 
  origin: string, 
  body: any
): EventHeader {
  return {
    id: generateEventId(),
    type: eventType,
    origin,
    timestamp: new Date().toISOString(),
    hash: generateEventHash(body),
    version: '1.0.0', // TODO: Make this configurable
  };
}

export function createEventEnvelope<T>(
  eventType: string,
  origin: string,
  body: T,
  namespace?: string
): EventEnvelope<T> {
  // Apply namespace as prefix for ownership, not restriction
  const finalEventType = namespace ? `${namespace}.${eventType}` : eventType;
  
  return {
    header: createEventHeader(finalEventType, origin, body),
    body,
  };
}

// ===== VALIDATION INFRASTRUCTURE =====

export interface EventValidator {
  validate(eventType: string, body: any): ValidationResult;
  getSchema(eventType: string): z.ZodSchema;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export class DefaultEventValidator implements EventValidator {
  private schemas: Record<string, z.ZodSchema>;

  constructor(schemas?: Record<string, z.ZodSchema>) {
    this.schemas = schemas || {};
  }

  registerSchema(eventType: string, schema: z.ZodSchema): void {
    this.schemas[eventType] = schema;
  }

  getSchema(eventType: string): z.ZodSchema {
    const schema = this.schemas[eventType];
    if (!schema) {
      throw new Error(`No schema registered for event type: ${eventType}`);
    }
    return schema;
  }

  validate(eventType: string, body: any): ValidationResult {
    try {
      const schema = this.getSchema(eventType);
      schema.parse(body);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: (error as Error).message };
    }
  }
} 