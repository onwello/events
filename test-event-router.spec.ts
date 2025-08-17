import { describe, it, expect, beforeEach } from '@jest/globals';
import { EventRouter, createBasicRoutingConfig, EventRoute } from './event-routing';
import { TransportCapabilities } from './event-transport/transport.interface';

describe('EventRouter', () => {
  let router: EventRouter;
  let mockCapabilities: Map<string, TransportCapabilities>;

  beforeEach(() => {
    mockCapabilities = new Map();
    mockCapabilities.set('redis', {
      supportsPublishing: true,
      supportsSubscription: true,
      supportsBatching: true,
      supportsPartitioning: true,
      supportsOrdering: true,
      supportsPatternRouting: true,
      supportsConsumerGroups: true,
      supportsDeadLetterQueues: true,
      supportsMessageRetention: true,
      supportsMessageCompression: false,
      maxMessageSize: 1024,
      maxBatchSize: 100,
      maxTopics: 1000,
      maxPartitions: 10,
      maxConsumerGroups: 100,
      supportsPersistence: true,
      supportsReplication: true,
      supportsFailover: true,
      supportsTransactions: false,
      supportsMetrics: true,
      supportsTracing: true,
      supportsHealthChecks: true
    });
  });

  describe('Route configuration', () => {
    it('should accept valid route configurations', () => {
      const routes: EventRoute[] = [
        {
          pattern: 'user.*',
          transport: 'redis',
          priority: 1
        },
        {
          pattern: 'order.*',
          transport: 'redis',
          priority: 2
        }
      ];

      const config = createBasicRoutingConfig(routes, 'warn');
      expect(() => new EventRouter(config, mockCapabilities)).not.toThrow();
    });

    it('should validate origin prefix format', () => {
      const routes: EventRoute[] = [
        {
          pattern: 'user.*',
          transport: 'redis'
        }
      ];

      const config = createBasicRoutingConfig(
        routes, 
        'strict', 
        'eu.de',  // Valid origin prefix
        {}, 
        'namespace'
      );
      expect(() => new EventRouter(config, mockCapabilities)).not.toThrow();
    });

    it('should reject invalid origin prefix', () => {
      const routes: EventRoute[] = [
        {
          pattern: 'user.*',
          transport: 'redis'
        }
      ];

      const config = createBasicRoutingConfig(
        routes, 
        'strict', 
        'eu-de',  // Invalid: contains hyphen
        {}, 
        'namespace'
      );
      expect(() => new EventRouter(config, mockCapabilities)).toThrow();
    });
  });

  describe('Topic resolution', () => {
    describe('Without origin prefix', () => {
      beforeEach(() => {
        const routes: EventRoute[] = [
          {
            pattern: 'user.*',
            transport: 'redis',
            priority: 1
          }
        ];

        const config = createBasicRoutingConfig(routes, 'warn');
        router = new EventRouter(config, mockCapabilities);
      });

      it('should resolve topics using namespace strategy', () => {
        expect(router.resolveTopic('user.created')).toBe('user-events');
        expect(router.resolveTopic('user.updated')).toBe('user-events');
      });

      it('should fallback to unroutable for invalid eventTypes', () => {
        expect(router.resolveTopic('')).toBe('unroutable');
      });
    });

    describe('With origin prefix', () => {
      beforeEach(() => {
        const routes: EventRoute[] = [
          {
            pattern: 'user.*',
            transport: 'redis',
            priority: 1
          }
        ];

        const config = createBasicRoutingConfig(
          routes, 
          'warn', 
          'eu.de',  // Origin prefix
          {}, 
          'namespace'
        );
        router = new EventRouter(config, mockCapabilities);
      });

      it('should not prepend origin prefix to event types', () => {
        expect(router.resolveTopic('user.created')).toBe('user-events');
        expect(router.resolveTopic('order.placed')).toBe('order-events');
      });
    });

    describe('With topic mapping', () => {
      beforeEach(() => {
        const routes: EventRoute[] = [
          {
            pattern: 'user.*',
            transport: 'redis',
            priority: 1
          }
        ];

        const topicMapping = {
          '*.user.*': 'user',
          '*.order.*': 'order'
        };

        const config = createBasicRoutingConfig(
          routes, 
          'warn', 
          'eu.de',  // Origin prefix
          topicMapping, 
          'namespace'
        );
        router = new EventRouter(config, mockCapabilities);
      });

      it('should use topic mapping patterns', () => {
        expect(router.resolveTopic('user.created')).toBe('user-events');
        expect(router.resolveTopic('order.placed')).toBe('order-events');
      });
    });
  });

  describe('Case normalization', () => {
    it('should normalize event types to lowercase', () => {
      const routes: EventRoute[] = [
        {
          pattern: 'user.*',
          transport: 'redis'
        }
      ];

      const config = createBasicRoutingConfig(routes, 'warn');
      router = new EventRouter(config, mockCapabilities);

      // Should work with lowercase
      expect(router.resolveTopic('user.created')).toBe('user-events');
      
      // Should normalize uppercase and still work
      expect(router.resolveTopic('USER.CREATED')).toBe('user-events');
    });
  });
});
