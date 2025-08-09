import { EnhancedEventConsumer, createEnhancedConsumer, ConsumerBuilder } from './enhanced-consumer';
import { MessageBroker } from '../event-transport/transport-factory';
import { TransportConfig, MessageMetadata } from '../event-transport/transport.interface';

// Mock the transport factory
jest.mock('../event-transport/transport-factory');

describe('EnhancedEventConsumer', () => {
  let consumer: EnhancedEventConsumer;
  let mockBroker: jest.Mocked<MessageBroker>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockBroker = {
      subscribe: jest.fn().mockResolvedValue(undefined),
      subscribePattern: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      getCapabilities: jest.fn().mockReturnValue({
        supportsPartitioning: true,
        supportsPatternRouting: true
      })
    } as any;
    
    // Mock the createMessageBroker function
    (require('../event-transport/transport-factory') as any).createMessageBroker = jest.fn().mockReturnValue(mockBroker);
    
    const config = {
      transport: { type: 'redis' as const, options: { host: 'localhost', port: 6379 } },
      consumerId: 'test-consumer',
      groupId: 'test-group',
      enablePatternRouting: true,
      poisonMessageHandler: jest.fn().mockResolvedValue(undefined)
    };
    
    consumer = new EnhancedEventConsumer(config);
  });
  
  describe('Consumer Creation', () => {
    it('should create consumer with correct configuration', () => {
      const config = {
        transport: { type: 'redis' as const, options: { host: 'localhost' } },
        consumerId: 'my-consumer',
        groupId: 'my-group',
        enablePatternRouting: true
      };
      
      const consumer = createEnhancedConsumer(config);
      
      expect(consumer).toBeInstanceOf(EnhancedEventConsumer);
    });
    
    it('should create consumer with builder pattern', () => {
      const transportConfig = { type: 'redis' as const, options: { host: 'localhost' } };
      
      const consumer = new ConsumerBuilder(transportConfig)
        .withConsumerId('builder-consumer')
        .withGroupId('builder-group')
        .withPatternRouting(true)
        .build();
      
      expect(consumer).toBeInstanceOf(EnhancedEventConsumer);
    });
  });
  
  describe('Subscribing', () => {
    beforeEach(async () => {
      await consumer.connect();
    });
    
    it('should subscribe to specific topic', async () => {
      const topic = 'user.registration.created';
      const handler = jest.fn();
      const options = { groupId: 'custom-group', consumerId: 'custom-consumer' };
      
      await consumer.subscribe(topic, handler, options);
      
      expect(mockBroker.subscribe).toHaveBeenCalledWith(topic, expect.any(Function), {
        groupId: 'custom-group',
        consumerId: 'custom-consumer',
        autoOffsetReset: undefined,
        enableAutoCommit: undefined,
        autoCommitInterval: undefined
      });
    });
    
    it('should subscribe to pattern when enabled', async () => {
      const pattern = 'location.*.user.registration.*';
      const handler = jest.fn();
      const options = { groupId: 'pattern-group' };
      
      await consumer.subscribePattern(pattern, handler, options);
      
      expect(mockBroker.subscribePattern).toHaveBeenCalledWith(pattern, expect.any(Function), {
        groupId: 'pattern-group',
        consumerId: 'test-consumer',
        autoOffsetReset: undefined,
        enableAutoCommit: undefined,
        autoCommitInterval: undefined
      });
    });
    
    it('should throw error when pattern routing is disabled', async () => {
      const config = {
        transport: { type: 'redis' as const, options: { host: 'localhost' } },
        enablePatternRouting: false
      };
      
      const consumerWithoutPattern = createEnhancedConsumer(config);
      await consumerWithoutPattern.connect();
      
      const pattern = 'location.*.user.registration.*';
      const handler = jest.fn();
      
      await expect(consumerWithoutPattern.subscribePattern(pattern, handler))
        .rejects.toThrow('Pattern routing is not enabled');
    });
    
    it('should subscribe to multiple topics', async () => {
      const topics = ['user.registration.created', 'user.profile.updated'];
      const handler = jest.fn();
      
      await consumer.subscribeToTopics(topics, handler);
      
      expect(mockBroker.subscribe).toHaveBeenCalledTimes(2);
      expect(mockBroker.subscribe).toHaveBeenCalledWith('user.registration.created', expect.any(Function), {
        groupId: 'test-group',
        consumerId: 'test-consumer',
        autoOffsetReset: undefined,
        enableAutoCommit: undefined,
        autoCommitInterval: undefined
      });
      expect(mockBroker.subscribe).toHaveBeenCalledWith('user.profile.updated', expect.any(Function), {
        groupId: 'test-group',
        consumerId: 'test-consumer',
        autoOffsetReset: undefined,
        enableAutoCommit: undefined,
        autoCommitInterval: undefined
      });
    });
    
    it('should subscribe to multiple patterns', async () => {
      const patterns = ['location.*.user.*', 'order.*.payment.*'];
      const handler = jest.fn();
      
      await consumer.subscribeToPatterns(patterns, handler);
      
      expect(mockBroker.subscribePattern).toHaveBeenCalledTimes(2);
      expect(mockBroker.subscribePattern).toHaveBeenCalledWith('location.*.user.*', expect.any(Function), {
        groupId: 'test-group',
        consumerId: 'test-consumer',
        autoOffsetReset: undefined,
        enableAutoCommit: undefined,
        autoCommitInterval: undefined
      });
      expect(mockBroker.subscribePattern).toHaveBeenCalledWith('order.*.payment.*', expect.any(Function), {
        groupId: 'test-group',
        consumerId: 'test-consumer',
        autoOffsetReset: undefined,
        enableAutoCommit: undefined,
        autoCommitInterval: undefined
      });
    });
    
    it('should use default configuration when options not provided', async () => {
      const topic = 'test-topic';
      const handler = jest.fn();
      
      await consumer.subscribe(topic, handler);
      
      expect(mockBroker.subscribe).toHaveBeenCalledWith(topic, expect.any(Function), {
        groupId: 'test-group',
        consumerId: 'test-consumer',
        autoOffsetReset: undefined,
        enableAutoCommit: undefined,
        autoCommitInterval: undefined
      });
    });
  });
  
  describe('Message Handling', () => {
    it('should wrap handler correctly', async () => {
      const handler = jest.fn();
      const message = { data: { userId: '123' } };
      const metadata: MessageMetadata = {
        topic: 'test-topic',
        partition: 0,
        offset: '1234567890-0',
        timestamp: Date.now(),
        headers: { 'content-type': 'application/json' }
      };
      
      const wrappedHandler = (consumer as any).wrapHandler(handler);
      await wrappedHandler(message, metadata);
      
      expect(handler).toHaveBeenCalledWith({ userId: '123' }, metadata);
    });
    
    it('should handle poison messages', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Processing failed'));
      const message = { data: { userId: '123' } };
      const metadata: MessageMetadata = {
        topic: 'test-topic',
        partition: 0,
        offset: '1234567890-0',
        timestamp: Date.now()
      };
      
      const wrappedHandler = (consumer as any).wrapHandler(handler);
      await wrappedHandler(message, metadata);
      
      expect(consumer['config'].poisonMessageHandler).toHaveBeenCalledWith(message, expect.any(Error));
    });
    
    it('should extract event from envelope', async () => {
      const handler = jest.fn();
      const message = { data: { userId: '123' } };
      const metadata: MessageMetadata = {
        topic: 'test-topic',
        partition: 0,
        offset: '1234567890-0',
        timestamp: Date.now()
      };
      
      const wrappedHandler = (consumer as any).wrapHandler(handler);
      await wrappedHandler(message, metadata);
      
      expect(handler).toHaveBeenCalledWith({ userId: '123' }, metadata);
    });
    
    it('should handle messages without envelope', async () => {
      const handler = jest.fn();
      const message = { userId: '123' };
      const metadata: MessageMetadata = {
        topic: 'test-topic',
        partition: 0,
        offset: '1234567890-0',
        timestamp: Date.now()
      };
      
      const wrappedHandler = (consumer as any).wrapHandler(handler);
      await wrappedHandler(message, metadata);
      
      expect(handler).toHaveBeenCalledWith({ userId: '123' }, metadata);
    });
  });
  
  describe('Consumer Management', () => {
    it('should unsubscribe from topic', async () => {
      const topic = 'test-topic';
      const handler = jest.fn();
      
      await consumer.subscribe(topic, handler);
      expect(consumer.isSubscribedToTopic(topic)).toBe(true);
      
      await consumer.unsubscribe(topic);
      expect(consumer.isSubscribedToTopic(topic)).toBe(false);
    });
    
    it('should unsubscribe from pattern', async () => {
      const pattern = 'test.*';
      const handler = jest.fn();
      
      await consumer.subscribePattern(pattern, handler);
      expect(consumer.isSubscribedToPattern(pattern)).toBe(true);
      
      await consumer.unsubscribePattern(pattern);
      expect(consumer.isSubscribedToPattern(pattern)).toBe(false);
    });
    
    it('should get subscribed topics', () => {
      const topics = ['topic-1', 'topic-2'];
      const handler = jest.fn();
      
      topics.forEach(topic => {
        consumer['handlers'].set(topic, handler);
      });
      
      const subscribedTopics = consumer.getSubscribedTopics();
      expect(subscribedTopics).toEqual(topics);
    });
    
    it('should get subscribed patterns', () => {
      const patterns = ['pattern-1', 'pattern-2'];
      const handler = jest.fn();
      
      patterns.forEach(pattern => {
        consumer['patternHandlers'].set(pattern, handler);
      });
      
      const subscribedPatterns = consumer.getSubscribedPatterns();
      expect(subscribedPatterns).toEqual(patterns);
    });
    
    it('should check subscription status', () => {
      const topic = 'test-topic';
      const pattern = 'test.*';
      const handler = jest.fn();
      
      consumer['handlers'].set(topic, handler);
      consumer['patternHandlers'].set(pattern, handler);
      
      expect(consumer.isSubscribedToTopic(topic)).toBe(true);
      expect(consumer.isSubscribedToTopic('non-existent')).toBe(false);
      expect(consumer.isSubscribedToPattern(pattern)).toBe(true);
      expect(consumer.isSubscribedToPattern('non-existent')).toBe(false);
    });
  });
  
  describe('Connection Management', () => {
    it('should connect to broker', async () => {
      await consumer.connect();
      
      expect(mockBroker.connect).toHaveBeenCalled();
    });
    
    it('should close connection', async () => {
      await consumer.close();
      
      expect(mockBroker.close).toHaveBeenCalled();
    });
  });
  
  describe('Capabilities', () => {
    it('should get broker capabilities', () => {
      const capabilities = consumer.getCapabilities();
      
      expect(capabilities).toEqual({
        supportsPartitioning: true,
        supportsPatternRouting: true
      });
      expect(mockBroker.getCapabilities).toHaveBeenCalled();
    });
  });
  
  describe('ConsumerBuilder', () => {
    it('should build consumer with all options', () => {
      const transportConfig = { type: 'redis' as const, options: { host: 'localhost' } };
      
      const consumer = new ConsumerBuilder(transportConfig)
        .withConsumerId('custom-consumer')
        .withGroupId('custom-group')
        .withAutoOffsetReset('earliest')
        .withPatternRouting(true)
        .withPoisonMessageHandler(jest.fn())
        .build();
      
      expect(consumer).toBeInstanceOf(EnhancedEventConsumer);
    });
    
    it('should have default configuration', () => {
      const transportConfig = { type: 'redis' as const, options: { host: 'localhost' } };
      
      const consumer = new ConsumerBuilder(transportConfig).build();
      
      expect(consumer).toBeInstanceOf(EnhancedEventConsumer);
    });
  });
  
  describe('Error Handling', () => {
    it('should handle broker connection errors', async () => {
      mockBroker.connect.mockRejectedValue(new Error('Connection failed'));
      
      await expect(consumer.connect()).rejects.toThrow('Connection failed');
    });
    
    it('should handle subscription errors', async () => {
      mockBroker.subscribe.mockRejectedValue(new Error('Subscription failed'));
      
      await expect(consumer.subscribe('test-topic', jest.fn()))
        .rejects.toThrow('Subscription failed');
    });
    
    it('should handle pattern subscription errors', async () => {
      mockBroker.subscribePattern.mockRejectedValue(new Error('Pattern subscription failed'));
      
      await expect(consumer.subscribePattern('test.*', jest.fn()))
        .rejects.toThrow('Pattern subscription failed');
    });
    
    it('should handle poison message handler errors', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Processing failed'));
      const poisonHandler = jest.fn().mockRejectedValue(new Error('Poison handler failed'));
      
      const config = {
        transport: { type: 'redis' as const, options: { host: 'localhost' } },
        poisonMessageHandler: poisonHandler
      };
      
      const consumerWithPoisonHandler = createEnhancedConsumer(config);
      
      const message = { data: { userId: '123' } };
      const metadata: MessageMetadata = {
        topic: 'test-topic',
        partition: 0,
        offset: '1234567890-0',
        timestamp: Date.now()
      };
      
      const wrappedHandler = (consumerWithPoisonHandler as any).wrapHandler(handler);
      
      // Should not throw error even if poison handler fails
      await expect(wrappedHandler(message, metadata)).resolves.not.toThrow();
    });
  });
  
  describe('Configuration Options', () => {
    it('should handle auto offset reset configuration', () => {
      const transportConfig = { type: 'redis' as const, options: { host: 'localhost' } };
      
      const consumer = new ConsumerBuilder(transportConfig)
        .withAutoOffsetReset('earliest')
        .build();
      
      expect(consumer).toBeInstanceOf(EnhancedEventConsumer);
    });
    
    it('should handle auto commit configuration', () => {
      const transportConfig = { type: 'redis' as const, options: { host: 'localhost' } };
      
      const consumer = new ConsumerBuilder(transportConfig)
        .build();
      
      expect(consumer).toBeInstanceOf(EnhancedEventConsumer);
    });
  });
});
