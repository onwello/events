import { describe, it, expect } from '@jest/globals';
import { createEventEnvelope, EventEnvelope } from './event-types';
import { z } from 'zod';

// Test schemas
const userCreatedSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.string()
});

describe('Envelope Pattern Validation', () => {
  // Test data
  const testUser = {
    userId: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    createdAt: new Date().toISOString()
  };

  it('should create proper EventEnvelope structure', () => {
    const envelope = createEventEnvelope(
      'user.created',
      'test-service',
      testUser,
      'test-namespace'
    );

    // Validate envelope structure
    expect(envelope).toBeDefined();
    expect(envelope.header).toBeDefined();
    expect(envelope.body).toBeDefined();

    // Validate header structure
    expect(envelope.header.id).toBeDefined();
    expect(envelope.header.type).toBe('user.created');
    expect(envelope.header.origin).toBe('test-service');
    expect(envelope.header.timestamp).toBeDefined();
    expect(envelope.header.hash).toBeDefined();
    expect(envelope.header.version).toBeDefined();

    // Validate body structure
    expect(envelope.body).toEqual(testUser);
  });

  it('should maintain envelope integrity across different event types', () => {
    const eventTypes = ['user.created', 'order.placed', 'debug.log'];
    const testData = [
      testUser,
      { orderId: 'order-123', total: 100 },
      { level: 'info', message: 'test' }
    ];

    const envelopes: EventEnvelope[] = [];

    for (let i = 0; i < eventTypes.length; i++) {
      const envelope = createEventEnvelope(
        eventTypes[i],
        'test-service',
        testData[i],
        'test-namespace'
      );
      envelopes.push(envelope);
    }

    // Validate all envelopes
    expect(envelopes).toHaveLength(3);
    
    for (let i = 0; i < eventTypes.length; i++) {
      const envelope = envelopes[i];
      const expectedData = testData[i];
      
      expect(envelope.header.type).toBe(eventTypes[i]);
      expect(envelope.body).toEqual(expectedData);
      expect(envelope.header.origin).toBe('test-service');
    }
  });

  it('should generate unique IDs for different envelopes', () => {
    const envelope1 = createEventEnvelope('user.created', 'service1', testUser, 'ns1');
    const envelope2 = createEventEnvelope('user.created', 'service1', testUser, 'ns1');
    
    expect(envelope1.header.id).not.toBe(envelope2.header.id);
  });

  it('should include proper metadata in envelope header', () => {
    const envelope = createEventEnvelope(
      'user.created',
      'test-service',
      testUser,
      'test-namespace'
    );

    expect(envelope.header.version).toBe('1.0.0');
    expect(envelope.header.origin).toBe('test-service');
    expect(envelope.header.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(envelope.header.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should validate event data against schemas', () => {
    // Valid data should pass
    const validEnvelope = createEventEnvelope(
      'user.created',
      'test-service',
      testUser,
      'test-namespace'
    );

    const validationResult = userCreatedSchema.safeParse(validEnvelope.body);
    expect(validationResult.success).toBe(true);

    // Invalid data should fail
    const invalidUser = { ...testUser, email: 'invalid-email' };
    const invalidEnvelope = createEventEnvelope(
      'user.created',
      'test-service',
      invalidUser,
      'test-namespace'
    );

    const invalidValidationResult = userCreatedSchema.safeParse(invalidEnvelope.body);
    expect(invalidValidationResult.success).toBe(false);
  });

  it('should handle different data types in envelope body', () => {
    // String data
    const stringEnvelope = createEventEnvelope(
      'message.sent',
      'test-service',
      'Hello World',
      'test-namespace'
    );
    expect(typeof stringEnvelope.body).toBe('string');
    expect(stringEnvelope.body).toBe('Hello World');

    // Number data
    const numberEnvelope = createEventEnvelope(
      'metric.recorded',
      'test-service',
      42,
      'test-namespace'
    );
    expect(typeof numberEnvelope.body).toBe('number');
    expect(numberEnvelope.body).toBe(42);

    // Array data
    const arrayEnvelope = createEventEnvelope(
      'batch.processed',
      'test-service',
      [1, 2, 3, 4, 5],
      'test-namespace'
    );
    expect(Array.isArray(arrayEnvelope.body)).toBe(true);
    expect(arrayEnvelope.body).toEqual([1, 2, 3, 4, 5]);

    // Null data
    const nullEnvelope = createEventEnvelope(
      'event.cleared',
      'test-service',
      null,
      'test-namespace'
    );
    expect(nullEnvelope.body).toBeNull();
  });

  it('should maintain envelope structure with complex nested objects', () => {
    const complexData = {
      user: {
        id: 'user-123',
        profile: {
          name: 'John Doe',
          preferences: {
            theme: 'dark',
            notifications: {
              email: true,
              push: false,
              sms: true
            }
          }
        }
      },
      metadata: {
        source: 'web-app',
        timestamp: new Date().toISOString(),
        version: '2.1.0'
      }
    };

    const envelope = createEventEnvelope(
      'user.profile.updated',
      'test-service',
      complexData,
      'test-namespace'
    );

    expect(envelope.body.user.profile.preferences.notifications.email).toBe(true);
    expect(envelope.body.metadata.source).toBe('web-app');
    expect(envelope.body.user.profile.name).toBe('John Doe');
  });

  it('should allow users to include namespace in event type if desired', () => {
    // User can choose to include namespace in the event type
    const envelopeWithNamespace = createEventEnvelope(
      'com.example.user.created',
      'test-service',
      { userId: '123' },
      'test-namespace'
    );

    // Event type is exactly what was provided
    expect(envelopeWithNamespace.header.type).toBe('com.example.user.created');
    expect(envelopeWithNamespace.header.origin).toBe('test-service');

    // User can also use simple event types
    const envelopeSimple = createEventEnvelope(
      'user.created',
      'test-service',
      { userId: '123' },
      'test-namespace'
    );

    expect(envelopeSimple.header.type).toBe('user.created');
    expect(envelopeSimple.header.origin).toBe('test-service');
  });
});
