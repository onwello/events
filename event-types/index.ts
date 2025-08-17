import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';

// ===== ENVELOPE INFRASTRUCTURE =====

export interface EventHeader {
  id: string;
  type: string;
  origin: string;  // Service name (e.g., 'user-service')
  originPrefix?: string;  // Regional/organizational prefix (e.g., 'eu.de', 'us.ca')
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
  body: any,
  originPrefix?: string
): EventHeader {
  return {
    id: generateEventId(),
    type: eventType,
    origin,
    originPrefix,  // Always present, even when undefined
    timestamp: new Date().toISOString(),
    hash: generateEventHash(body),
    version: '1.0.0', // TODO: Make this configurable
  };
}

export function createEventEnvelope<T>(
  eventType: string,
  origin: string,
  body: T,
  originPrefix?: string
): EventEnvelope<T> {
  // originPrefix is optional and represents regional/organizational context
  // For traceability, we have the origin (service name) in the header
  return {
    header: createEventHeader(eventType, origin, body, originPrefix),
    body,
  };
}

// ===== VALIDATION INFRASTRUCTURE =====

export interface EventValidator {
  validate(eventType: string, body: any): ValidationResult;
  getSchema(eventType: string): z.ZodSchema | undefined;
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

  getSchema(eventType: string): z.ZodSchema | undefined {
    return this.schemas[eventType];
  }

  validate(eventType: string, body: any): ValidationResult {
    try {
      const schema = this.getSchema(eventType);
      if (!schema) {
        // If no schema is registered, allow the event to pass validation
        // This is useful for testing and when strict validation is not required
        return { valid: true };
      }
      schema.parse(body);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: (error as Error).message };
    }
  }
}

// Helper function to get the full event type (with origin prefix if present)
export function getFullEventType(envelope: EventEnvelope): string {
  if (envelope.header.originPrefix) {
    return `${envelope.header.originPrefix}.${envelope.header.type}`;
  }
  return envelope.header.type;
}

// Factory function to create an event validator
export function createEventValidator(schemas?: Record<string, z.ZodSchema>): EventValidator {
  return new DefaultEventValidator(schemas);
} 