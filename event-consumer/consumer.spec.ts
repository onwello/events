import { EventConsumer, createConsumer, ConsumerConfig, ConsumerStats, SubscriptionInfo } from './consumer';
import { Transport, EventEnvelope, MessageHandler, PatternHandler, SubscribeOptions } from '../event-transport/transport.interface';
import { EventRouter } from '../event-routing';
import { EventValidator } from '../event-types';

// Mock dependencies
const mockTransport = {
  name: 'mock-transport',
  capabilities: {
    supportsPublishing: true,
    supportsSubscription: true,
    supportsBatching: false,
    supportsPartitioning: false,
    supportsOrdering: false,
    supportsPatternRouting: false,
    supportsConsumerGroups: false,
    supportsDeadLetterQueues: false,
    supportsMessageRetention: false,
    supportsMessageCompression: false,
    maxMessageSize: 1024,
    maxBatchSize: 100,
    maxTopics: 1000,
    maxPartitions: 1,
    maxConsumerGroups: 100,
    supportsPersistence: false,
    supportsReplication: false,
    supportsFailover: false,
    supportsTransactions: false,
    supportsMetrics: false,
    supportsTracing: false,
    supportsHealthChecks: false,
  },
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  isConnected: jest.fn().mockReturnValue(true),
  publish: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn().mockResolvedValue(undefined),
  unsubscribe: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  getStatus: jest.fn().mockResolvedValue({ status: 'connected' } as any),
  getMetrics: jest.fn().mockResolvedValue({} as any),
} as Transport;

const mockRouter: EventRouter = {
  resolveTopic: jest.fn().mockReturnValue('test-topic'),
  matchesPattern: jest.fn().mockReturnValue(true),
  validateEventType: jest.fn().mockReturnValue(true),
  validateOriginPrefix: jest.fn().mockReturnValue(true),
  validateTopicName: jest.fn().mockReturnValue(true),
  validateConfiguration: jest.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
  validateTransportFeatures: jest.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
} as any;

const mockValidator: EventValidator = {
  validate: jest.fn().mockReturnValue({ valid: true, error: undefined }),
  getSchema: jest.fn().mockReturnValue(undefined),
};

const mockMessageHandler: MessageHandler<any> = jest.fn().mockImplementation(async () => {
  // Add a small delay to ensure processing time > 0
  await new Promise(resolve => setTimeout(resolve, 1));
  return undefined;
});
const mockPatternHandler: PatternHandler<any> = jest.fn().mockResolvedValue(undefined);

