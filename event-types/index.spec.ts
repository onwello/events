// Jest test file: uses Jest globals (describe, it, expect)
import * as EventTypes from './index';
import { z } from 'zod';

describe('event-types', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.clearAllMocks();
  });

  it('should export envelope infrastructure', () => {
    // Check that envelope infrastructure is exported
    expect(typeof EventTypes.createEventEnvelope).toBe('function');
    expect(typeof EventTypes.createEventHeader).toBe('function');
    expect(typeof EventTypes.generateEventId).toBe('function');
    expect(typeof EventTypes.generateEventHash).toBe('function');
  });

  it('should export validation infrastructure', () => {
    // Check that validation infrastructure is exported
    expect(typeof EventTypes.DefaultEventValidator).toBe('function');
    expect(typeof EventTypes.createEventValidator).toBe('function');
    expect(typeof EventTypes.getFullEventType).toBe('function');
  });

  it('should create valid event headers', () => {
    const body = { userId: '123', changes: { email: 'test@example.com' } };
    const header = EventTypes.createEventHeader('user.updated', 'test-service', body);
    
    expect(header.id).toBeDefined();
    expect(header.type).toBe('user.updated');
    expect(header.origin).toBe('test-service');
    expect(header.timestamp).toBeDefined();
    expect(header.hash).toBeDefined();
    expect(header.version).toBe('1.0.0');
  });

  it('should create valid event envelopes', () => {
    const body = { userId: '123', changes: { email: 'test@example.com' } };
    const envelope = EventTypes.createEventEnvelope('user.updated', 'test-service', body);
    
    expect(envelope.header).toBeDefined();
    expect(envelope.body).toBe(body);
    expect(envelope.header.type).toBe('user.updated');
  });

  it('should create envelopes without namespace prefixing', () => {
    const body = { userId: '123' };
    const envelope = EventTypes.createEventEnvelope('updated', 'user-service', body, 'user');
    
    // The eventType should remain as provided, namespace is not prepended
    expect(envelope.header.type).toBe('updated');
    
    // Users can include namespace in their eventType if desired
    const envelopeWithNamespace = EventTypes.createEventEnvelope('user.updated', 'user-service', body);
    expect(envelopeWithNamespace.header.type).toBe('user.updated');
  });

  it('should create event headers with originPrefix', () => {
    const body = { userId: '123' };
    const header = EventTypes.createEventHeader('user.created', 'user-service', body, 'us-east');
    
    expect(header.originPrefix).toBe('us-east');
    expect(header.type).toBe('user.created');
    expect(header.origin).toBe('user-service');
  });

  it('should create event headers without originPrefix', () => {
    const body = { userId: '123' };
    const header = EventTypes.createEventHeader('user.created', 'user-service', body);
    
    expect(header.originPrefix).toBeUndefined();
    expect(header.type).toBe('user.created');
    expect(header.origin).toBe('user-service');
  });

  it('should generate unique event IDs', () => {
    const id1 = EventTypes.generateEventId();
    const id2 = EventTypes.generateEventId();
    
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
  });

  it('should generate consistent hashes for same content', () => {
    const body = { userId: '123', action: 'login' };
    const hash1 = EventTypes.generateEventHash(body);
    const hash2 = EventTypes.generateEventHash(body);
    
    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('string');
    expect(hash1.length).toBe(64); // SHA-256 hex length
  });

  it('should generate different hashes for different content', () => {
    const body1 = { userId: '123', action: 'login' };
    const body2 = { userId: '123', action: 'logout' };
    
    const hash1 = EventTypes.generateEventHash(body1);
    const hash2 = EventTypes.generateEventHash(body2);
    
    expect(hash1).not.toBe(hash2);
  });

  it('should generate different hashes for different object structures', () => {
    const body1 = { userId: '123', action: 'login' };
    const body2 = { action: 'login', userId: '123' }; // Different order
    
    const hash1 = EventTypes.generateEventHash(body1);
    const hash2 = EventTypes.generateEventHash(body2);
    
    expect(hash1).not.toBe(hash2);
  });

  describe('DefaultEventValidator', () => {
    let validator: EventTypes.DefaultEventValidator;

    beforeEach(() => {
      validator = new EventTypes.DefaultEventValidator();
    });

    it('should create validator with empty schemas by default', () => {
      expect(validator).toBeInstanceOf(EventTypes.DefaultEventValidator);
    });

    it('should create validator with provided schemas', () => {
      const schemas = {
        'user.created': z.object({ userId: z.string() }),
        'user.updated': z.object({ userId: z.string(), changes: z.any() })
      };
      
      validator = new EventTypes.DefaultEventValidator(schemas);
      expect(validator).toBeInstanceOf(EventTypes.DefaultEventValidator);
    });

    it('should register schemas', () => {
      const schema = z.object({ userId: z.string() });
      validator.registerSchema('user.created', schema);
      
      const retrievedSchema = validator.getSchema('user.created');
      expect(retrievedSchema).toBe(schema);
    });

    it('should return undefined for unregistered schemas', () => {
      const schema = validator.getSchema('user.created');
      expect(schema).toBeUndefined();
    });

    it('should validate events with registered schemas successfully', () => {
      const schema = z.object({ userId: z.string() });
      validator.registerSchema('user.created', schema);
      
      const result = validator.validate('user.created', { userId: '123' });
      
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject events that fail schema validation', () => {
      const schema = z.object({ userId: z.string() });
      validator.registerSchema('user.created', schema);
      
      const result = validator.validate('user.created', { userId: 123 }); // userId should be string
      
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    });

    it('should allow events without registered schemas', () => {
      const result = validator.validate('user.created', { userId: '123' });
      
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should handle validation errors gracefully', () => {
      const schema = z.object({ 
        userId: z.string().min(3, 'User ID must be at least 3 characters')
      });
      validator.registerSchema('user.created', schema);
      
      const result = validator.validate('user.created', { userId: 'ab' }); // Too short
      
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('User ID must be at least 3 characters');
    });

    it('should handle complex validation errors', () => {
      const schema = z.object({
        user: z.object({
          id: z.string(),
          profile: z.object({
            email: z.string().email('Invalid email format'),
            age: z.number().min(18, 'Must be at least 18 years old')
          })
        })
      });
      validator.registerSchema('user.created', schema);
      
      const result = validator.validate('user.created', {
        user: {
          id: '123',
          profile: {
            email: 'invalid-email',
            age: 16
          }
        }
      });
      
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Invalid email format');
    });

    it('should handle nested object validation errors', () => {
      const schema = z.object({
        items: z.array(z.object({
          id: z.string(),
          quantity: z.number().positive('Quantity must be positive')
        }))
      });
      validator.registerSchema('order.created', schema);
      
      const result = validator.validate('order.created', {
        items: [
          { id: 'item1', quantity: 0 }, // Invalid quantity
          { id: 'item2', quantity: -1 } // Invalid quantity
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Quantity must be positive');
    });
  });

  describe('createEventValidator', () => {
    it('should create validator without schemas', () => {
      const validator = EventTypes.createEventValidator();
      
      expect(validator).toBeInstanceOf(EventTypes.DefaultEventValidator);
      expect(validator.getSchema('test.event')).toBeUndefined();
    });

    it('should create validator with provided schemas', () => {
      const schemas = {
        'user.created': z.object({ userId: z.string() }),
        'user.updated': z.object({ userId: z.string(), changes: z.any() })
      };
      
      const validator = EventTypes.createEventValidator(schemas);
      
      expect(validator).toBeInstanceOf(EventTypes.DefaultEventValidator);
      expect(validator.getSchema('user.created')).toBe(schemas['user.created']);
      expect(validator.getSchema('user.updated')).toBe(schemas['user.updated']);
    });
  });

  describe('getFullEventType', () => {
    it('should return full event type with originPrefix', () => {
      const envelope = EventTypes.createEventEnvelope('user.created', 'user-service', {}, 'us-east');
      
      const fullType = EventTypes.getFullEventType(envelope);
      
      expect(fullType).toBe('us-east.user.created');
    });

    it('should return event type without originPrefix when not present', () => {
      const envelope = EventTypes.createEventEnvelope('user.created', 'user-service', {});
      
      const fullType = EventTypes.getFullEventType(envelope);
      
      expect(fullType).toBe('user.created');
    });

    it('should handle empty string originPrefix', () => {
      const envelope = EventTypes.createEventEnvelope('user.created', 'user-service', {}, '');
      
      const fullType = EventTypes.getFullEventType(envelope);
      
      // Empty string is falsy, so it should return just the event type
      expect(fullType).toBe('user.created');
    });

    it('should handle special characters in originPrefix', () => {
      const envelope = EventTypes.createEventEnvelope('user.created', 'user-service', {}, 'us-east-1_prod');
      
      const fullType = EventTypes.getFullEventType(envelope);
      
      expect(fullType).toBe('us-east-1_prod.user.created');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null body in event creation', () => {
      const header = EventTypes.createEventHeader('user.deleted', 'user-service', null);
      
      expect(header.hash).toBeDefined();
      expect(header.hash.length).toBe(64);
    });



    it('should handle empty object body', () => {
      const header = EventTypes.createEventHeader('user.updated', 'user-service', {});
      
      expect(header.hash).toBeDefined();
      expect(header.hash.length).toBe(64);
    });

    it('should handle circular references gracefully', () => {
      const circularObj: any = { name: 'test' };
      circularObj.self = circularObj;
      
      // JSON.stringify throws an error for circular references
      expect(() => {
        EventTypes.createEventHeader('test.event', 'test-service', circularObj);
      }).toThrow('Converting circular structure to JSON');
    });

    it('should handle very large objects', () => {
      const largeObj = {
        data: 'x'.repeat(10000), // 10KB string
        array: Array(1000).fill('test')
      };
      
      const header = EventTypes.createEventHeader('large.event', 'test-service', largeObj);
      
      expect(header.hash).toBeDefined();
      expect(header.hash.length).toBe(64);
    });
  });
}); 