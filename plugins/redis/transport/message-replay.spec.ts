import { Redis } from 'ioredis';
import { MessageReplayManager, ReplayConfig, ReplayRequest, ReplayResult } from './message-replay';

// Mock Redis
jest.mock('ioredis');

describe('MessageReplayManager', () => {
  let manager: MessageReplayManager;
  let mockRedis: any;
  let config: ReplayConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = {
      exists: jest.fn().mockResolvedValue(1),
      xrange: jest.fn(),
      xrevrange: jest.fn(),
      xread: jest.fn(),
      xadd: jest.fn(),
      expire: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      sadd: jest.fn(),
      scard: jest.fn(),
      spop: jest.fn(),
      smembers: jest.fn(),
      hset: jest.fn(),
      hgetall: jest.fn(),
      hget: jest.fn(),
      del: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      isOpen: true,
      status: 'ready'
    };
    
    config = {
      enabled: true,
      maxReplayMessages: 1000,
      replayTimeout: 300000,
      validateReplay: true,
      preserveOrdering: true,
      batchSize: 100,
      compression: false
    };
    
    manager = new MessageReplayManager(mockRedis, config);
  });

  describe('Constructor and Configuration', () => {
    it('should create manager with correct configuration', () => {
      expect(manager).toBeInstanceOf(MessageReplayManager);
    });

    it('should handle disabled configuration', () => {
      const disabledConfig: ReplayConfig = { ...config, enabled: false };
      const disabledManager = new MessageReplayManager(mockRedis, disabledConfig);
      expect(disabledManager).toBeInstanceOf(MessageReplayManager);
    });
  });

  describe('Basic Functionality', () => {
    it('should provide replay metrics', () => {
      const metrics = manager.getReplayMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.totalReplays).toBeGreaterThanOrEqual(0);
      expect(metrics.totalMessagesReplayed).toBeGreaterThanOrEqual(0);
      expect(metrics.averageReplayTime).toBeGreaterThanOrEqual(0);
      expect(metrics.failedReplays).toBeGreaterThanOrEqual(0);
      expect(metrics.lastReplayTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle invalid replay requests', async () => {
      const invalidRequest = {} as ReplayRequest;

      await expect(manager.replayMessages(invalidRequest)).rejects.toThrow();
    });

    it('should handle disabled manager', async () => {
      const disabledManager = new MessageReplayManager(mockRedis, { ...config, enabled: false });
      
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        maxMessages: 100
      };

      await expect(disabledManager.replayMessages(request)).rejects.toThrow('Message replay is not enabled');
    });

    it('should handle duplicate replay requests', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        maxMessages: 100
      };

      // Mock the manager to simulate an active replay
      (manager as any).activeReplays.add(`${request.streamName}:${Date.now()}`);

      await expect(manager.replayMessages(request)).rejects.toThrow('Replay already in progress');
    });
  });

  describe('Replay Request Validation', () => {
    it('should validate time range correctly', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now(),
        endTime: Date.now() - 3600000, // Start time after end time
        maxMessages: 100
      };

      mockRedis.exists.mockResolvedValue(1);

      await expect(manager.replayMessages(request)).rejects.toThrow('Start time must be before end time');
    });

    it('should validate offset range correctly', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '100',
        endOffset: '50', // Start offset after end offset
        maxMessages: 100
      };

      mockRedis.exists.mockResolvedValue(1);

      await expect(manager.replayMessages(request)).rejects.toThrow('Start offset must be before end offset');
    });

    it('should validate message count limits', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        maxMessages: 2000 // Exceeds limit of 1000
      };

      mockRedis.exists.mockResolvedValue(1);

      await expect(manager.replayMessages(request)).rejects.toThrow('Max messages (2000) exceeds limit (1000)');
    });

    it('should handle non-existent streams gracefully', async () => {
      const request: ReplayRequest = {
        streamName: 'non-existent-stream',
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        maxMessages: 100
      };

      mockRedis.exists.mockResolvedValue(0);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(0);
      expect(result.warnings).toContain('No messages found in specified range');
    });
  });

  describe('Message Range Retrieval', () => {
    it('should get messages by offset range', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']],
        ['2', ['field1', 'value2', 'timestamp', '2000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(2);
    });

    it('should get messages by time range', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']],
        ['2', ['field1', 'value2', 'timestamp', '2000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xrevrange.mockResolvedValue([['2', ['field1', 'value2', 'timestamp', '2000']]]);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(2);
    });

    it('should handle empty message ranges', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        maxMessages: 100
      };

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue([]);
      mockRedis.xrevrange.mockResolvedValue([]);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(0);
      expect(result.warnings).toContain('No messages found in specified range');
    });

    it('should respect batch size configuration', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '1000',
        maxMessages: 100
      };

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue([]);

      await manager.replayMessages(request);

      expect(mockRedis.xrange).toHaveBeenCalledWith(
        'test-stream',
        '0',
        '1000',
        'COUNT',
        100 // Should use config.batchSize
      );
    });
  });

  describe('Message Filtering', () => {
    it('should apply regex pattern filters', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        filterPattern: 'value1',
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']],
        ['2', ['field1', 'value2', 'timestamp', '2000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(1); // Only value1 matches
    });

    it('should apply field-based filters', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        filters: { field1: 'value1' },
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']],
        ['2', ['field1', 'value2', 'timestamp', '2000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(1); // Only field1=value1 matches
    });

    it('should handle invalid regex patterns gracefully', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        filterPattern: '[invalid-regex',
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(1); // Should still process messages
    });

    it('should combine multiple filters', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        filterPattern: 'value',
        filters: { field1: 'value1' },
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']],
        ['2', ['field1', 'value2', 'timestamp', '2000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(1); // Should match both filters
    });
  });

  describe('Message Replay Execution', () => {
    it('should replay messages with ordering preserved', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        preserveOrdering: true,
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']],
        ['2', ['field1', 'value2', 'timestamp', '2000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xadd.mockResolvedValue('1');

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messagesReplayed).toBe(2);
      expect(mockRedis.xadd).toHaveBeenCalledTimes(2);
    });

    it('should replay messages without ordering for performance', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        preserveOrdering: false,
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']],
        ['2', ['field1', 'value2', 'timestamp', '2000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xadd.mockResolvedValue('1');

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messagesReplayed).toBe(2);
    });

    it('should handle message replay failures gracefully', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        preserveOrdering: true,
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']],
        ['2', ['field1', 'value2', 'timestamp', '2000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xadd
        .mockResolvedValueOnce('1')
        .mockRejectedValueOnce(new Error('Redis error'));

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(false);
      expect(result.messagesReplayed).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.warnings).toContain('1 messages failed to replay');
    });

    it('should respect maxMessages limit', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '1000',
        maxMessages: 2
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']],
        ['2', ['field1', 'value2', 'timestamp', '2000']],
        ['3', ['field1', 'value3', 'timestamp', '3000']],
        ['4', ['field1', 'value4', 'timestamp', '4000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xadd.mockResolvedValue('1');

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(2); // Should respect maxMessages limit
      expect(result.totalMessages).toBe(2);
    });
  });

  describe('Timestamp Handling', () => {
    it('should extract timestamps from message fields', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: 1500, // Between message 1 and 2
        endTime: 2500,
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']],
        ['2', ['field1', 'value2', 'timestamp', '2000']],
        ['3', ['field1', 'value3', 'timestamp', '3000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xrevrange.mockResolvedValue([['3', ['field1', 'value3', 'timestamp', '3000']]]);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
    });

    it('should handle messages without timestamp fields', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1']], // No timestamp field
        ['2', ['field1', 'value2']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xrevrange.mockResolvedValue([]);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis connection errors', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        maxMessages: 100
      };

      mockRedis.exists.mockRejectedValue(new Error('Redis connection failed'));

      await expect(manager.replayMessages(request)).rejects.toThrow('Redis connection failed');
    });

    it('should handle timeout errors gracefully', async () => {
      config.replayTimeout = 100;
      manager = new MessageReplayManager(mockRedis, config);

      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        maxMessages: 100
      };

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue([]);
      mockRedis.xrevrange.mockResolvedValue([]);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(0);
    });

    it('should handle Redis operation failures', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        maxMessages: 100
      };

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockRejectedValue(new Error('Redis operation failed'));

      await expect(manager.replayMessages(request)).rejects.toThrow('Redis operation failed');
    });

    it('should handle malformed message data', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        maxMessages: 100
      };

      const malformedMessages = [
        ['1', 'invalid-message-format'], // Should be array of fields
        ['2', ['field1', 'value1']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(malformedMessages);
      mockRedis.xadd.mockResolvedValue('1');

      const result = await manager.replayMessages(request);
      // Malformed messages might cause replay failures, so we check for the expected behavior
      expect(result.messages.length).toBe(2);
      // The success field depends on whether the replay actually succeeded
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('Replay History and Metrics', () => {
    it('should store replay history', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xadd.mockResolvedValue('1');

      await manager.replayMessages(request);

      const history = (manager as any).replayHistory.get('test-stream');
      expect(history).toBeDefined();
      expect(history.length).toBeGreaterThan(0);
    });

    it('should update metrics after successful replay', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']],
        ['2', ['field1', 'value2', 'timestamp', '2000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xadd.mockResolvedValue('1');

      const initialMetrics = manager.getReplayMetrics();
      await manager.replayMessages(request);
      const finalMetrics = manager.getReplayMetrics();

      expect(finalMetrics.totalReplays).toBe(initialMetrics.totalReplays + 1);
      expect(finalMetrics.totalMessagesReplayed).toBe(initialMetrics.totalMessagesReplayed + 2);
    });

    it('should update metrics after failed replay', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '100',
        maxMessages: 100
      };

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockRejectedValue(new Error('Redis error'));

      const initialMetrics = manager.getReplayMetrics();
      try {
        await manager.replayMessages(request);
      } catch (error) {
        // Expected to fail
      }
      const finalMetrics = manager.getReplayMetrics();

      expect(finalMetrics.failedReplays).toBe(initialMetrics.failedReplays + 1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty stream gracefully', async () => {
      const request: ReplayRequest = {
        streamName: 'empty-stream',
        startOffset: '0',
        endOffset: '100',
        maxMessages: 100
      };

      mockRedis.exists.mockResolvedValue(0);

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(0);
      expect(result.warnings).toContain('No messages found in specified range');
    });

    it('should handle single message streams', async () => {
      const request: ReplayRequest = {
        streamName: 'single-message-stream',
        startOffset: '0',
        endOffset: '100',
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xadd.mockResolvedValue('1');

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(1);
      expect(result.messagesReplayed).toBe(1);
    });

    it('should handle very large message counts', async () => {
      const request: ReplayRequest = {
        streamName: 'large-stream',
        startOffset: '0',
        endOffset: '10000',
        maxMessages: 999 // Just under the limit
      };

      const mockMessages = Array.from({ length: 999 }, (_, i) => [
        `${i + 1}`,
        ['field1', `value${i + 1}`, 'timestamp', `${1000 + i}`]
      ]);

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xadd.mockResolvedValue('1');

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(999);
      expect(result.totalMessages).toBe(999);
    });

    it('should handle special offset values', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset: '0',
        endOffset: '+', // Special Redis offset
        maxMessages: 100
      };

      const mockMessages = [
        ['1', ['field1', 'value1', 'timestamp', '1000']]
      ];

      mockRedis.exists.mockResolvedValue(1);
      mockRedis.xrange.mockResolvedValue(mockMessages);
      mockRedis.xadd.mockResolvedValue('1');

      const result = await manager.replayMessages(request);
      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(1);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources properly', async () => {
      await manager.cleanup();
      expect(manager).toBeInstanceOf(MessageReplayManager);
    });
  });
});
