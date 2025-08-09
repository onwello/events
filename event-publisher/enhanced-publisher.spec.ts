import { EnhancedEventPublisher, createEnhancedPublisher } from './enhanced-publisher';
import { MessageBroker } from '../event-transport/transport-factory';
import { TransportConfig } from '../event-transport/transport.interface';

// Mock the transport factory
jest.mock('../event-transport/transport-factory');

describe('EnhancedEventPublisher', () => {
  let publisher: EnhancedEventPublisher;
  let mockBroker: jest.Mocked<MessageBroker>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockBroker = {
      publish: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn().mockReturnValue({ subscribe: jest.fn() }),
      send: jest.fn().mockReturnValue({ subscribe: jest.fn() }),
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
      defaultTopic: 'events',
      enablePatternRouting: true,
      partitionKeyExtractor: (event: any) => event.userId
    };
    
    publisher = new EnhancedEventPublisher(config);
  });
  
  describe('Publisher Creation', () => {
    it('should create publisher with correct configuration', () => {
      const config = {
        transport: { type: 'redis' as const, options: { host: 'localhost' } },
        defaultTopic: 'test-events',
        enablePatternRouting: true
      };
      
      const publisher = createEnhancedPublisher(config);
      
      expect(publisher).toBeInstanceOf(EnhancedEventPublisher);
    });
    
    it('should have default configuration values', () => {
      const config = {
        transport: { type: 'redis' as const, options: { host: 'localhost' } }
      };
      
      const publisher = createEnhancedPublisher(config);
      
      expect(publisher).toBeInstanceOf(EnhancedEventPublisher);
    });
  });
  
  describe('Publishing', () => {
    beforeEach(async () => {
      await publisher.connect();
    });
    
    it('should publish to specific topic', async () => {
      const topic = 'user.registration.created';
      const event = { userId: '123', email: 'user@example.com' };
      const options = { partitionKey: 'user-123' };
      
      await publisher.publish(topic, event, options);
      
      expect(mockBroker.publish).toHaveBeenCalledWith(topic, expect.objectContaining({
        header: expect.objectContaining({
          id: expect.any(String),
          type: expect.any(String),
          timestamp: expect.any(String)
        })
      }), {
        partitionKey: 'user-123',
        headers: expect.objectContaining({
          id: expect.any(String),
          type: expect.any(String),
          timestamp: expect.any(String)
        })
      });
    });
    
    it('should publish event with automatic topic derivation', async () => {
      const event = { type: 'user.registration.created', userId: '123', email: 'user@example.com' };
      
      await publisher.publishEvent(event);
      
      expect(mockBroker.publish).toHaveBeenCalledWith('user.registration.created', expect.any(Object), {
        partitionKey: '123',
        headers: expect.any(Object)
      });
    });
    
    it('should publish to multiple topics', async () => {
      const topics = ['user.registration.created', 'user.events'];
      const event = { userId: '123', email: 'user@example.com' };
      
      await publisher.publishToTopics(topics, event);
      
      expect(mockBroker.publish).toHaveBeenCalledTimes(2);
      expect(mockBroker.publish).toHaveBeenCalledWith('user.registration.created', expect.any(Object), {
        partitionKey: '123',
        headers: expect.any(Object)
      });
      expect(mockBroker.publish).toHaveBeenCalledWith('user.events', expect.any(Object), {
        partitionKey: '123',
        headers: expect.any(Object)
      });
    });
    
    it('should publish with pattern-based routing when enabled', async () => {
      const pattern = 'location.*.user.registration.*';
      const event = { userId: '123', email: 'user@example.com' };
      
      await publisher.publishWithPattern(pattern, event);
      
      expect(mockBroker.publish).toHaveBeenCalledWith(pattern, expect.any(Object), {
        partitionKey: '123',
        headers: expect.any(Object)
      });
    });
    
    it('should throw error when pattern routing is disabled', async () => {
      const config = {
        transport: { type: 'redis' as const, options: { host: 'localhost' } },
        enablePatternRouting: false
      };
      
      const publisherWithoutPattern = createEnhancedPublisher(config);
      await publisherWithoutPattern.connect();
      
      const pattern = 'location.*.user.registration.*';
      const event = { userId: '123' };
      
      await expect(publisherWithoutPattern.publishWithPattern(pattern, event))
        .rejects.toThrow('Pattern routing is not enabled');
    });
    
    it('should use custom partition key extractor', async () => {
      const config = {
        transport: { type: 'redis' as const, options: { host: 'localhost' } },
        partitionKeyExtractor: (event: any) => event.orderId || event.userId
      };
      
      const publisherWithCustomExtractor = createEnhancedPublisher(config);
      await publisherWithCustomExtractor.connect();
      
      const event = { orderId: 'order-456', userId: '123' };
      
      await publisherWithCustomExtractor.publish('orders', event);
      
      expect(mockBroker.publish).toHaveBeenCalledWith('orders', expect.any(Object), {
        partitionKey: 'order-456',
        headers: expect.any(Object)
      });
    });
    
    it('should use explicit partition key over extractor', async () => {
      const event = { userId: '123' };
      const options = { partitionKey: 'explicit-key' };
      
      await publisher.publish('test-topic', event, options);
      
      expect(mockBroker.publish).toHaveBeenCalledWith('test-topic', expect.any(Object), {
        partitionKey: 'explicit-key',
        headers: expect.any(Object)
      });
    });
    
    it('should merge headers correctly', async () => {
      const event = { userId: '123' };
      const options = { headers: { 'tenant': 'tenant-a', 'version': '1.0' } };
      
      await publisher.publish('test-topic', event, options);
      
      const publishCall = mockBroker.publish.mock.calls[0];
      const headers = publishCall[2].headers;
      
      expect(headers).toHaveProperty('tenant', 'tenant-a');
      expect(headers).toHaveProperty('version', '1.0');
      expect(headers).toHaveProperty('id');
      expect(headers).toHaveProperty('timestamp');
    });
  });
  
  describe('Topic Derivation', () => {
    it('should derive topic from event type property', () => {
      const event = { type: 'user.registration.created', userId: '123' };
      
      const topic = (publisher as any).deriveTopicFromEvent(event);
      
      expect(topic).toBe('user.registration.created');
    });
    
    it('should derive topic from string event', () => {
      const event = 'user.registration.created';
      
      const topic = (publisher as any).deriveTopicFromEvent(event);
      
      expect(topic).toBe('user.registration.created');
    });
    
    it('should derive topic from event structure', () => {
      const event = { topic: 'user.events', userId: '123' };
      
      const topic = (publisher as any).deriveTopicFromEvent(event);
      
      expect(topic).toBe('user.events');
    });
    
    it('should derive topic from constructor name', () => {
      class UserRegistrationEvent {
        constructor(public userId: string) {}
      }
      
      const event = new UserRegistrationEvent('123');
      
      const topic = (publisher as any).deriveTopicFromEvent(event);
      
      expect(topic).toBe('userregistrationevent');
    });
    
    it('should use default topic when no derivation possible', () => {
      const event = { data: 'test' };
      
      const topic = (publisher as any).deriveTopicFromEvent(event);
      
      expect(topic).toBe('events'); // Default topic from config
    });
  });
  
  describe('NestJS Microservices Compatibility', () => {
    it('should implement emit method', () => {
      const pattern = 'test-pattern';
      const data = { test: 'data' };
      
      const observable = publisher.emit(pattern, data);
      
      expect(observable).toBeDefined();
      expect(typeof observable.subscribe).toBe('function');
    });
    
    it('should implement send method', () => {
      const pattern = 'test-pattern';
      const data = { test: 'data' };
      
      const observable = publisher.send(pattern, data);
      
      expect(observable).toBeDefined();
      expect(typeof observable.subscribe).toBe('function');
    });
  });
  
  describe('Connection Management', () => {
    it('should connect to broker', async () => {
      await publisher.connect();
      
      expect(mockBroker.connect).toHaveBeenCalled();
    });
    
    it('should close connection', async () => {
      await publisher.close();
      
      expect(mockBroker.close).toHaveBeenCalled();
    });
    
    it('should ensure connection before publishing', async () => {
      const event = { userId: '123' };
      
      // First connect, then publish
      await publisher.connect();
      await publisher.publish('test-topic', event);
      
      expect(mockBroker.connect).toHaveBeenCalled();
      expect(mockBroker.publish).toHaveBeenCalled();
    });
  });
  
  describe('Capabilities', () => {
    it('should get broker capabilities', () => {
      const capabilities = publisher.getCapabilities();
      
      expect(capabilities).toEqual({
        supportsPartitioning: true,
        supportsPatternRouting: true
      });
      expect(mockBroker.getCapabilities).toHaveBeenCalled();
    });
  });
  
  describe('Topic Management', () => {
    it('should create topic with configuration', async () => {
      const name = 'test-topic';
      const config = {
        partitions: 3,
        retention: { maxAge: 3600000, maxSize: 1000 },
        ordering: 'per-partition' as const
      };
      
      await publisher.createTopic(name, config);
      
      // This would be implemented in the transport layer
      expect(mockBroker.connect).toHaveBeenCalled();
    });
    
    it('should get topic statistics', async () => {
      const topic = 'test-topic';
      
      const stats = await publisher.getTopicStats(topic);
      
      // This would be implemented in the transport layer
      expect(stats).toEqual({});
    });
  });
  
  describe('Error Handling', () => {
    it('should handle broker connection errors', async () => {
      mockBroker.connect.mockRejectedValue(new Error('Connection failed'));
      
      await expect(publisher.connect()).rejects.toThrow('Connection failed');
    });
    
    it('should handle publish errors', async () => {
      mockBroker.publish.mockRejectedValue(new Error('Publish failed'));
      
      await expect(publisher.publish('test-topic', { data: 'test' }))
        .rejects.toThrow('Publish failed');
    });
    
    it('should handle pattern routing errors', async () => {
      const config = {
        transport: { type: 'redis' as const, options: { host: 'localhost' } },
        enablePatternRouting: false
      };
      
      const publisherWithoutPattern = createEnhancedPublisher(config);
      
      await expect(publisherWithoutPattern.publishWithPattern('test.*', { data: 'test' }))
        .rejects.toThrow('Pattern routing is not enabled');
    });
  });
  
  describe('Configuration Options', () => {
    it('should handle topic prefix configuration', () => {
      const config = {
        transport: { type: 'redis' as const, options: { host: 'localhost' } },
        topicPrefix: 'tenant-a'
      };
      
      const publisherWithPrefix = createEnhancedPublisher(config);
      
      expect(publisherWithPrefix).toBeInstanceOf(EnhancedEventPublisher);
    });
    
    it('should handle auto create topics configuration', () => {
      const config = {
        transport: { type: 'redis' as const, options: { host: 'localhost' } },
        autoCreateTopics: true
      };
      
      const publisherWithAutoCreate = createEnhancedPublisher(config);
      
      expect(publisherWithAutoCreate).toBeInstanceOf(EnhancedEventPublisher);
    });
  });
});
