// Jest test file: uses Jest globals (describe, it, expect)
import * as EventTypes from './index';

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
    expect(typeof EventTypes.createEventEnvelope).toBe('function');
    expect(typeof EventTypes.createEventHeader).toBe('function');
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

  it('should create envelopes with namespace prefixing', () => {
    const body = { userId: '123' };
    const envelope = EventTypes.createEventEnvelope('updated', 'user-service', body, 'user');
    
    expect(envelope.header.type).toBe('user.updated');
  });
}); 