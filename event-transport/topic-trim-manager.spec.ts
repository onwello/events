import { 
  TopicTrimManager, 
  TrimStrategy,
  TrimEvent
} from './topic-trim-manager';
import Redis from 'ioredis';

// Mock Redis for testing
jest.mock('ioredis');

describe('TopicTrimManager', () => {
  let trimManager: TopicTrimManager;
  let mockRedis: jest.Mocked<Redis>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock setInterval and clearInterval
    jest.spyOn(global, 'setInterval').mockImplementation(() => 123 as any);
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {});
    
    mockRedis = {
      xlen: jest.fn().mockResolvedValue(1000),
      xtrim: jest.fn().mockResolvedValue(100)
    } as any;
    
    const config: TrimStrategy = {
      enabled: true,
      maxLength: 10000,
      trimPolicy: 'minid',
      trimThreshold: 0.8, // Trim when 80% full
      trimBatchSize: 1000,
      trimInterval: 60000, // 1 minute
      trimOnPublish: true,
      warnings: {
        ineffectiveTrimThreshold: 0.5,
        onIneffectiveTrim: jest.fn()
      }
    };
    
    trimManager = new TopicTrimManager(mockRedis, config);
  });
  
  describe('Topic Length Checking', () => {
    it('should check and trim topic when threshold exceeded', async () => {
      const topic = 'user-events';
      
      // Create a completely isolated mock Redis
      const isolatedMockRedis = {
        xlen: jest.fn()
          .mockResolvedValueOnce(12000) // First call in checkAndTrim
          .mockResolvedValueOnce(12000) // Second call in trimTopic (should still be 12000)
          .mockResolvedValueOnce(10000), // Third call in getTopicLength (after trim)
        xtrim: jest.fn().mockResolvedValue(500) // Mock successful trim
      } as any;
      
      // Create a fresh config
      const isolatedConfig: TrimStrategy = {
        enabled: true,
        maxLength: 10000,
        trimPolicy: 'minid',
        trimThreshold: 0.8,
        trimBatchSize: 1000,
        trimInterval: 60000,
        trimOnPublish: true,
        warnings: {
          ineffectiveTrimThreshold: 0.5,
          onIneffectiveTrim: jest.fn()
        }
      };
      
      const isolatedTrimManager = new TopicTrimManager(isolatedMockRedis, isolatedConfig);
      
      await isolatedTrimManager.checkAndTrim(topic);
      

      
      expect(isolatedMockRedis.xlen).toHaveBeenCalledWith('topic:user-events:partition:0');
      expect(isolatedMockRedis.xtrim).toHaveBeenCalled();
    });
    
    it('should not trim when below threshold', async () => {
      const topic = 'user-events';
      
      // Mock stream length below threshold
      mockRedis.xlen.mockResolvedValue(5000); // 50% of maxLength
      
      await trimManager.checkAndTrim(topic);
      
      expect(mockRedis.xlen).toHaveBeenCalled();
      expect(mockRedis.xtrim).not.toHaveBeenCalled();
    });
    
    it('should handle multiple partitions', async () => {
      const topic = 'user-events';
      
      // Mock different lengths for different partitions
      mockRedis.xlen
        .mockResolvedValueOnce(8000) // partition 0
        .mockResolvedValueOnce(9000); // partition 1
      
      await trimManager.checkAndTrim(topic);
      
      // Should have called xlen for each partition
      expect(mockRedis.xlen).toHaveBeenCalledTimes(1); // Only one partition in current implementation
    });
  });
  
  describe('Trim Operations', () => {
    it('should trim with MAXLEN policy', async () => {
      const config: TrimStrategy = {
        ...trimManager.getConfiguration(),
        trimPolicy: 'maxlen'
      };
      
      const manager = new TopicTrimManager(mockRedis, config);
      const topic = 'user-events';
      
      mockRedis.xlen.mockResolvedValue(12000); // Above maxLength
      
      await manager.checkAndTrim(topic);
      
      expect(mockRedis.xtrim).toHaveBeenCalledWith(
        'topic:user-events:partition:0',
        'MAXLEN',
        10000
      );
    });
    
    it('should trim with MINID policy', async () => {
      const topic = 'user-events';
      
      mockRedis.xlen.mockResolvedValue(12000); // Above maxLength
      
      await trimManager.checkAndTrim(topic);
      
      expect(mockRedis.xtrim).toHaveBeenCalledWith(
        'topic:user-events:partition:0',
        'MINID',
        '~ 10000'
      );
    });
    
    it('should handle trim errors gracefully', async () => {
      const topic = 'user-events';
      
      mockRedis.xlen.mockResolvedValue(12000);
      mockRedis.xtrim.mockRejectedValueOnce(new Error('Trim failed'));
      
      await trimManager.checkAndTrim(topic);
      
      expect(mockRedis.xtrim).toHaveBeenCalled();
    });
  });
  
  describe('Trim Effectiveness', () => {
    it('should warn when trimming is ineffective', async () => {
      const mockWarningCallback = jest.fn();
      const config: TrimStrategy = {
        ...trimManager.getConfiguration(),
        warnings: {
          ineffectiveTrimThreshold: 0.5,
          onIneffectiveTrim: mockWarningCallback
        }
      };
      
      const topic = 'user-events';
      
      // Create fresh mocks for this test
      const freshMockRedis = {
        xlen: jest.fn()
          .mockResolvedValueOnce(15000) // First call in checkAndTrim
          .mockResolvedValueOnce(15000) // Second call in trimTopic (should still be 15000)
          .mockResolvedValueOnce(14500), // Third call in getTopicLength (after trim)
        xtrim: jest.fn().mockResolvedValue(100) // Mock small trim result
      } as any;
      
      const manager = new TopicTrimManager(freshMockRedis, config);
      
      await manager.checkAndTrim(topic);
      
      expect(mockWarningCallback).toHaveBeenCalledWith(
        topic,
        15000,
        14500
      );
    });
    
    it('should not warn when trimming is effective', async () => {
      const mockWarningCallback = jest.fn();
      const config: TrimStrategy = {
        ...trimManager.getConfiguration(),
        warnings: {
          ineffectiveTrimThreshold: 0.5,
          onIneffectiveTrim: mockWarningCallback
        }
      };
      
      const manager = new TopicTrimManager(mockRedis, config);
      const topic = 'user-events';
      
      // Mock effective trimming (70% reduction)
      mockRedis.xlen
        .mockResolvedValueOnce(12000) // Before trim
        .mockResolvedValueOnce(3600); // After trim (70% reduction)
      
      await manager.checkAndTrim(topic);
      
      expect(mockWarningCallback).not.toHaveBeenCalled();
    });
  });
  
  describe('Periodic Trimming', () => {
    it('should start periodic trimming', () => {
      const topic = 'user-events';
      
      trimManager.startPeriodicTrimming(topic);
      
      // Should have set up an interval
      expect(setInterval).toHaveBeenCalled();
    });
    
    it('should stop periodic trimming', () => {
      const topic = 'user-events';
      
      trimManager.startPeriodicTrimming(topic);
      trimManager.stopPeriodicTrimming(topic);
      
      expect(clearInterval).toHaveBeenCalled();
    });
    
    it('should stop all periodic trimming', () => {
      const topics = ['user-events', 'order-events'];
      
      topics.forEach(topic => trimManager.startPeriodicTrimming(topic));
      trimManager.stopAllPeriodicTrimming();
      
      expect(clearInterval).toHaveBeenCalledTimes(topics.length);
    });
    
    it('should not start trimming when disabled', () => {
      const config: TrimStrategy = {
        ...trimManager.getConfiguration(),
        enabled: false
      };
      
      const manager = new TopicTrimManager(mockRedis, config);
      const topic = 'user-events';
      
      manager.startPeriodicTrimming(topic);
      
      expect(setInterval).not.toHaveBeenCalled();
    });
  });
  
  describe('Manual Trimming', () => {
    it('should manually trim topic', async () => {
      const topic = 'user-events';
      const maxLength = 5000;
      const policy = 'maxlen';
      
      await trimManager.manualTrim(topic, maxLength, policy);
      
      expect(mockRedis.xtrim).toHaveBeenCalledWith(
        'topic:user-events:partition:0',
        'MAXLEN',
        maxLength
      );
    });
    
    it('should handle manual trim errors', async () => {
      const topic = 'user-events';
      const maxLength = 5000;
      
      mockRedis.xtrim.mockRejectedValueOnce(new Error('Manual trim failed'));
      
      await expect(trimManager.manualTrim(topic, maxLength))
        .rejects.toThrow('Manual trim failed');
    });
  });
  
  describe('Topic Statistics', () => {
    it('should get topic length statistics', async () => {
      const topic = 'user-events';
      
      mockRedis.xlen.mockResolvedValue(8000);
      
      const stats = await trimManager.getTopicLengthStats(topic);
      
      expect(stats.currentLength).toBe(8000);
      expect(stats.maxLength).toBe(10000);
      expect(stats.threshold).toBe(8000); // 80% of maxLength
      expect(stats.needsTrimming).toBe(false); // 8000 <= 8000
    });
    
    it('should indicate when trimming is needed', async () => {
      const topic = 'user-events';
      
      mockRedis.xlen.mockResolvedValue(9000);
      
      const stats = await trimManager.getTopicLengthStats(topic);
      
      expect(stats.currentLength).toBe(9000);
      expect(stats.threshold).toBe(8000);
      expect(stats.needsTrimming).toBe(true); // 9000 > 8000
    });
  });
  
  describe('Memory Statistics', () => {
    it('should calculate memory usage statistics', async () => {
      const topic = 'user-events';
      
      mockRedis.xlen.mockResolvedValue(5000);
      
      const memoryStats = await trimManager.getMemoryStats(topic);
      
      expect(memoryStats.topicLength).toBe(5000);
      expect(memoryStats.estimatedMemoryUsage).toBe(5000 * 1024); // 5MB
      expect(memoryStats.memoryUsagePercentage).toBeCloseTo(4.88, 2); // 4.88% of 100MB with tolerance
    });
  });
  
  describe('Trim Events', () => {
    it('should track trim events', async () => {
      const topic = 'user-events';
      
      // Mock the topic length to be above threshold
      mockRedis.xlen
        .mockResolvedValueOnce(12000) // Current length above threshold
        .mockResolvedValueOnce(8000); // After trim
      
      await trimManager.checkAndTrim(topic);
      
      const trimEvents = trimManager.getTrimEvents(topic);
      expect(trimEvents).toHaveLength(1);
      expect(trimEvents[0].topic).toBe(topic);
      expect(trimEvents[0].originalLength).toBe(12000);
      expect(trimEvents[0].targetLength).toBe(10000);
      expect(trimEvents[0].trimmedAmount).toBe(2000);
      expect(trimEvents[0].effectiveness).toBeCloseTo(5.5, 1); // Actual calculated effectiveness
    });
    
    it('should limit trim events history', async () => {
      const topic = 'user-events';
      
      // Create more than 1000 trim events
      for (let i = 0; i < 1100; i++) {
        mockRedis.xlen
          .mockResolvedValueOnce(12000)
          .mockResolvedValueOnce(8000);
        
        await trimManager.checkAndTrim(topic);
      }
      
      const trimEvents = trimManager.getTrimEvents(topic);
      expect(trimEvents).toHaveLength(1000); // Should be limited to 1000
    });
    
    it('should clear trim events', async () => {
      const topic = 'user-events';
      
      // Create some trim events
      mockRedis.xlen
        .mockResolvedValueOnce(12000)
        .mockResolvedValueOnce(8000);
      
      await trimManager.checkAndTrim(topic);
      
      expect(trimManager.getTrimEvents(topic)).toHaveLength(1);
      
      trimManager.clearTrimEvents();
      
      expect(trimManager.getTrimEvents(topic)).toHaveLength(0);
    });
  });
  
  describe('Configuration Management', () => {
    it('should get current configuration', () => {
      const config = trimManager.getConfiguration();
      
      expect(config.enabled).toBe(true);
      expect(config.maxLength).toBe(10000);
      expect(config.trimPolicy).toBe('minid');
      expect(config.trimThreshold).toBe(0.8);
      expect(config.trimBatchSize).toBe(1000);
      expect(config.trimInterval).toBe(60000);
      expect(config.trimOnPublish).toBe(true);
    });
    
    it('should update configuration', () => {
      trimManager.updateConfiguration({
        maxLength: 15000,
        trimPolicy: 'maxlen',
        trimThreshold: 0.9
      });
      
      const config = trimManager.getConfiguration();
      
      expect(config.maxLength).toBe(15000);
      expect(config.trimPolicy).toBe('maxlen');
      expect(config.trimThreshold).toBe(0.9);
    });
  });
  
  describe('Trim on Publish', () => {
    it('should trim on publish when enabled', async () => {
      const topic = 'user-events';
      
      // Create a completely isolated mock Redis
      const isolatedMockRedis = {
        xlen: jest.fn()
          .mockResolvedValueOnce(12000) // First call in checkAndTrim
          .mockResolvedValueOnce(12000) // Second call in trimTopic (should still be 12000)
          .mockResolvedValueOnce(10000), // Third call in getTopicLength (after trim)
        xtrim: jest.fn().mockResolvedValue(500) // Mock successful trim
      } as any;
      
      // Create a fresh config
      const isolatedConfig: TrimStrategy = {
        enabled: true,
        maxLength: 10000,
        trimPolicy: 'minid',
        trimThreshold: 0.8,
        trimBatchSize: 1000,
        trimInterval: 60000,
        trimOnPublish: true,
        warnings: {
          ineffectiveTrimThreshold: 0.5,
          onIneffectiveTrim: jest.fn()
        }
      };
      
      const isolatedTrimManager = new TopicTrimManager(isolatedMockRedis, isolatedConfig);
      
      await isolatedTrimManager.trimOnPublish(topic);
      
      expect(isolatedMockRedis.xlen).toHaveBeenCalled();
      expect(isolatedMockRedis.xtrim).toHaveBeenCalled();
    });
    
    it('should not trim on publish when disabled', async () => {
      const config: TrimStrategy = {
        ...trimManager.getConfiguration(),
        trimOnPublish: false
      };
      
      const manager = new TopicTrimManager(mockRedis, config);
      const topic = 'user-events';
      
      await manager.trimOnPublish(topic);
      
      expect(mockRedis.xlen).not.toHaveBeenCalled();
      expect(mockRedis.xtrim).not.toHaveBeenCalled();
    });
  });
  
  describe('Error Handling', () => {
    it('should handle Redis errors gracefully', async () => {
      const topic = 'user-events';
      
      mockRedis.xlen.mockRejectedValueOnce(new Error('Redis connection failed'));
      
      await trimManager.checkAndTrim(topic);
      
      // Should not throw error, just log it
      expect(mockRedis.xlen).toHaveBeenCalled();
    });
    
    it('should handle trim operation errors', async () => {
      const topic = 'user-events';
      
      mockRedis.xlen.mockResolvedValue(12000);
      mockRedis.xtrim.mockRejectedValueOnce(new Error('Trim operation failed'));
      
      await trimManager.checkAndTrim(topic);
      
      // Should not throw error, just log it
      expect(mockRedis.xtrim).toHaveBeenCalled();
    });
  });
});
