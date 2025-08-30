import { Redis } from 'ioredis';
import { EnhancedRedisStreamsTransport } from './enhanced-redis-streams-transport';
import { EventEnvelope } from '../../../event-types';

describe('Event Type Filtering Integration Tests', () => {
  let redis: Redis;
  let transport: EnhancedRedisStreamsTransport;
  let receivedMessages: EventEnvelope[] = [];
  let receivedEventTypes: string[] = [];

  beforeAll(async () => {
    // Connect to Redis
    redis = new Redis({
      host: 'localhost',
      port: 6379,
      db: 3, // Use different DB for testing
      lazyConnect: true,
      maxRetriesPerRequest: 3
    });

    await redis.connect();
    await redis.flushdb();
  }, 10000);

  afterAll(async () => {
    if (transport) {
      try {
        await transport.disconnect();
      } catch (error) {
        // Ignore disconnect errors in cleanup
      }
    }
    try {
      await redis.flushdb();
      await redis.disconnect();
    } catch (error) {
      // Ignore cleanup errors
    }
  }, 10000);

  beforeEach(async () => {
    // Clear streams before each test
    const keys = await redis.keys('stream:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    // Reset message tracking
    receivedMessages = [];
    receivedEventTypes = [];

    // Create transport
    transport = new EnhancedRedisStreamsTransport(redis, {
      streamPrefix: 'stream:',
      groupId: 'test-group',
      consumerId: `test-consumer-${Date.now()}`,
      batchSize: 5,
      blockTime: 1000,
      maxRetries: 2,
      retryDelay: 100,
      enableDLQ: false,
      enableMetrics: false
    });

    await transport.connect();
  }, 10000);

  afterEach(async () => {
    if (transport) {
      try {
        await transport.disconnect();
      } catch (error) {
        // Ignore disconnect errors in cleanup
      }
    }
  }, 10000);

  describe('Exact Event Type Filtering', () => {
    it('should only deliver messages matching exact subscription', async () => {
      // Subscribe to exact event type
      const handler = jest.fn().mockImplementation((message: EventEnvelope) => {
        receivedMessages.push(message);
        receivedEventTypes.push(message.header.type);
      });

      await transport.subscribe('location-events', handler, {}, 'location.user.invite.created');

      // Wait for subscription to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Publish different event types to the same stream
      await transport.publish('location-events', createTestEvent('location.user.invite.created'));
      await transport.publish('location-events', createTestEvent('location.user.invite.status.updated'));
      await transport.publish('location-events', createTestEvent('location.user.invite.deleted'));

      // Wait for messages to be processed - shorter timeout
      await new Promise(resolve => setTimeout(resolve, 200));

      // Only the exact matching event type should be received
      expect(receivedEventTypes).toHaveLength(1);
      expect(receivedEventTypes[0]).toBe('location.user.invite.created');
      expect(handler).toHaveBeenCalledTimes(1);
    }, 10000); // 10 second timeout

    it('should handle multiple exact subscriptions to same stream', async () => {
      const handler1 = jest.fn().mockImplementation((message: EventEnvelope) => {
        receivedEventTypes.push(`handler1:${message.header.type}`);
      });

      const handler2 = jest.fn().mockImplementation((message: EventEnvelope) => {
        receivedEventTypes.push(`handler2:${message.header.type}`);
      });

      // Subscribe to different exact event types on same stream
      await transport.subscribe('location-events', handler1, {}, 'location.user.invite.created');
      await transport.subscribe('location-events', handler2, {}, 'location.user.invite.status.updated');

      // Wait for subscription to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Publish messages
      await transport.publish('location-events', createTestEvent('location.user.invite.created'));
      await transport.publish('location-events', createTestEvent('location.user.invite.status.updated'));

      // Wait for messages to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Each handler should receive only its specific event type
      expect(receivedEventTypes).toHaveLength(2);
      expect(receivedEventTypes).toContain('handler1:location.user.invite.created');
      expect(receivedEventTypes).toContain('handler2:location.user.invite.status.updated');
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    }, 10000);
  });

  describe('Pattern-Based Filtering', () => {
    it('should deliver messages matching pattern subscription', async () => {
      const handler = jest.fn().mockImplementation((message: EventEnvelope) => {
        receivedMessages.push(message);
        receivedEventTypes.push(message.header.type);
      });

      // Subscribe to pattern using the single subscribe method
      await transport.subscribe('location.user.invite.*', handler);

      // Wait for subscription to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Publish messages
      await transport.publish('location-events', createTestEvent('location.user.invite.created'));
      await transport.publish('location-events', createTestEvent('location.user.invite.status.updated'));
      await transport.publish('location-events', createTestEvent('location.user.invite.deleted'));
      await transport.publish('location-events', createTestEvent('location.user.profile.updated'));

      // Wait for messages to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should receive all invite-related events
      expect(receivedEventTypes).toContain('location.user.invite.created');
      expect(receivedEventTypes).toContain('location.user.invite.status.updated');
      expect(receivedEventTypes).toContain('location.user.invite.deleted');
      expect(receivedEventTypes).not.toContain('location.user.profile.updated');
      expect(handler).toHaveBeenCalledTimes(3);
    }, 10000);

    it('should support complex wildcard patterns', async () => {
      const handler = jest.fn().mockImplementation((message: EventEnvelope) => {
        receivedEventTypes.push(message.header.type);
      });

      // Subscribe to complex pattern using the single subscribe method
      await transport.subscribe('*.user.*.updated', handler);

      // Wait for subscription to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Publish messages
      await transport.publish('location-events', createTestEvent('eu.de.user.profile.updated'));
      await transport.publish('location-events', createTestEvent('us.ca.user.settings.updated'));
      await transport.publish('location-events', createTestEvent('user.profile.updated'));
      await transport.publish('location-events', createTestEvent('eu.de.user.created'));
      await transport.publish('location-events', createTestEvent('eu.de.order.user.updated'));

      // Wait for messages to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should receive messages matching the pattern
      expect(receivedEventTypes).toContain('eu.de.user.profile.updated');
      expect(receivedEventTypes).toContain('us.ca.user.settings.updated');
      expect(receivedEventTypes).toContain('user.profile.updated');
      expect(receivedEventTypes).not.toContain('eu.de.user.created');
      expect(receivedEventTypes).not.toContain('eu.de.order.user.updated');
      expect(handler).toHaveBeenCalledTimes(3);
    }, 10000);
  });

  describe('Mixed Subscription Types', () => {
    it('should handle both exact and pattern subscriptions correctly', async () => {
      const exactHandler = jest.fn().mockImplementation((message: EventEnvelope) => {
        receivedEventTypes.push(`exact:${message.header.type}`);
      });

      const patternHandler = jest.fn().mockImplementation((message: EventEnvelope) => {
        receivedEventTypes.push(`pattern:${message.header.type}`);
      });

      // Subscribe to exact event type
      await transport.subscribe('location-events', exactHandler, {}, 'location.user.invite.created');
      
      // Subscribe to pattern
      await transport.subscribe('location.user.invite.*', patternHandler);

      // Wait for subscriptions to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Publish messages
      await transport.publish('location-events', createTestEvent('location.user.invite.created'));
      await transport.publish('location-events', createTestEvent('location.user.invite.status.updated'));

      // Wait for messages to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Exact handler should only receive exact match
      expect(exactHandler).toHaveBeenCalledTimes(1);
      
      // Pattern handler should receive both
      expect(patternHandler).toHaveBeenCalledTimes(2);
      
      expect(receivedEventTypes).toContain('exact:location.user.invite.created');
      expect(receivedEventTypes).toContain('pattern:location.user.invite.created');
      expect(receivedEventTypes).toContain('pattern:location.user.invite.status.updated');
    }, 10000);
  });

  describe('Performance and Scalability', () => {
    it('should handle high message volume efficiently', async () => {
      const handler = jest.fn().mockImplementation((message: EventEnvelope) => {
        receivedEventTypes.push(message.header.type);
      });

      // Subscribe to exact event type
      await transport.subscribe('location-events', handler, {}, 'location.user.invite.created');

      // Wait for subscription to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      const startTime = Date.now();
      
      // Publish many messages (only one should match)
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        if (i === 50) {
          // One matching message
          promises.push(transport.publish('location-events', createTestEvent('location.user.invite.created')));
        } else {
          // Non-matching messages
          promises.push(transport.publish('location-events', createTestEvent(`location.user.invite.status.${i}`)));
        }
      }

      await Promise.all(promises);

      // Wait for messages to be processed
      await new Promise(resolve => setTimeout(resolve, 500));

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should only process the matching message
      expect(handler).toHaveBeenCalledTimes(1);
      
      // Processing should be reasonably fast
      expect(processingTime).toBeLessThan(5000); // 5 seconds max
      
      console.log(`Processed 100 messages in ${processingTime}ms, handler called ${handler.mock.calls.length} times`);
    }, 15000);

    it('should continue processing after handler errors', async () => {
      let callCount = 0;
      const handler = jest.fn().mockImplementation((message: EventEnvelope) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Simulated handler error');
        }
        // Explicitly type the array operation
        (receivedEventTypes as string[]).push(message.header.type);
      });

      // Subscribe to exact event type
      await transport.subscribe('location-events', handler, {}, 'location.user.invite.created');

      // Wait for subscription to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Publish messages
      await transport.publish('location-events', createTestEvent('location.user.invite.created'));
      await transport.publish('location-events', createTestEvent('location.user.invite.created'));

      // Wait for messages to be processed
      await new Promise(resolve => setTimeout(resolve, 500));

      // Handler should be called twice (once with error, once successfully)
      expect(handler).toHaveBeenCalledTimes(2);
      expect(receivedEventTypes).toHaveLength(1);
    }, 10000);

    it('should handle malformed messages gracefully', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      
      // Subscribe to exact event type
      await transport.subscribe('location-events', handler, {}, 'location.user.invite.created');

      // Wait for subscription to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Try to publish malformed message (this should not break the system)
      try {
        await transport.publish('location-events', { invalid: 'message' });
      } catch (error) {
        // Expected to fail
      }

      // Publish valid message
      await transport.publish('location-events', createTestEvent('location.user.invite.created'));

      // Wait for messages to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Handler should only be called for valid message
      expect(handler).toHaveBeenCalledTimes(1);
    }, 10000);
  });
});

// Helper function to create test events
function createTestEvent(eventType: string): any {
  return {
    id: `test-${Date.now()}`,
    header: {
      type: eventType,
      origin: 'test-origin',
      timestamp: new Date().toISOString(),
      hash: 'test-hash',
      version: '1.0.0'
    },
    body: { test: 'data' }
  };
}
