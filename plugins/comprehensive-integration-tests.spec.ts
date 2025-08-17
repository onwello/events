import { 
  createEventSystemBuilder,
  createTransportFactory,
  RedisStreamsPlugin,
  MemoryTransportPlugin,
  createEventEnvelope,
  DefaultEventValidator,
  createEventRouter,
  createBasicRoutingConfig
} from '../index';
import { MemoryTransport } from './memory/transport/memory-transport';
import type { EventSystem } from '../event-system-builder';
import type { EventEnvelope } from '../event-transport/transport.interface';

describe('Comprehensive Integration Tests for Branch Coverage', () => {
  let eventSystem: EventSystem;
  let memoryTransport: MemoryTransport;
  let receivedMessages: Array<{ type: string; data: any; metadata: any }> = [];

  beforeEach(() => {
    receivedMessages = [];
  });

  afterEach(async () => {
    if (eventSystem) {
      await eventSystem.close();
    }
  });

  describe('Publisher Branch Coverage', () => {
    it('should handle publisher without batching configuration', async () => {
      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .addTransport('memory', new MemoryTransport())
        .build(); // No batching enabled

      await eventSystem.connect();

      await eventSystem.consumer.subscribe('no-batch', async (message: EventEnvelope, metadata: any) => {
        receivedMessages.push({
          type: message.header.type,
          data: message.body,
          metadata
        });
      });

      await eventSystem.publisher.publish('no-batch', { id: 1 });
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(receivedMessages).toHaveLength(1);
    });

    it('should handle publisher retry with exponential backoff', async () => {
      let publishAttempts = 0;
      const failingTransport = new MemoryTransport();
      const originalPublish = failingTransport.publish.bind(failingTransport);
      
      failingTransport.publish = async (topic: string, message: any, options?: any) => {
        publishAttempts++;
        if (publishAttempts <= 2) {
          throw new Error('Simulated failure');
        }
        return originalPublish(topic, message, options);
      };

      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .addTransport('memory', failingTransport)
        .enablePublisherRetry({
          maxRetries: 3,
          backoffStrategy: 'exponential',
          baseDelay: 10,
          maxDelay: 100
        })
        .build();

      await eventSystem.connect();

      await eventSystem.consumer.subscribe('retry.test', async (message: EventEnvelope, metadata: any) => {
        receivedMessages.push({
          type: message.header.type,
          data: message.body,
          metadata
        });
      });

      await eventSystem.publisher.publish('retry.test', { id: 1 });
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(receivedMessages).toHaveLength(1);
      expect(publishAttempts).toBe(3);
    });

    it('should handle publisher retry with fixed backoff', async () => {
      let publishAttempts = 0;
      const failingTransport = new MemoryTransport();
      const originalPublish = failingTransport.publish.bind(failingTransport);
      
      failingTransport.publish = async (topic: string, message: any, options?: any) => {
        publishAttempts++;
        if (publishAttempts <= 1) {
          throw new Error('Simulated failure');
        }
        return originalPublish(topic, message, options);
      };

      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .addTransport('memory', failingTransport)
        .enablePublisherRetry({
          maxRetries: 2,
          backoffStrategy: 'fixed',
          baseDelay: 10,
          maxDelay: 100
        })
        .build();

      await eventSystem.connect();

      await eventSystem.consumer.subscribe('fixed-retry.test', async (message: EventEnvelope, metadata: any) => {
        receivedMessages.push({
          type: message.header.type,
          data: message.body,
          metadata
        });
      });

      await eventSystem.publisher.publish('fixed-retry.test', { id: 1 });
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(receivedMessages).toHaveLength(1);
      expect(publishAttempts).toBe(2);
    });

    it('should handle batching with size strategy', async () => {
      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .addTransport('memory', new MemoryTransport())
        .enablePublisherBatching({
          enabled: true,
          maxSize: 3,
          maxWaitMs: 1000,
          maxConcurrentBatches: 1,
          strategy: 'size'
        })
        .build();

      await eventSystem.connect();

      await eventSystem.consumer.subscribe('size-batch', async (message: EventEnvelope, metadata: any) => {
        receivedMessages.push({
          type: message.header.type,
          data: message.body,
          metadata
        });
      });

      // Publish exactly maxSize messages
      for (let i = 0; i < 3; i++) {
        await eventSystem.publisher.publish('size-batch', { id: i }, { batchKey: 'size-test' });
      }

      await new Promise(resolve => setTimeout(resolve, 200));
      expect(receivedMessages).toHaveLength(3);
    });

    it('should handle publisher statistics edge cases', async () => {
      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .addTransport('memory', new MemoryTransport())
        .build();

      await eventSystem.connect();

      // Get stats before any publishing
      const initialStats = eventSystem.publisher.getStats();
      expect(initialStats.totalMessagesSent).toBe(0);
      expect(initialStats.failedMessages).toBe(0);

      // Publish messages
      await eventSystem.publisher.publish('stats.test', { id: 1 });
      await eventSystem.publisher.publish('stats.test', { id: 2 });

      const finalStats = eventSystem.publisher.getStats();
      expect(finalStats.totalMessagesSent).toBe(2);
      expect(finalStats.totalMessagesSentByType['stats.test']).toBe(2);
    });
  });

  describe('Consumer Branch Coverage', () => {
    it('should handle consumer without pattern routing', async () => {
      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .addTransport('memory', new MemoryTransport())
        .build(); // No pattern routing

      await eventSystem.connect();

      // Try to subscribe to pattern (should fail)
      await expect(
        eventSystem.consumer.subscribePattern('user.*', async () => {})
      ).rejects.toThrow();
    });

    it('should handle consumer unsubscribe with specific handler', async () => {
      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .addTransport('memory', new MemoryTransport())
        .build();

      await eventSystem.connect();

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      await eventSystem.consumer.subscribe('multi.handler', handler1);
      await eventSystem.consumer.subscribe('multi.handler', handler2);

      await eventSystem.publisher.publish('multi.handler', { id: 1 });
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);

      // Unsubscribe from the event type (removes all handlers)
      await eventSystem.consumer.unsubscribe('multi.handler');

      await eventSystem.publisher.publish('multi.handler', { id: 2 });
      await new Promise(resolve => setTimeout(resolve, 100));

      // Both handlers should not be called after unsubscribe
      expect(handler1).toHaveBeenCalledTimes(1); // Still 1
      expect(handler2).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should handle consumer statistics edge cases', async () => {
      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .addTransport('memory', new MemoryTransport())
        .build();

      await eventSystem.connect();

      // Get stats before any subscriptions
      const initialStats = eventSystem.consumer.getStats();
      expect(initialStats.totalMessagesReceived).toBe(0);
      expect(initialStats.failedMessages).toBe(0);

      await eventSystem.consumer.subscribe('stats.test', async (message: EventEnvelope, metadata: any) => {
        receivedMessages.push({
          type: message.header.type,
          data: message.body,
          metadata
        });
      });

      await eventSystem.publisher.publish('stats.test', { id: 1 });
      await new Promise(resolve => setTimeout(resolve, 100));

      const finalStats = eventSystem.consumer.getStats();
      expect(finalStats.totalMessagesReceived).toBe(1);
      expect(finalStats.totalMessagesReceivedByType['stats.test']).toBe(1);
    });

    it('should handle consumer with origin prefix filtering', async () => {
      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .originPrefix('us.ca')
        .addTransport('memory', new MemoryTransport({ originPrefix: 'us.ca' }))
        .enableConsumerPatternRouting()
        .build();

      await eventSystem.connect();

      const patternMessages: Array<{ type: string; data: any; pattern: string }> = [];

      await eventSystem.consumer.subscribePattern('user.*', async (message: EventEnvelope, metadata: any, pattern: string) => {
        patternMessages.push({
          type: message.header.type,
          data: message.body,
          pattern
        });
      });

      // Publish messages with different origins
      await eventSystem.publisher.publish('us.ca.user.created', { id: 1 });
      await eventSystem.publisher.publish('us.ca.user.updated', { id: 2 });
      await eventSystem.publisher.publish('eu.de.user.created', { id: 3 }); // Different origin

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should only receive messages from us.ca origin
      expect(patternMessages).toHaveLength(2);
      expect(patternMessages[0].type).toBe('us.ca.user.created');
      expect(patternMessages[1].type).toBe('us.ca.user.updated');
    });
  });

  describe('Event Router Branch Coverage', () => {
    it('should handle event type normalization', async () => {
      const router = createEventRouter(createBasicRoutingConfig([], 'warn'), new Map());

      // Test uppercase normalization
      expect(router.resolveTopic('USER.CREATED')).toBe('user-events');
      expect(router.resolveTopic('Order.Updated')).toBe('order-events');
      expect(router.resolveTopic('MIXED.Case.Event')).toBe('mixed-events');
    });

    it('should handle pattern matching with origin prefix', async () => {
      const router = createEventRouter(createBasicRoutingConfig([], 'warn'), new Map());

      // Test pattern matching with origin prefix
      expect(router.matchesPattern('us.ca.user.created', '*.user.*')).toBe(true);
      expect(router.matchesPattern('us.ca.user.updated', '*.user.*')).toBe(true);
      expect(router.matchesPattern('eu.de.user.created', '*.user.*')).toBe(true);
      expect(router.matchesPattern('order.created', '*.user.*')).toBe(false);
      expect(router.matchesPattern('user.created', '*.user.*')).toBe(true);
    });

    it('should handle custom routing configuration', async () => {
      const transportCapabilities = new Map();
      transportCapabilities.set('memory', {
        supportsPublishing: true,
        supportsSubscription: true,
        supportsPatternRouting: true,
        supportsBatching: false,
        supportsPartitioning: false,
        supportsConsumerGroups: false
      });

      const customRouting = {
        routes: [
          {
            pattern: 'user.*',
            transport: 'memory',
            priority: 1,
            options: { topic: 'user-events' }
          },
          {
            pattern: 'order.*',
            transport: 'memory',
            priority: 2,
            options: { topic: 'order-events' }
          }
        ],
        validationMode: 'warn' as const,
        topicMapping: {},
        defaultTopicStrategy: 'namespace' as const,
        enablePatternRouting: true,
        enableBatching: false,
        enablePartitioning: false,
        enableConsumerGroups: false
      };

      const router = createEventRouter(customRouting, transportCapabilities);

      expect(router.resolveTopic('user.created')).toBe('user-events');
      expect(router.resolveTopic('order.created')).toBe('order-events');
    });
  });

  describe('Transport Factory Branch Coverage', () => {
    it('should handle plugin registration edge cases', async () => {
      const factory = createTransportFactory();
      const plugin = new MemoryTransportPlugin();
      
      // Register plugin
      factory.registerPlugin(plugin);
      expect(factory.getSupportedTypes()).toContain('memory');
      
      // Try to register same plugin again (should not throw)
      factory.registerPlugin(plugin);
      expect(factory.getSupportedTypes()).toContain('memory');
    });

    it('should handle invalid transport creation', async () => {
      const factory = createTransportFactory();
      
      // Try to create transport with invalid type
      expect(() => factory.createTransport({
        type: 'nonexistent' as any,
        options: {}
      })).toThrow();
    });

    it('should handle plugin configuration validation', async () => {
      const factory = createTransportFactory();
      factory.registerPlugin(new MemoryTransportPlugin());
      
      // Test valid configuration
      expect(() => factory.createTransport({
        type: 'memory',
        options: {}
      })).not.toThrow();
    });
  });

  describe('Event System Builder Branch Coverage', () => {
    it('should handle builder with minimal configuration', async () => {
      eventSystem = createEventSystemBuilder()
        .service('minimal-service')
        .addTransport('memory', new MemoryTransport())
        .build();

      await eventSystem.connect();
      await eventSystem.close();
    });

    it('should handle builder with all features enabled', async () => {
      eventSystem = createEventSystemBuilder()
        .service('full-service')
        .originPrefix('us.ca')
        .addTransport('memory', new MemoryTransport())
        .setValidationMode('strict')
        .enablePublisherBatching({
          enabled: true,
          maxSize: 10,
          maxWaitMs: 500,
          maxConcurrentBatches: 2,
          strategy: 'time'
        })
        .enablePublisherRetry({
          maxRetries: 3,
          backoffStrategy: 'exponential',
          baseDelay: 10,
          maxDelay: 100
        })
        .enableConsumerPatternRouting()
        .setPoisonMessageHandler(async (message: any, error: Error, metadata: any) => {
          // Handle poison messages
        })
        .build();

      await eventSystem.connect();
      await eventSystem.close();
    });

    it('should handle builder validation errors', async () => {
      // Test with invalid service name
      expect(() => createEventSystemBuilder()
        .service('')
        .addTransport('memory', new MemoryTransport())
        .build()
      ).toThrow();

      // Test with no transports
      expect(() => createEventSystemBuilder()
        .service('test')
        .build()
      ).toThrow();
    });
  });

  describe('Memory Transport Branch Coverage', () => {
    it('should handle transport lifecycle edge cases', async () => {
      const transport = new MemoryTransport();
      
      // Test connection
      await transport.connect();
      expect(transport.isConnected()).toBe(true);
      
      // Test disconnection
      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);
      
      // Test publishing after disconnect
      await expect(transport.publish('test', { id: 1 })).rejects.toThrow();
    });

    it('should handle subscription edge cases', async () => {
      const transport = new MemoryTransport();
      await transport.connect();
      
      // Test subscribing to same topic multiple times
      const handler = jest.fn();
      await transport.subscribe('test.topic', handler);
      await transport.subscribe('test.topic', handler);
      
      await transport.publish('test.topic', { id: 1 });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should handle pattern subscription edge cases', async () => {
      const transport = new MemoryTransport();
      await transport.connect();
      
      // Test pattern subscription
      const handler = jest.fn();
      await transport.subscribePattern('user.*', handler);
      
      await transport.publish('user.created', { id: 1 });
      await transport.publish('order.created', { id: 2 });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { id: 1 }
        }),
        expect.any(Object),
        'user.*'
      );
    });

    it('should handle transport statistics', async () => {
      const transport = new MemoryTransport();
      await transport.connect();
      
      // Test status
      const status = await transport.getStatus();
      expect(status.connected).toBe(true);
      expect(status.healthy).toBe(true);
      
      // Test metrics
      const metrics = await transport.getMetrics();
      expect(metrics.messagesPublished).toBe(0);
      expect(metrics.messagesReceived).toBe(0);
    });
  });

  describe('Error Handling Branch Coverage', () => {
    it('should handle transport errors gracefully', async () => {
      const errorTransport = new MemoryTransport();
      const originalPublish = errorTransport.publish.bind(errorTransport);
      const originalSubscribe = errorTransport.subscribe.bind(errorTransport);
      
      errorTransport.publish = async () => {
        throw new Error('Transport publish error');
      };
      errorTransport.subscribe = async () => {
        throw new Error('Transport subscribe error');
      };

      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .addTransport('error', errorTransport)
        .build();

      await eventSystem.connect();

      // Test publish error
      await expect(
        eventSystem.publisher.publish('test.event', { id: 1 })
      ).rejects.toThrow('Transport publish error');

      // Test subscribe error
      await expect(
        eventSystem.consumer.subscribe('test.event', async () => {})
      ).rejects.toThrow('Transport subscribe error');
    }, 10000); // Increase timeout

    it('should handle system shutdown during operations', async () => {
      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .addTransport('memory', new MemoryTransport())
        .build();

      await eventSystem.connect();

      // Close the system first
      await eventSystem.close();
      
      // Try to publish after shutdown (should fail)
      await expect(
        eventSystem.publisher.publish('test.event', { id: 1 })
      ).rejects.toThrow();
    }, 10000); // Increase timeout

    it('should handle invalid event envelopes', async () => {
      eventSystem = createEventSystemBuilder()
        .service('test-service')
        .addTransport('memory', new MemoryTransport())
        .build();

      await eventSystem.connect();

      // Test with null body (should be handled gracefully)
      await expect(
        eventSystem.publisher.publish('test.event', null)
      ).resolves.not.toThrow();
    });
  });
});
