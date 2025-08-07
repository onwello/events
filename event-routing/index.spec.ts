// Jest test file: uses Jest globals (describe, it, expect)
import eventRoutingConfig, { EventRoute } from './index';

describe('event-routing', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.clearAllMocks();
  });

  it('should match user.* events to redis with prefix', () => {
    const route = eventRoutingConfig.routes.find(r => r.pattern.test('user.updated'));
    expect(route).toBeDefined();
    expect(route?.transport).toBe('redis');
    expect(route?.prefix).toBe('user-events:');
  });

  it('should return undefined for unmatched event types', () => {
    const route = eventRoutingConfig.routes.find(r => r.pattern.test('other.event'));
    expect(route).toBeUndefined();
  });

  it('should have a default transport of console', () => {
    expect(eventRoutingConfig.default).toBe('console');
  });
}); 