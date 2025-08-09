import { RedisTopicTransport } from './redis-topic-transport';
import { TopicManager } from './topic-manager';
import { TopicRegistry } from './pattern-router';
import Redis from 'ioredis';

// Mock dependencies
jest.mock('ioredis');
jest.mock('./topic-manager');
jest.mock('./pattern-router');

describe('RedisTopicTransport - Safe Tests', () => {
  let transport: RedisTopicTransport;
  let mockRedis: jest.Mocked<Redis>;
  let mockTopicManager: jest.Mocked<TopicManager>;
  let mockTopicRegistry: jest.Mocked<TopicRegistry>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create minimal mock Redis
    mockRedis = {
      xadd: jest.fn().mockResolvedValue('1234567890-0'),
      xgroup: jest.fn().mockResolvedValue('OK'),
      xreadgroup: jest.fn().mockResolvedValue([]),
      xack: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK')
    } as any;
    
    // Create minimal mock TopicManager
    mockTopicManager = {
      topicExists: jest.fn().mockReturnValue(false),
      createTopic: jest.fn().mockResolvedValue(undefined),
      getPartition: jest.fn().mockReturnValue(0),
      getStreamName: jest.fn().mockReturnValue('topic:test:partition:0'),
      getStreamsForTopic: jest.fn().mockReturnValue(['topic:test:partition:0']),
      loadTopicsFromRedis: jest.fn().mockResolvedValue(undefined)
    } as any;
    
    // Create minimal mock TopicRegistry
    mockTopicRegistry = {
      ensureTopicExists: jest.fn().mockResolvedValue(undefined),
      registerTopic: jest.fn().mockResolvedValue(undefined),
      getAllTopics: jest.fn().mockResolvedValue([])
    } as any;
    
    // Mock the constructors
    (TopicManager as jest.MockedClass<typeof TopicManager>).mockImplementation(() => mockTopicManager);
    (TopicRegistry as jest.MockedClass<typeof TopicRegistry>).mockImplementation(() => mockTopicRegistry);
    
    transport = new RedisTopicTransport(mockRedis);
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('Basic Functionality', () => {
    it('should implement all required methods', () => {
      expect(transport.name).toBe('redis');
      expect(typeof transport.publish).toBe('function');
      expect(typeof transport.subscribe).toBe('function');
      expect(typeof transport.connect).toBe('function');
      expect(typeof transport.close).toBe('function');
      expect(typeof transport.getCapabilities).toBe('function');
    });
    
    it('should return correct capabilities', () => {
      const capabilities = transport.getCapabilities();
      
      expect(capabilities).toEqual({
        supportsPartitioning: true,
        supportsOrdering: true,
        supportsDeadLetterQueues: true,
        supportsConsumerGroups: true,
        supportsPatternRouting: true,
        maxMessageSize: 512 * 1024 * 1024,
        maxTopics: 10000
      });
    });
  });
  
  describe('Safe Publishing', () => {
    it('should publish messages to correct stream', async () => {
      const topic = 'test-topic';
      const message = { userId: '123', data: 'test' };
      
      await transport.publish(topic, message);
      
      expect(mockTopicRegistry.ensureTopicExists).toHaveBeenCalledWith(topic);
      expect(mockRedis.xadd).toHaveBeenCalled();
    });
    
    it('should include headers in message envelope', async () => {
      const topic = 'test-topic';
      const message = { data: 'test' };
      const options = { headers: { 'tenant': 'tenant-a' } };
      
      await transport.publish(topic, message, options);
      
      const xaddCall = mockRedis.xadd.mock.calls[0];
      const envelopeData = JSON.parse(xaddCall[3] as string);
      
      expect(envelopeData.headers).toEqual({ 'tenant': 'tenant-a' });
    });
  });
  
  describe('Connection Management', () => {
    it('should connect successfully', async () => {
      await transport.connect();
      expect(mockTopicManager.loadTopicsFromRedis).toHaveBeenCalled();
    });
    
    it('should close connection', async () => {
      await transport.close();
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
  
  describe('Topic Management', () => {
    it('should create topics with configuration', async () => {
      const name = 'test-topic';
      const config = {
        name,
        partitions: 3,
        retention: { maxAge: 3600000, maxSize: 1000 },
        ordering: 'per-partition' as const
      };
      
      await transport.createTopic(name, config);
      
      expect(mockTopicManager.createTopic).toHaveBeenCalledWith(name, config);
      expect(mockTopicRegistry.registerTopic).toHaveBeenCalledWith(name, {
        partitions: config.partitions,
        retention: config.retention,
        ordering: config.ordering
      });
    });
    
    it('should get topic statistics', async () => {
      const topic = 'test-topic';
      const mockStats = {
        topic,
        partitions: 2,
        totalMessages: 100,
        totalSize: 1024,
        oldestMessage: 1234567890,
        newestMessage: 1234567899
      };
      
      mockTopicManager.getTopicStats = jest.fn().mockResolvedValue(mockStats);
      
      const stats = await transport.getTopicStats(topic);
      
      expect(stats).toEqual(mockStats);
      expect(mockTopicManager.getTopicStats).toHaveBeenCalledWith(topic);
    });
    
    it('should list all topics', async () => {
      const mockTopics = ['topic-1', 'topic-2', 'topic-3'];
      
      mockTopicManager.listTopics = jest.fn().mockResolvedValue(mockTopics);
      
      const topics = await transport.listTopics();
      
      expect(topics).toEqual(mockTopics);
      expect(mockTopicManager.listTopics).toHaveBeenCalled();
    });
  });
  
  describe('NestJS Microservices Compatibility', () => {
    it('should implement emit method', () => {
      const pattern = 'test-pattern';
      const data = { test: 'data' };
      
      const observable = transport.emit(pattern, data);
      
      expect(observable).toBeDefined();
      expect(typeof observable.subscribe).toBe('function');
    });
    
    it('should implement send method', () => {
      const pattern = 'test-pattern';
      const data = { test: 'data' };
      
      const observable = transport.send(pattern, data);
      
      expect(observable).toBeDefined();
      expect(typeof observable.subscribe).toBe('function');
    });
  });
  
  describe('Error Handling', () => {
    it('should handle Redis connection errors gracefully', async () => {
      mockRedis.xadd.mockRejectedValue(new Error('Connection failed'));
      
      await expect(transport.publish('test-topic', { data: 'test' }))
        .rejects.toThrow('Connection failed');
    });
    
    it('should handle topic creation errors', async () => {
      mockTopicManager.createTopic.mockRejectedValue(new Error('Topic creation failed'));
      mockTopicManager.topicExists.mockReturnValue(false);
      
      await expect(transport.publish('test-topic', { data: 'test' }))
        .rejects.toThrow('Topic creation failed');
    });
  });
});
