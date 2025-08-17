import {
  createEventSystemBuilder,
  createEventRouter,
  createBasicRoutingConfig
} from '../../index';
import { MemoryTransport } from './transport/memory-transport';

describe('Pattern Matching Tests', () => {
  let memoryTransport: MemoryTransport;
  let router: any;

  beforeEach(() => {
    memoryTransport = new MemoryTransport();
  });

  describe('Pattern Validation', () => {
    beforeEach(() => {
      router = createEventRouter(createBasicRoutingConfig([], 'strict'), new Map());
    });

    it('should accept valid patterns', () => {
      const validPatterns = [
        '*.user.*',
        'user.*',
        '*.user',
        'user.created',
        'eu.de.user.*',
        '*.user.created.*'
      ];

      validPatterns.forEach(pattern => {
        expect(() => router.validateAndNormalizePattern(pattern)).not.toThrow();
      });
    });

    it('should reject invalid patterns with special characters', () => {
      const invalidPatterns = [
        '*.user?.*',      // Question mark
        'user[.*',        // Square bracket
        '*.user{.*',      // Curly brace
        'user.*+',        // Plus sign
        '*.user|.*',      // Pipe
        'user.*^',        // Caret
        '*.user$.*',      // Dollar sign
        'user.*(',        // Parenthesis
        '*.user).*',      // Parenthesis
        'user.*\\',       // Backslash
        '*.user/.*',      // Forward slash
        'user.*@',        // At symbol
        '*.user#.*',      // Hash
        'user.*%',        // Percent
        '*.user&.*',      // Ampersand
        'user.*=',        // Equals
        '*.user!.*',      // Exclamation
        'user.*~',        // Tilde
        '*.user`.*',      // Backtick
        'user.*;',        // Semicolon
        '*.user:.*',      // Colon
        'user.*"',        // Quote
        '*.user\'.*',     // Single quote
        'user.*<',        // Less than
        '*.user>.*',      // Greater than
        'user.*,',        // Comma
        '*.user|.*'       // Vertical bar
      ];

      invalidPatterns.forEach(pattern => {
        expect(() => router.validateAndNormalizePattern(pattern)).toThrow();
      });
    });

    it('should reject patterns with consecutive dots', () => {
      const invalidPatterns = [
        'user..created',
        '*.user..*',
        'user..*',
        '*.user..created'
      ];

      invalidPatterns.forEach(pattern => {
        expect(() => router.validateAndNormalizePattern(pattern)).toThrow();
      });
    });

    it('should reject patterns with consecutive asterisks', () => {
      const invalidPatterns = [
        'user.**',
        '*.user.**',
        'user.**created',
        '**.user.*'
      ];

      invalidPatterns.forEach(pattern => {
        expect(() => router.validateAndNormalizePattern(pattern)).toThrow();
      });
    });

    it('should reject patterns starting or ending with dots', () => {
      const invalidPatterns = [
        '.user.*',
        '*.user.',
        '.user.created',
        'user.created.'
      ];

      invalidPatterns.forEach(pattern => {
        expect(() => router.validateAndNormalizePattern(pattern)).toThrow();
      });
    });
  });

  describe('Pattern Matching with Origin Prefix', () => {
    beforeEach(() => {
      const config = createBasicRoutingConfig([], 'strict');
      config.originPrefix = 'us.ca';
      router = createEventRouter(config, new Map());
    });

    it('should match *.user.* patterns correctly', () => {
      const pattern = '*.user.*';
      
      // Should match any origin prefix
      expect(router.matchesPattern('user.created', pattern)).toBe(true);
      expect(router.matchesPattern('user.registered.success', pattern)).toBe(true);
      expect(router.matchesPattern('eu.de.user.subscribed', pattern)).toBe(true);
      expect(router.matchesPattern('us.ca.user.login', pattern)).toBe(true);
      expect(router.matchesPattern('eu.de.user', pattern)).toBe(true);
      
      // Should not match non-user events
      expect(router.matchesPattern('order.created', pattern)).toBe(false);
      expect(router.matchesPattern('product.updated', pattern)).toBe(false);
    });

    it('should match user.* patterns with origin prefix respect', () => {
      const pattern = 'user.*';
      
      // Should match user events with same origin prefix
      expect(router.matchesPattern('us.ca.user.created', pattern)).toBe(true);
      expect(router.matchesPattern('us.ca.user.updated', pattern)).toBe(true);
      expect(router.matchesPattern('us.ca.user.deleted', pattern)).toBe(true);
      
      // Should also match user events with different origin prefix (more flexible routing)
      expect(router.matchesPattern('eu.de.user.created', pattern)).toBe(true);
      expect(router.matchesPattern('eu.de.user.updated', pattern)).toBe(true);
      
      // Should NOT match events without origin prefix (when origin prefix is configured)
      expect(router.matchesPattern('user.created', pattern)).toBe(false);
      expect(router.matchesPattern('user.updated', pattern)).toBe(false);
    });

    it('should match exact patterns', () => {
      const pattern = 'user.created';
      
      // Should match exact event type with origin prefix
      expect(router.matchesPattern('us.ca.user.created', pattern)).toBe(true);
      
      // Should not match other event types
      expect(router.matchesPattern('us.ca.user.updated', pattern)).toBe(false);
      expect(router.matchesPattern('eu.de.user.created', pattern)).toBe(false);
    });
  });

  describe('Pattern Matching without Origin Prefix', () => {
    beforeEach(() => {
      router = createEventRouter(createBasicRoutingConfig([], 'strict'), new Map());
    });

    it('should match patterns without origin prefix', () => {
      const pattern = 'user.*';
      
      // Should match user events without origin prefix
      expect(router.matchesPattern('user.created', pattern)).toBe(true);
      expect(router.matchesPattern('user.updated', pattern)).toBe(true);
      expect(router.matchesPattern('user.deleted', pattern)).toBe(true);
      
      // Should not match other events
      expect(router.matchesPattern('order.created', pattern)).toBe(false);
      expect(router.matchesPattern('product.updated', pattern)).toBe(false);
    });

    it('should match *.user.* patterns without origin prefix', () => {
      const pattern = '*.user.*';
      
      // Should match any user events
      expect(router.matchesPattern('user.created', pattern)).toBe(true);
      expect(router.matchesPattern('user.updated', pattern)).toBe(true);
      expect(router.matchesPattern('user.deleted', pattern)).toBe(true);
      
      // Should not match other events
      expect(router.matchesPattern('order.created', pattern)).toBe(false);
      expect(router.matchesPattern('product.updated', pattern)).toBe(false);
    });
  });

  describe('Integration with Event System', () => {
    let eventSystem: any;
    let receivedMessages: Array<{ type: string; data: any; pattern: string }> = [];

    beforeEach(() => {
      receivedMessages = [];
      memoryTransport = new MemoryTransport({ originPrefix: 'us.ca' });
      
      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .originPrefix('us.ca')
        .addTransport('memory', memoryTransport)
        .enableConsumerPatternRouting()
        .build();
    });

    afterEach(async () => {
      if (eventSystem) {
        await eventSystem.close();
      }
    });

    it('should handle pattern subscriptions with origin prefix correctly', async () => {
      await eventSystem.connect();

      // Subscribe to user.* pattern
      await eventSystem.consumer.subscribePattern('user.*', async (message: any, metadata: any, pattern: string) => {
        receivedMessages.push({
          type: message.header.type,
          data: message.body,
          pattern
        });
      });

      // Publish messages with different origin prefixes
      await eventSystem.publisher.publish('us.ca.user.created', { id: 1 });
      await eventSystem.publisher.publish('us.ca.user.updated', { id: 2 });
      await eventSystem.publisher.publish('eu.de.user.created', { id: 3 }); // Different origin
      await eventSystem.publisher.publish('order.created', { id: 4 }); // Different type

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should only receive messages with same origin prefix
      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages[0].type).toBe('us.ca.user.created');
      expect(receivedMessages[1].type).toBe('us.ca.user.updated');
    });

    it('should handle *.user.* pattern correctly', async () => {
      await eventSystem.connect();

      // Subscribe to *.user.* pattern
      await eventSystem.consumer.subscribePattern('*.user.*', async (message: any, metadata: any, pattern: string) => {
        receivedMessages.push({
          type: message.header.type,
          data: message.body,
          pattern
        });
      });

      // Publish messages with different origin prefixes
      await eventSystem.publisher.publish('us.ca.user.created', { id: 1 });
      await eventSystem.publisher.publish('eu.de.user.updated', { id: 2 });
      await eventSystem.publisher.publish('order.created', { id: 3 }); // Different type

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should receive all user events regardless of origin prefix
      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages[0].type).toBe('us.ca.user.created');
      expect(receivedMessages[1].type).toBe('eu.de.user.updated');
    });

    it('should reject invalid patterns during subscription', async () => {
      await eventSystem.connect();

      // Try to subscribe with invalid pattern
      await expect(
        eventSystem.consumer.subscribePattern('user?.*', async (message: any, metadata: any, pattern: string) => {
          // This should not be called
        })
      ).rejects.toThrow('Invalid pattern');
    });
  });
});
