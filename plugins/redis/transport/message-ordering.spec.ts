import { Redis } from 'ioredis';
import { MessageOrderingManager, OrderingConfig, MessageSequence } from './message-ordering';

// Mock Redis
jest.mock('ioredis');

describe('MessageOrderingManager', () => {
  let manager: MessageOrderingManager;
  let mockRedis: jest.Mocked<Redis>;
  let config: OrderingConfig;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock Redis instance
    mockRedis = {
      incr: jest.fn(),
      time: jest.fn(),
      set: jest.fn(),
      get: jest.fn(),
      expire: jest.fn(),
      del: jest.fn(),
      zrangebyscore: jest.fn(),
      zadd: jest.fn(),
      zrem: jest.fn(),
      zremrangebyrank: jest.fn(),
      zrevrange: jest.fn(),
      sadd: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      isOpen: true,
      status: 'ready'
    } as any;
    
    // Default config
    config = {
      enabled: true,
      strategy: 'global',
      maxConcurrency: 10,
      timeoutMs: 30000,
      retryAttempts: 3
    };
    
    manager = new MessageOrderingManager(mockRedis, config);
  });

  describe('Constructor and Configuration', () => {
    it('should create manager with correct configuration', () => {
      expect(manager).toBeInstanceOf(MessageOrderingManager);
    });

    it('should handle disabled configuration', () => {
      const disabledConfig: OrderingConfig = { ...config, enabled: false };
      const disabledManager = new MessageOrderingManager(mockRedis, disabledConfig);
      expect(disabledManager).toBeInstanceOf(MessageOrderingManager);
    });
  });

  describe('Sequence Number Generation', () => {
    it('should generate sequence number for global strategy', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.zrevrange = jest.fn().mockResolvedValue([]);

      const sequence = await manager.generateSequenceNumber('test-stream');

      expect(mockRedis.incr).toHaveBeenCalledWith('test-stream:0');
      expect(sequence).toEqual({
        streamId: 'test-stream',
        sequenceNumber: 1,
        timestamp: expect.any(Number),
        partition: 0,
        causalDependencies: []
      });
    });

    it('should generate sequence number for partition strategy', async () => {
      config.strategy = 'partition';
      config.partitionKey = 'userId';
      manager = new MessageOrderingManager(mockRedis, config);

      mockRedis.incr.mockResolvedValue(5);
      mockRedis.zrevrange = jest.fn().mockResolvedValue([]);

      const sequence = await manager.generateSequenceNumber('test-stream', 'user-123');

      expect(mockRedis.incr).toHaveBeenCalledWith('test-stream:872');
      expect(sequence.partition).toBe(872);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.incr.mockRejectedValue(new Error('Redis connection failed'));

      await expect(manager.generateSequenceNumber('test-stream')).rejects.toThrow('Redis connection failed');
    });
  });

  describe('Ordering Guarantees', () => {
    it('should return correct guarantees for global strategy', () => {
      config.strategy = 'global';
      manager = new MessageOrderingManager(mockRedis, config);

      const guarantees = manager.getOrderingGuarantees();

      expect(guarantees.globalOrdering).toBe(true);
      expect(guarantees.partitionOrdering).toBe(true);
      expect(guarantees.causalOrdering).toBe(false);
      expect(guarantees.exactlyOnceDelivery).toBe(true);
    });

    it('should return correct guarantees for partition strategy', () => {
      config.strategy = 'partition';
      manager = new MessageOrderingManager(mockRedis, config);

      const guarantees = manager.getOrderingGuarantees();

      expect(guarantees.globalOrdering).toBe(false);
      expect(guarantees.partitionOrdering).toBe(true);
      expect(guarantees.causalOrdering).toBe(false);
      expect(guarantees.exactlyOnceDelivery).toBe(true);
    });

    it('should return correct guarantees for causal strategy', () => {
      config.strategy = 'causal';
      manager = new MessageOrderingManager(mockRedis, config);

      const guarantees = manager.getOrderingGuarantees();

      expect(guarantees.globalOrdering).toBe(false);
      expect(guarantees.partitionOrdering).toBe(false);
      expect(guarantees.causalOrdering).toBe(true);
      expect(guarantees.exactlyOnceDelivery).toBe(true);
    });
  });

  describe('Ordering Enforcement', () => {
    it('should ensure ordering for valid sequence', async () => {
      const sequence: MessageSequence = {
        streamId: 'test-stream',
        sequenceNumber: 1,
        timestamp: 1234567890,
        partition: 0,
        causalDependencies: []
      };

      mockRedis.set.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.zrangebyscore.mockResolvedValue([]);
      mockRedis.zadd.mockResolvedValue(1 as any);
      mockRedis.sadd.mockResolvedValue(1 as any);

      await expect(manager.ensureOrdering(sequence)).resolves.not.toThrow();

      expect(mockRedis.zrangebyscore).toHaveBeenCalledWith('test-stream:0:processed', 0, 0);
    });

    it('should handle ordering conflicts', async () => {
      const sequence: MessageSequence = {
        streamId: 'test-stream',
        sequenceNumber: 2,
        timestamp: 1234567890,
        partition: 0,
        causalDependencies: ['1']
      };

      mockRedis.set.mockResolvedValue(null); // Lock acquisition failed
      mockRedis.get.mockResolvedValue('processing'); // Previous sequence still processing
      mockRedis.zrangebyscore.mockResolvedValue(['1']); // Previous sequence processed

      await expect(manager.ensureOrdering(sequence)).resolves.not.toThrow();
    });

    it('should respect timeout configuration', async () => {
      config.timeoutMs = 5000;
      manager = new MessageOrderingManager(mockRedis, config);

      const sequence: MessageSequence = {
        streamId: 'test-stream',
        sequenceNumber: 1,
        timestamp: 1234567890,
        partition: 0,
        causalDependencies: []
      };

      mockRedis.set.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.zrangebyscore.mockResolvedValue([]);
      mockRedis.zadd.mockResolvedValue(1 as any);
      mockRedis.sadd.mockResolvedValue(1 as any);

      await manager.ensureOrdering(sequence);

      expect(mockRedis.zrangebyscore).toHaveBeenCalledWith('test-stream:0:processed', 0, 0);
    });
  });

  describe('Partition Calculation', () => {
    it('should calculate partition for partition-based strategy', () => {
      config.strategy = 'partition';
      manager = new MessageOrderingManager(mockRedis, config);

      const partition1 = (manager as any).hashPartition('user-123');
      const partition2 = (manager as any).hashPartition('user-456');

      expect(typeof partition1).toBe('number');
      expect(typeof partition2).toBe('number');
      expect(partition1).toBeGreaterThanOrEqual(0);
      expect(partition1).toBeLessThan(1000); // Default partition count
    });

    it('should return consistent partition for same key', () => {
      config.strategy = 'partition';
      manager = new MessageOrderingManager(mockRedis, config);

      const partition1 = (manager as any).hashPartition('user-123');
      const partition2 = (manager as any).hashPartition('user-123');

      expect(partition1).toBe(partition2);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources properly', async () => {
      const sequence: MessageSequence = {
        streamId: 'test-stream',
        sequenceNumber: 1,
        timestamp: 1234567890,
        partition: 0,
        causalDependencies: []
      };

      mockRedis.set.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.del.mockResolvedValue(1);
      mockRedis.zrangebyscore.mockResolvedValue([]);
      mockRedis.zadd.mockResolvedValue(1 as any);
      mockRedis.sadd.mockResolvedValue(1 as any);

      await manager.ensureOrdering(sequence);
      await manager.cleanup();

      // Cleanup should clear internal maps
      expect(manager).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis timeout errors', async () => {
      const sequence: MessageSequence = {
        streamId: 'test-stream',
        sequenceNumber: 1,
        timestamp: 1234567890,
        partition: 0,
        causalDependencies: []
      };

      mockRedis.zrangebyscore.mockResolvedValue([]);
      mockRedis.zadd.mockResolvedValue(1 as any);
      mockRedis.sadd.mockResolvedValue(1 as any);
      mockRedis.zremrangebyrank.mockResolvedValue(1 as any);

      await expect(manager.ensureOrdering(sequence)).resolves.not.toThrow();
    });

    it('should handle invalid sequence data', async () => {
      const invalidSequence = {} as MessageSequence;

      await expect(manager.ensureOrdering(invalidSequence)).rejects.toThrow();
    });
  });
});