describe('EventConsumer', () => {
  let consumer: EventConsumer;
  let config: ConsumerConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    
    config = {
      transports: new Map([['default', mockTransport]]),
      router: mockRouter,
      validator: mockValidator,
      enablePatternRouting: true,
      validationMode: 'strict',
      consumerId: 'test-consumer',
      groupId: 'test-group',
    };
    
    consumer = new EventConsumer(config);
  });

  describe('Constructor and Configuration', () => {
    it('should create consumer with configuration', () => {
      expect(consumer).toBeInstanceOf(EventConsumer);
    });

    it('should create consumer via factory function', () => {
      const factoryConsumer = createConsumer(config);
      expect(factoryConsumer).toBeInstanceOf(EventConsumer);
    });

    it('should handle empty transports map', () => {
      const emptyConfig = { ...config, transports: new Map() };
      expect(() => new EventConsumer(emptyConfig)).not.toThrow();
    });

    it('should handle missing optional configuration', () => {
      const minimalConfig = {
        transports: new Map([['default', mockTransport]]),
        router: mockRouter,
        validator: mockValidator,
      };
      expect(() => new EventConsumer(minimalConfig)).not.toThrow();
    });
  });

  describe('Basic Subscription', () => {
    it('should subscribe to events', async () => {
      await consumer.subscribe('user.created', mockMessageHandler);
      
      expect(mockTransport.subscribe).toHaveBeenCalledWith(
        'test-topic',
        expect.any(Function),
        expect.objectContaining({
          consumerId: 'test-consumer',
          groupId: 'test-group'
        }),
        'user.created' // eventType is now passed as 4th parameter
      );
    });

    it('should unsubscribe from events', async () => {
      await consumer.subscribe('user.created', mockMessageHandler);
      await consumer.unsubscribe('user.created');
      
      expect(mockTransport.unsubscribe).toHaveBeenCalledWith('test-topic');
    });

    it('should handle unsubscribe for non-existent subscription', async () => {
      // Should not throw when unsubscribing from non-existent subscription
      await expect(consumer.unsubscribe('non-existent')).resolves.not.toThrow();
    });

    it('should handle unsubscribe when no subscription exists', async () => {
      const emptyConsumer = new EventConsumer({
        ...config,
        transports: new Map([['default', mockTransport]]),
      });
      
      await expect(emptyConsumer.unsubscribe('test')).resolves.not.toThrow();
    });

    it('should handle unsubscribe with empty transports', async () => {
      const emptyConsumer = new EventConsumer({
        ...config,
        transports: new Map(),
      });
      
      await expect(emptyConsumer.unsubscribe('test')).resolves.not.toThrow();
    });
  });

  describe('Pattern Subscription', () => {
    it('should subscribe to patterns when enabled', async () => {
      const advancedTransport = {
        ...mockTransport,
        subscribePattern: jest.fn().mockResolvedValue(undefined),
        unsubscribePattern: jest.fn().mockResolvedValue(undefined),
      };
      
      const advancedConfig = {
        ...config,
        transports: new Map([['default', advancedTransport]]),
      };
      
      const advancedConsumer = new EventConsumer(advancedConfig);
      
      await advancedConsumer.subscribePattern('user.*', mockPatternHandler);
      
      expect(advancedTransport.subscribePattern).toHaveBeenCalledWith(
        'user.*',
        expect.any(Function),
        expect.any(Object)
      );
    });

    it('should throw error when pattern routing is disabled', async () => {
      const disabledConfig = { ...config, enablePatternRouting: false };
      const disabledConsumer = new EventConsumer(disabledConfig);
      
      await expect(
        disabledConsumer.subscribePattern('user.*', mockPatternHandler)
      ).rejects.toThrow('Pattern routing is not enabled for this consumer');
    });

    it('should handle unsubscribe pattern for non-existent subscription', async () => {
      const advancedTransport = {
        ...mockTransport,
        unsubscribePattern: jest.fn().mockResolvedValue(undefined),
      };
      
      const advancedConfig = {
        ...config,
        transports: new Map([['default', advancedTransport]]),
      };
      
      const advancedConsumer = new EventConsumer(advancedConfig);
      
      await expect(advancedConsumer.unsubscribePattern('non-existent')).resolves.not.toThrow();
    });

    it('should handle unsubscribe pattern when no subscription exists', async () => {
      const advancedTransport = {
        ...mockTransport,
        unsubscribePattern: jest.fn().mockResolvedValue(undefined),
      };
      
      const advancedConfig = {
        ...config,
        transports: new Map([['default', advancedTransport]]),
      };
      
      const advancedConsumer = new EventConsumer(advancedConfig);
      
      await expect(advancedConsumer.unsubscribePattern('test')).resolves.not.toThrow();
    });

    it('should handle unsubscribe pattern with empty transports', async () => {
      const emptyConsumer = new EventConsumer({
        ...config,
        transports: new Map(),
      });
      
      await expect(emptyConsumer.unsubscribePattern('test')).resolves.not.toThrow();
    });
  });

  describe('Connection Management', () => {
    it('should connect to all transports', async () => {
      await consumer.connect();
      expect(mockTransport.connect).toHaveBeenCalled();
    });

    it('should close all connections', async () => {
      await consumer.close();
      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('should handle multiple transports in connect', async () => {
      const transport1 = { ...mockTransport, connect: jest.fn().mockResolvedValue(undefined) };
      const transport2 = { ...mockTransport, connect: jest.fn().mockResolvedValue(undefined) };
      
      const multiTransportConfig = {
        ...config,
        transports: new Map([
          ['transport1', transport1],
          ['transport2', transport2]
        ]),
      };
      
      const multiConsumer = new EventConsumer(multiTransportConfig);
      await multiConsumer.connect();
      
      expect(transport1.connect).toHaveBeenCalled();
      expect(transport2.connect).toHaveBeenCalled();
    });

    it('should handle multiple transports in close', async () => {
      const transport1 = { ...mockTransport, close: jest.fn().mockResolvedValue(undefined) };
      const transport2 = { ...mockTransport, close: jest.fn().mockResolvedValue(undefined) };
      
      const multiTransportConfig = {
        ...config,
        transports: new Map([
          ['transport1', transport1],
          ['transport2', transport2]
        ]),
      };
      
      const multiConsumer = new EventConsumer(multiTransportConfig);
      await multiConsumer.close();
      
      expect(transport1.close).toHaveBeenCalled();
      expect(transport2.close).toHaveBeenCalled();
    });
  });

  describe('Statistics and Information', () => {
    it('should return subscription information', async () => {
      await consumer.subscribe('user.created', mockMessageHandler);
      
      const subscriptions = consumer.getSubscriptions();
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0]).toMatchObject({
        eventType: 'user.created',
        transport: 'default',
        isPattern: false,
      });
    });

    it('should return consumer statistics', () => {
      const stats = consumer.getStats();
      expect(stats).toMatchObject({
        totalMessagesReceived: 0,
        failedMessages: 0,
        poisonMessages: 0,
        averageProcessingTime: 0,
      });
    });

    it('should return empty subscriptions when none exist', () => {
      const emptyConsumer = new EventConsumer({
        ...config,
        transports: new Map(),
      });
      
      const subscriptions = emptyConsumer.getSubscriptions();
      expect(subscriptions).toHaveLength(0);
    });

    it('should return pattern subscriptions in getSubscriptions', async () => {
      const advancedTransport = {
        ...mockTransport,
        subscribePattern: jest.fn().mockResolvedValue(undefined),
      };
      
      const advancedConfig = {
        ...config,
        transports: new Map([['default', advancedTransport]]),
      };
      
      const advancedConsumer = new EventConsumer(advancedConfig);
      await advancedConsumer.subscribePattern('user.*', mockPatternHandler);
      
      const subscriptions = advancedConsumer.getSubscriptions();
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0].isPattern).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle transport errors gracefully', async () => {
      const errorTransport = {
        ...mockTransport,
        subscribe: jest.fn().mockRejectedValue(new Error('Transport error')),
      };
      
      const errorConfig = {
        ...config,
        transports: new Map([['default', errorTransport]]),
      };
      
      const errorConsumer = new EventConsumer(errorConfig);
      
      await expect(
        errorConsumer.subscribe('user.created', mockMessageHandler)
      ).rejects.toThrow('Transport error');
    });

    it('should handle no available transport', () => {
      const emptyConfig = {
        ...config,
        transports: new Map(),
      };
      
      expect(() => new EventConsumer(emptyConfig)).not.toThrow();
      
      const emptyConsumer = new EventConsumer(emptyConfig);
      expect(() => emptyConsumer['getTransportForEvent']('test')).toThrow('No transport available');
    });

    it('should handle transport unsubscribe errors', async () => {
      const errorTransport = {
        ...mockTransport,
        unsubscribe: jest.fn().mockRejectedValue(new Error('Unsubscribe error')),
      };
      
      const errorConfig = {
        ...config,
        transports: new Map([['default', errorTransport]]),
      };
      
      const errorConsumer = new EventConsumer(errorConfig);
      await errorConsumer.subscribe('user.created', mockMessageHandler);
      
      await expect(errorConsumer.unsubscribe('user.created')).rejects.toThrow('Unsubscribe error');
    });

    it('should handle transport connect errors', async () => {
      const errorTransport = {
        ...mockTransport,
        connect: jest.fn().mockRejectedValue(new Error('Connect error')),
      };
      
      const errorConfig = {
        ...config,
        transports: new Map([['default', errorTransport]]),
      };
      
      const errorConsumer = new EventConsumer(errorConfig);
      
      await expect(errorConsumer.connect()).rejects.toThrow('Connect error');
    });

    it('should handle transport close errors', async () => {
      const errorTransport = {
        ...mockTransport,
        close: jest.fn().mockRejectedValue(new Error('Close error')),
      };
      
      const errorConfig = {
        ...config,
        transports: new Map([['default', errorTransport]]),
      };
      
      const errorConsumer = new EventConsumer(errorConfig);
      
      await expect(errorConsumer.close()).rejects.toThrow('Close error');
    });
  });

  describe('Advanced Transport Support', () => {
    it('should detect advanced transport capabilities', () => {
      const advancedTransport = {
        ...mockTransport,
        subscribePattern: jest.fn(),
        unsubscribePattern: jest.fn(),
      };
      
      const advancedConfig = {
        ...config,
        transports: new Map([['default', advancedTransport]]),
      };
      
      const advancedConsumer = new EventConsumer(advancedConfig);
      
      expect(advancedConsumer['isAdvancedTransport'](advancedTransport)).toBe(true);
      expect(advancedConsumer['isAdvancedTransport'](mockTransport)).toBe(false);
    });

    it('should handle advanced transport without subscribePattern', () => {
      const partialAdvancedTransport = {
        ...mockTransport,
        // Missing subscribePattern
      };
      
      const partialConfig = {
        ...config,
        transports: new Map([['default', partialAdvancedTransport]]),
      };
      
      const partialConsumer = new EventConsumer(partialConfig);
      
      expect(partialConsumer['isAdvancedTransport'](partialAdvancedTransport)).toBe(false);
    });
  });

  describe('Message Processing and Validation', () => {
    it('should handle origin filtering with originPrefix', async () => {
      const originConfig = {
        ...config,
        originPrefix: 'eu.de',
      };
      
      const originConsumer = new EventConsumer(originConfig);
      await originConsumer.subscribe('user.created', mockMessageHandler);
      
      // Get the wrapped handler
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      // Test with matching origin
      const messageWithOrigin: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          originPrefix: 'eu.de',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await wrappedHandler(messageWithOrigin, { topic: 'test' });
      expect(mockMessageHandler).toHaveBeenCalledWith(messageWithOrigin, { topic: 'test' });
    });

    it('should handle origin filtering with origins array', async () => {
      const originsConfig = {
        ...config,
        origins: ['eu.de', 'us.ca'],
      };
      
      const originsConsumer = new EventConsumer(originsConfig);
      await originsConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      // Test with matching origin
      const messageWithOrigin: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          originPrefix: 'us.ca',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await wrappedHandler(messageWithOrigin, { topic: 'test' });
      expect(mockMessageHandler).toHaveBeenCalledWith(messageWithOrigin, { topic: 'test' });
    });

    it('should skip messages with non-matching origin', async () => {
      const originConfig = {
        ...config,
        originPrefix: 'eu.de',
      };
      
      const originConsumer = new EventConsumer(originConfig);
      await originConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      // Test with non-matching origin
      const messageWithWrongOrigin: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          originPrefix: 'us.ca',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await wrappedHandler(messageWithWrongOrigin, { topic: 'test' });
      expect(mockMessageHandler).not.toHaveBeenCalled();
    });

    it('should handle messages without origin prefix', async () => {
      const originConfig = {
        ...config,
        originPrefix: 'eu.de',
      };
      
      const originConsumer = new EventConsumer(originConfig);
      await originConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      // Test with message without origin prefix
      const messageWithoutOrigin: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await wrappedHandler(messageWithoutOrigin, { topic: 'test' });
      expect(mockMessageHandler).not.toHaveBeenCalled();
    });

    it('should handle messages with undefined origin prefix', async () => {
      const originConfig = {
        ...config,
        originPrefix: 'eu.de',
      };
      
      const originConsumer = new EventConsumer(originConfig);
      await originConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      // Test with message with undefined origin prefix
      const messageWithUndefinedOrigin: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          originPrefix: undefined,
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await wrappedHandler(messageWithUndefinedOrigin, { topic: 'test' });
      expect(mockMessageHandler).not.toHaveBeenCalled();
    });

    it('should handle validation failures in strict mode', async () => {
      const strictConfig = {
        ...config,
        validationMode: 'strict' as const,
      };
      
      const strictConsumer = new EventConsumer(strictConfig);
      await strictConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      // Mock validator to return validation failure
      (mockValidator.validate as jest.Mock).mockReturnValueOnce({ 
        valid: false, 
        error: 'Invalid user data' 
      });
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { invalidData: 'test' },
      };
      
      await expect(wrappedHandler(message, { topic: 'test' }))
        .rejects.toThrow('Validation failed: Invalid user data');
    });

    it('should handle validation failures in warn mode', async () => {
      const warnConfig = {
        ...config,
        validationMode: 'warn' as const,
      };
      
      const warnConsumer = new EventConsumer(warnConfig);
      await warnConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      // Mock validator to return validation failure
      (mockValidator.validate as jest.Mock).mockReturnValueOnce({ 
        valid: false, 
        error: 'Invalid user data' 
      });
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { invalidData: 'test' },
      };
      
      // Should not throw in warn mode
      await wrappedHandler(message, { topic: 'test' });
      expect(mockMessageHandler).toHaveBeenCalledWith(message, { topic: 'test' });
    });

    it('should handle validation failures in ignore mode', async () => {
      const ignoreConfig = {
        ...config,
        validationMode: 'ignore' as const,
      };
      
      const ignoreConsumer = new EventConsumer(ignoreConfig);
      await ignoreConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { invalidData: 'test' },
      };
      
      // Should not validate in ignore mode
      await wrappedHandler(message, { topic: 'test' });
      expect(mockMessageHandler).toHaveBeenCalledWith(message, { topic: 'test' });
      expect(mockValidator.validate).not.toHaveBeenCalled();
    });

    it('should handle handler errors and update stats', async () => {
      const errorHandler: MessageHandler<any> = jest.fn().mockRejectedValue(new Error('Handler error'));
      
      await consumer.subscribe('user.created', errorHandler);
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      // In strict mode, the error should be thrown
      await expect(wrappedHandler(message, { topic: 'test' }))
        .rejects.toThrow('Handler error');
      
      const stats = consumer.getStats();
      expect(stats.failedMessages).toBe(1);
      expect(stats.lastError).toBe('Handler error');
    });

    it('should handle handler errors in non-strict mode', async () => {
      const nonStrictConfig = {
        ...config,
        validationMode: 'warn' as const,
      };
      
      const errorHandler: MessageHandler<any> = jest.fn().mockRejectedValue(new Error('Handler error'));
      
      const nonStrictConsumer = new EventConsumer(nonStrictConfig);
      await nonStrictConsumer.subscribe('user.created', errorHandler);
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      // In non-strict mode, the error should not be thrown
      await wrappedHandler(message, { topic: 'test' });
      
      const stats = nonStrictConsumer.getStats();
      expect(stats.failedMessages).toBe(1);
      expect(stats.lastError).toBe('Handler error');
    });
  });

  describe('Poison Message Handling', () => {
    it('should handle poison messages with handler', async () => {
      const poisonHandler = jest.fn().mockResolvedValue(undefined);
      const poisonConfig = {
        ...config,
        poisonMessageHandler: poisonHandler,
        validationMode: 'warn' as const, // Use warn mode to allow poison message handling
      };
      
      const poisonConsumer = new EventConsumer(poisonConfig);
      await poisonConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      // Mock validator to return validation failure
      (mockValidator.validate as jest.Mock).mockReturnValueOnce({ 
        valid: false, 
        error: 'Invalid user data' 
      });
      
      await wrappedHandler(message, { topic: 'test' });
      
      expect(poisonHandler).toHaveBeenCalledWith(message, expect.any(Error), { topic: 'test' });
      
      const stats = poisonConsumer.getStats();
      expect(stats.poisonMessages).toBe(1);
    });

    it('should handle poison messages without handler', async () => {
      const noHandlerConfig = {
        ...config,
        poisonMessageHandler: undefined,
        validationMode: 'warn' as const, // Use warn mode to allow poison message handling
      };
      
      const noHandlerConsumer = new EventConsumer(noHandlerConfig);
      await noHandlerConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      // Mock validator to return validation failure
      (mockValidator.validate as jest.Mock).mockReturnValueOnce({ 
        valid: false, 
        error: 'Invalid user data' 
      });
      
      await wrappedHandler(message, { topic: 'test' });
      
      const stats = noHandlerConsumer.getStats();
      expect(stats.poisonMessages).toBe(1);
    });

    it('should handle poison message handler errors', async () => {
      const errorPoisonHandler = jest.fn().mockRejectedValue(new Error('Poison handler error'));
      const errorPoisonConfig = {
        ...config,
        poisonMessageHandler: errorPoisonHandler,
        validationMode: 'warn' as const, // Use warn mode to allow poison message handling
      };
      
      const errorPoisonConsumer = new EventConsumer(errorPoisonConfig);
      await errorPoisonConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      // Mock validator to return validation failure
      (mockValidator.validate as jest.Mock).mockReturnValueOnce({ 
        valid: false, 
        error: 'Invalid user data' 
      });
      
      await wrappedHandler(message, { topic: 'test' });
      
      expect(errorPoisonHandler).toHaveBeenCalled();
      const stats = errorPoisonConsumer.getStats();
      expect(stats.poisonMessages).toBe(1);
    });
  });

  describe('Pattern Handler Wrapping', () => {
    it('should wrap pattern handlers correctly', async () => {
      const advancedTransport = {
        ...mockTransport,
        subscribePattern: jest.fn().mockResolvedValue(undefined),
      };
      
      const advancedConfig = {
        ...config,
        transports: new Map([['default', advancedTransport]]),
      };
      
      const advancedConsumer = new EventConsumer(advancedConfig);
      await advancedConsumer.subscribePattern('user.*', mockPatternHandler);
      
      const wrappedHandler = (advancedTransport.subscribePattern as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await wrappedHandler(message, { topic: 'test' }, 'user.*');
      expect(mockPatternHandler).toHaveBeenCalledWith(message, { topic: 'test' }, 'user.*');
    });

    it('should handle pattern handler errors', async () => {
      const errorPatternHandler: PatternHandler<any> = jest.fn().mockRejectedValue(new Error('Pattern handler error'));
      
      const advancedTransport = {
        ...mockTransport,
        subscribePattern: jest.fn().mockResolvedValue(undefined),
      };
      
      const advancedConfig = {
        ...config,
        transports: new Map([['default', advancedTransport]]),
      };
      
      const advancedConsumer = new EventConsumer(advancedConfig);
      await advancedConsumer.subscribePattern('user.*', errorPatternHandler);
      
      const wrappedHandler = (advancedTransport.subscribePattern as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await expect(wrappedHandler(message, { topic: 'test' }, 'user.*'))
        .rejects.toThrow('Pattern handler error');
      
      const stats = advancedConsumer.getStats();
      expect(stats.failedMessages).toBe(1);
    });

    it('should update pattern subscription message count', async () => {
      const advancedTransport = {
        ...mockTransport,
        subscribePattern: jest.fn().mockResolvedValue(undefined),
      };
      
      const advancedConfig = {
        ...config,
        transports: new Map([['default', advancedTransport]]),
      };
      
      const advancedConsumer = new EventConsumer(advancedConfig);
      await advancedConsumer.subscribePattern('user.*', mockPatternHandler);
      
      const wrappedHandler = (advancedTransport.subscribePattern as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await wrappedHandler(message, { topic: 'test' }, 'user.*');
      
      const subscriptions = advancedConsumer.getSubscriptions();
      const patternSubscription = subscriptions.find(s => s.isPattern);
      expect(patternSubscription?.messageCount).toBe(1);
    });
  });

  describe('Statistics and Metrics', () => {
    it('should update statistics correctly for regular messages', async () => {
      await consumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await wrappedHandler(message, { topic: 'test' });
      // Small delay to ensure processing time > 0
      await new Promise(resolve => setTimeout(resolve, 1));
      
      const stats = consumer.getStats();
      expect(stats.totalMessagesReceived).toBe(1);
      expect(stats.totalMessagesReceivedByType['user.created']).toBe(1);
      expect(stats.totalMessagesReceivedByTransport['default']).toBe(1);
      expect(stats.totalMessagesReceivedByTopic['user.created']).toBe(1);
      expect(stats.averageProcessingTime).toBeGreaterThan(0);
      expect(stats.lastMessageTime).toBeDefined();
    });

    it('should update subscription message count', async () => {
      await consumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await wrappedHandler(message, { topic: 'test' });
      
      const subscriptions = consumer.getSubscriptions();
      const subscription = subscriptions.find(s => s.eventType === 'user.created');
      expect(subscription?.messageCount).toBe(1);
    });

    it('should handle multiple messages and update averages', async () => {
      await consumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      // Send multiple messages with small delays to ensure processing time > 0
      await wrappedHandler(message, { topic: 'test' });
      await new Promise(resolve => setTimeout(resolve, 1));
      await wrappedHandler(message, { topic: 'test' });
      await new Promise(resolve => setTimeout(resolve, 1));
      await wrappedHandler(message, { topic: 'test' });
      
      const stats = consumer.getStats();
      expect(stats.totalMessagesReceived).toBe(3);
      expect(stats.averageProcessingTime).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle messages with missing header properties', async () => {
      await consumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const invalidMessage = {
        header: {
          id: '1',
          type: 'user.created',
          // Missing other required properties
        },
        body: { userId: '123' },
      } as any;
      
      // Should handle gracefully without crashing
      await expect(wrappedHandler(invalidMessage, { topic: 'test' })).resolves.not.toThrow();
    });

    it('should handle messages with null/undefined body', async () => {
      await consumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const messageWithNullBody: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: null as any,
      };
      
      await wrappedHandler(messageWithNullBody, { topic: 'test' });
      expect(mockMessageHandler).toHaveBeenCalledWith(messageWithNullBody, { topic: 'test' });
    });

    it('should handle validation mode changes', async () => {
      const configurableConsumer = new EventConsumer({
        ...config,
        validationMode: 'warn' as const,
      });
      
      await configurableConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      // Should work in warn mode
      await wrappedHandler(message, { topic: 'test' });
      expect(mockMessageHandler).toHaveBeenCalled();
    });

    it('should handle unsubscribe pattern with non-advanced transport', async () => {
      const nonAdvancedTransport = {
        ...mockTransport,
        // No subscribePattern or unsubscribePattern methods
      };
      
      const nonAdvancedConfig = {
        ...config,
        transports: new Map([['default', nonAdvancedTransport]]),
      };
      
      const nonAdvancedConsumer = new EventConsumer(nonAdvancedConfig);
      
      // Should not throw when unsubscribing pattern from non-advanced transport
      await expect(nonAdvancedConsumer.unsubscribePattern('test.*')).resolves.not.toThrow();
    });

    it('should handle unsubscribe pattern when transport has unsubscribePattern but not subscribePattern', async () => {
      const partialAdvancedTransport = {
        ...mockTransport,
        unsubscribePattern: jest.fn().mockResolvedValue(undefined),
        // Missing subscribePattern
      };
      
      const partialConfig = {
        ...config,
        transports: new Map([['default', partialAdvancedTransport]]),
      };
      
      const partialConsumer = new EventConsumer(partialConfig);
      
      // Should not throw
      await expect(partialConsumer.unsubscribePattern('test.*')).resolves.not.toThrow();
    });

    it('should handle messages with undefined origins array', async () => {
      const undefinedOriginsConfig = {
        ...config,
        origins: undefined,
        originPrefix: 'eu.de',
      };
      
      const undefinedOriginsConsumer = new EventConsumer(undefinedOriginsConfig);
      await undefinedOriginsConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          originPrefix: 'eu.de',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await wrappedHandler(message, { topic: 'test' });
      expect(mockMessageHandler).toHaveBeenCalledWith(message, { topic: 'test' });
    });

    it('should handle messages with empty origins array', async () => {
      const emptyOriginsConfig = {
        ...config,
        origins: [],
        // Remove originPrefix to test empty origins array logic
      };
      
      const emptyOriginsConsumer = new EventConsumer(emptyOriginsConfig);
      await emptyOriginsConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          originPrefix: 'eu.de',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      await wrappedHandler(message, { topic: 'test' });
      expect(mockMessageHandler).toHaveBeenCalledWith(message, { topic: 'test' });
    });

    it('should handle poison message handler errors gracefully', async () => {
      const errorPoisonHandler = jest.fn().mockRejectedValue(new Error('Poison handler error'));
      const errorPoisonConfig = {
        ...config,
        poisonMessageHandler: errorPoisonHandler,
        validationMode: 'warn' as const, // Use warn mode to allow poison message handling
      };
      
      const errorPoisonConsumer = new EventConsumer(errorPoisonConfig);
      await errorPoisonConsumer.subscribe('user.created', mockMessageHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      // Mock validator to return validation failure
      (mockValidator.validate as jest.Mock).mockReturnValueOnce({ 
        valid: false, 
        error: 'Invalid user data' 
      });
      
      await wrappedHandler(message, { topic: 'test' });
      
      expect(errorPoisonHandler).toHaveBeenCalled();
      const stats = errorPoisonConsumer.getStats();
      expect(stats.poisonMessages).toBe(1);
    });

    it('should handle non-strict validation mode error handling', async () => {
      const nonStrictConfig = {
        ...config,
        validationMode: 'warn' as const,
      };
      
      const errorHandler: MessageHandler<any> = jest.fn().mockRejectedValue(new Error('Handler error'));
      
      const nonStrictConsumer = new EventConsumer(nonStrictConfig);
      await nonStrictConsumer.subscribe('user.created', errorHandler);
      
      const wrappedHandler = (mockTransport.subscribe as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      // In non-strict mode, the error should not be thrown
      await wrappedHandler(message, { topic: 'test' });
      
      const stats = nonStrictConsumer.getStats();
      expect(stats.failedMessages).toBe(1);
      expect(stats.lastError).toBe('Handler error');
    });

    it('should handle pattern handler errors in non-strict mode', async () => {
      const nonStrictConfig = {
        ...config,
        validationMode: 'warn' as const,
      };
      
      const errorPatternHandler: PatternHandler<any> = jest.fn().mockRejectedValue(new Error('Pattern handler error'));
      
      const advancedTransport = {
        ...mockTransport,
        subscribePattern: jest.fn().mockResolvedValue(undefined),
      };
      
      const nonStrictAdvancedConfig = {
        ...nonStrictConfig,
        transports: new Map([['default', advancedTransport]]),
      };
      
      const nonStrictAdvancedConsumer = new EventConsumer(nonStrictAdvancedConfig);
      await nonStrictAdvancedConsumer.subscribePattern('user.*', errorPatternHandler);
      
      const wrappedHandler = (advancedTransport.subscribePattern as jest.Mock).mock.calls[0][1];
      
      const message: EventEnvelope = {
        header: {
          id: '1',
          type: 'user.created',
          origin: 'user-service',
          timestamp: new Date().toISOString(),
          hash: 'hash',
          version: '1.0.0',
        },
        body: { userId: '123' },
      };
      
      // In non-strict mode, the error should not be thrown
      await wrappedHandler(message, { topic: 'test' }, 'user.*');
      
      const stats = nonStrictAdvancedConsumer.getStats();
      expect(stats.failedMessages).toBe(1);
    });
  });
});
