import { TopicManager, TopicConfig, TopicStats } from './topic-manager';
import Redis from 'ioredis';

// Mock Redis for testing
jest.mock('ioredis');

describe('TopicManager', () => {
  let topicManager: TopicManager;
  let mockRedis: jest.Mocked<Redis>;
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create mock Redis instance
    mockRedis = {
      hset: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      hkeys: jest.fn().mockResolvedValue([]),
      hdel: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
      xinfo: jest.fn().mockResolvedValue([0, 0]), // [groups, length, ...]
      xrange: jest.fn().mockResolvedValue([]),
      xrevrange: jest.fn().mockResolvedValue([])
    } as any;
    
    topicManager = new TopicManager(mockRedis);
  });
  
  describe('Topic Creation and Management', () => {
    it('should create a topic with configuration', async () => {
      const topicName = 'test-topic';
      const config: TopicConfig = {
        name: topicName,
        partitions: 3,
        retention: {
          maxAge: 24 * 60 * 60 * 1000,
          maxSize: 10000
        },
        ordering: 'per-partition'
      };
      
      await topicManager.createTopic(topicName, config);
      
      expect(mockRedis.hset).toHaveBeenCalledWith(
        'topic:metadata',
        topicName,
        expect.stringContaining(topicName)
      );
      
      expect(topicManager.topicExists(topicName)).toBe(true);
      expect(topicManager.getTopicConfig(topicName)).toEqual(config);
    });
    
    it('should get stream names for topics', () => {
      const topicName = 'test-topic';
      const config: TopicConfig = {
        name: topicName,
        partitions: 3,
        retention: { maxAge: 3600000, maxSize: 1000 },
        ordering: 'per-partition'
      };
      
      topicManager.createTopic(topicName, config);
      
      const streams = topicManager.getStreamsForTopic(topicName);
      expect(streams).toHaveLength(3);
      expect(streams[0]).toBe('topic:test-topic:partition:0');
      expect(streams[1]).toBe('topic:test-topic:partition:1');
      expect(streams[2]).toBe('topic:test-topic:partition:2');
    });
    
    it('should get stream name for specific partition', () => {
      const streamName = topicManager.getStreamName('test-topic', 1);
      expect(streamName).toBe('topic:test-topic:partition:1');
    });
    
    it('should throw error for non-existent topic', () => {
      expect(() => topicManager.getStreamsForTopic('non-existent')).toThrow('Topic non-existent not found');
    });
  });
  
  describe('Partitioning', () => {
    beforeEach(() => {
      const config: TopicConfig = {
        name: 'test-topic',
        partitions: 3,
        retention: { maxAge: 3600000, maxSize: 1000 },
        ordering: 'per-partition'
      };
      topicManager.createTopic('test-topic', config);
    });
    
    it('should partition by partition key consistently', () => {
      const message = { userId: 'user-123' };
      const options = { partitionKey: 'user-123' };
      
      const partition1 = topicManager.getPartition('test-topic', message, options);
      const partition2 = topicManager.getPartition('test-topic', message, options);
      
      expect(partition1).toBe(partition2); // Consistent hashing
      expect(partition1).toBeGreaterThanOrEqual(0);
      expect(partition1).toBeLessThan(3);
    });
    
    it('should partition by explicit partition number', () => {
      const message = { userId: 'user-123' };
      const options = { partition: 2 };
      
      const partition = topicManager.getPartition('test-topic', message, options);
      expect(partition).toBe(2);
    });
    
    it('should use round-robin when no partition key specified', () => {
      const message = { userId: 'user-123' };
      
      const partition = topicManager.getPartition('test-topic', message);
      expect(partition).toBeGreaterThanOrEqual(0);
      expect(partition).toBeLessThan(3);
    });
    
    it('should handle partition number larger than partition count', () => {
      const message = { userId: 'user-123' };
      const options = { partition: 5 }; // Larger than 3 partitions
      
      const partition = topicManager.getPartition('test-topic', message, options);
      expect(partition).toBe(2); // 5 % 3 = 2
    });
  });
  
  describe('Topic Listing and Deletion', () => {
    it('should list all topics', async () => {
      const config1: TopicConfig = {
        name: 'topic-1',
        partitions: 1,
        retention: { maxAge: 3600000, maxSize: 1000 },
        ordering: 'per-partition'
      };
      
      const config2: TopicConfig = {
        name: 'topic-2',
        partitions: 2,
        retention: { maxAge: 3600000, maxSize: 1000 },
        ordering: 'per-partition'
      };
      
      await topicManager.createTopic('topic-1', config1);
      await topicManager.createTopic('topic-2', config2);
      
      const topics = await topicManager.listTopics();
      expect(topics).toContain('topic-1');
      expect(topics).toContain('topic-2');
      expect(topics).toHaveLength(2);
    });
    
    it('should delete a topic', async () => {
      const config: TopicConfig = {
        name: 'topic-to-delete',
        partitions: 2,
        retention: { maxAge: 3600000, maxSize: 1000 },
        ordering: 'per-partition'
      };
      
      await topicManager.createTopic('topic-to-delete', config);
      expect(topicManager.topicExists('topic-to-delete')).toBe(true);
      
      await topicManager.deleteTopic('topic-to-delete');
      expect(topicManager.topicExists('topic-to-delete')).toBe(false);
      
      expect(mockRedis.del).toHaveBeenCalledWith('topic:topic-to-delete:partition:0');
      expect(mockRedis.del).toHaveBeenCalledWith('topic:topic-to-delete:partition:1');
      expect(mockRedis.hdel).toHaveBeenCalledWith('topic:metadata', 'topic-to-delete');
    });
    
    it('should throw error when deleting non-existent topic', async () => {
      await expect(topicManager.deleteTopic('non-existent')).rejects.toThrow('Topic non-existent not found');
    });
  });
  
  describe('Topic Loading from Redis', () => {
    it('should load topics from Redis on startup', async () => {
      const mockTopicData = {
        'topic-1': JSON.stringify({
          name: 'topic-1',
          partitions: 2,
          retention: { maxAge: 3600000, maxSize: 1000 },
          ordering: 'per-partition',
          createdAt: Date.now()
        }),
        'topic-2': JSON.stringify({
          name: 'topic-2',
          partitions: 1,
          retention: { maxAge: 3600000, maxSize: 1000 },
          ordering: 'per-partition',
          createdAt: Date.now()
        })
      };
      
      mockRedis.hgetall.mockResolvedValue(mockTopicData);
      
      await topicManager.loadTopicsFromRedis();
      
      expect(topicManager.topicExists('topic-1')).toBe(true);
      expect(topicManager.topicExists('topic-2')).toBe(true);
      expect(topicManager.getTopicConfig('topic-1')?.partitions).toBe(2);
      expect(topicManager.getTopicConfig('topic-2')?.partitions).toBe(1);
    });
    
    it('should handle invalid topic metadata gracefully', async () => {
      const mockTopicData = {
        'valid-topic': JSON.stringify({
          name: 'valid-topic',
          partitions: 1,
          retention: { maxAge: 3600000, maxSize: 1000 },
          ordering: 'per-partition'
        }),
        'invalid-topic': 'invalid-json'
      };
      
      mockRedis.hgetall.mockResolvedValue(mockTopicData);
      
      // Should not throw error
      await expect(topicManager.loadTopicsFromRedis()).resolves.not.toThrow();
      
      expect(topicManager.topicExists('valid-topic')).toBe(true);
      expect(topicManager.topicExists('invalid-topic')).toBe(false);
    });
  });
  
  describe('Topic Statistics', () => {
    beforeEach(() => {
      const config: TopicConfig = {
        name: 'stats-topic',
        partitions: 2,
        retention: { maxAge: 3600000, maxSize: 1000 },
        ordering: 'per-partition'
      };
      topicManager.createTopic('stats-topic', config);
    });
    
    it('should get topic statistics', async () => {
      // Mock stream info responses
      mockRedis.xinfo
        .mockResolvedValueOnce([0, 5]) // partition 0: 5 messages
        .mockResolvedValueOnce([0, 3]); // partition 1: 3 messages
      
      mockRedis.xrange
        .mockResolvedValueOnce([['1234567890-0', ['data', 'message1']]])
        .mockResolvedValueOnce([['1234567890-0', ['data', 'message1']]]);
      
      mockRedis.xrevrange
        .mockResolvedValueOnce([['1234567890-4', ['data', 'message5']]])
        .mockResolvedValueOnce([['1234567890-2', ['data', 'message3']]]);
      
      const stats = await topicManager.getTopicStats('stats-topic');
      
      expect(stats.topic).toBe('stats-topic');
      expect(stats.partitions).toBe(2);
      expect(stats.totalMessages).toBe(8); // 5 + 3
      expect(stats.oldestMessage).toBe(1234567890);
      expect(stats.newestMessage).toBe(1234567890);
    });
    
    it('should handle empty streams gracefully', async () => {
      mockRedis.xinfo
        .mockResolvedValueOnce([0, 0]) // partition 0: 0 messages
        .mockResolvedValueOnce([0, 0]); // partition 1: 0 messages
      
      const stats = await topicManager.getTopicStats('stats-topic');
      
      expect(stats.totalMessages).toBe(0);
      expect(stats.oldestMessage).toBeNull();
      expect(stats.newestMessage).toBeNull();
    });
    
    it('should handle stream not found errors', async () => {
      mockRedis.xinfo.mockRejectedValue(new Error('ERR no such key'));
      
      const stats = await topicManager.getTopicStats('stats-topic');
      
      expect(stats.totalMessages).toBe(0);
      expect(stats.oldestMessage).toBeNull();
      expect(stats.newestMessage).toBeNull();
    });
  });
  
  describe('Error Handling', () => {
    it('should throw error for non-existent topic operations', () => {
      expect(() => topicManager.getPartition('non-existent', {})).toThrow('Topic non-existent not found');
      expect(() => topicManager.getStreamsForTopic('non-existent')).toThrow('Topic non-existent not found');
    });
    
    it('should handle Redis connection errors gracefully', async () => {
      mockRedis.hset.mockRejectedValue(new Error('Connection failed'));
      
      await expect(topicManager.createTopic('test', {
        name: 'test',
        partitions: 1,
        retention: { maxAge: 3600000, maxSize: 1000 },
        ordering: 'per-partition'
      })).rejects.toThrow('Connection failed');
    });
  });
});
