import { Redis } from 'ioredis';
import { PartitioningManager, PartitioningConfig, PartitionInfo } from './partitioning-manager';

// Mock Redis
jest.mock('ioredis');

describe('PartitioningManager', () => {
  let manager: PartitioningManager;
  let mockRedis: jest.Mocked<Redis>;
  let config: PartitioningConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = {
      hset: jest.fn(),
      hget: jest.fn(),
      hgetall: jest.fn(),
      incr: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(),
      xadd: jest.fn(),
      xdel: jest.fn(),
      xlen: jest.fn(),
      xread: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      isOpen: true,
      status: 'ready'
    } as any;
    
    config = {
      enabled: true,
      strategy: 'hash',
      partitionCount: 4,
      rebalanceThreshold: 1000,
      rebalanceInterval: 60000,
      partitionKeyExtractor: (message: any) => message.userId || 'default',
      loadBalancing: true,
      autoScaling: true,
      partitionRebalancing: true,
      minPartitions: 2,
      maxPartitions: 16
    };
    
    manager = new PartitioningManager(mockRedis, config);
  });

  describe('Constructor and Initialization', () => {
    it('should create manager with correct configuration', () => {
      expect(manager).toBeInstanceOf(PartitioningManager);
    });

    it('should initialize partitions correctly', () => {
      const partitionInfo = manager.getAllPartitionInfo();
      expect(partitionInfo).toHaveLength(4);
      
      partitionInfo.forEach((partition, index) => {
        expect(partition.id).toBe(index);
        expect(partition.streamName).toBe(`partition-${index}`);
        expect(partition.messageCount).toBe(0);
        expect(partition.consumerCount).toBe(0);
        expect(partition.health).toBe('healthy');
      });
    });

    it('should handle disabled configuration', () => {
      const disabledConfig: PartitioningConfig = { ...config, enabled: false };
      const disabledManager = new PartitioningManager(mockRedis, disabledConfig);
      expect(disabledManager).toBeInstanceOf(PartitioningManager);
    });
  });

  describe('Partition Assignment', () => {
    it('should assign partition using hash strategy', async () => {
      config.strategy = 'hash';
      manager = new PartitioningManager(mockRedis, config);

      const partition1 = await manager.getPartition({ userId: 'user-123' });
      const partition2 = await manager.getPartition({ userId: 'user-456' });

      expect(typeof partition1).toBe('number');
      expect(typeof partition2).toBe('number');
      expect(partition1).toBeGreaterThanOrEqual(0);
      expect(partition1).toBeLessThan(4);
    });

    it('should assign partition using round-robin strategy', async () => {
      config.strategy = 'roundRobin';
      manager = new PartitioningManager(mockRedis, config);

      const partition1 = await manager.getPartition({});
      const partition2 = await manager.getPartition({});
      const partition3 = await manager.getPartition({});

      expect(partition1).toBe(0);
      expect(partition2).toBe(1);
      expect(partition3).toBe(2);
    });

    it('should assign partition using key-based strategy', async () => {
      config.strategy = 'keyBased';
      manager = new PartitioningManager(mockRedis, config);

      const partition1 = await manager.getPartition({ userId: 'user-123' }, 'user-123');
      const partition2 = await manager.getPartition({ userId: 'user-456' }, 'user-456');

      expect(typeof partition1).toBe('number');
      expect(typeof partition2).toBe('number');
    });

    it('should assign partition using dynamic strategy', async () => {
      config.strategy = 'dynamic';
      manager = new PartitioningManager(mockRedis, config);

      const partition1 = await manager.getPartition({ userId: 'user-123' });
      const partition2 = await manager.getPartition({ userId: 'user-456' });

      expect(typeof partition1).toBe('number');
      expect(typeof partition2).toBe('number');
    });

    it('should return 0 when disabled', async () => {
      config.enabled = false;
      manager = new PartitioningManager(mockRedis, config);

      const partition = await manager.getPartition({});
      expect(partition).toBe(0);
    });
  });

  describe('Partition Management', () => {
    it('should create new partition', async () => {
      mockRedis.xadd.mockResolvedValue('1234567890-0');
      
      await manager.createPartition(5);
      
      expect(mockRedis.xadd).toHaveBeenCalledWith('partition-5', '*', 'init', 'true');
    });

    it('should delete partition', async () => {
      mockRedis.del.mockResolvedValue(1);
      
      await manager.deletePartition(1);
      
      expect(mockRedis.del).toHaveBeenCalledWith('partition-1');
    });

    it('should get partition info', () => {
      const partitionInfo = manager.getPartitionInfo(0);
      
      expect(partitionInfo).toBeDefined();
      expect(partitionInfo?.id).toBe(0);
      expect(partitionInfo?.streamName).toBe('partition-0');
    });

    it('should return undefined for non-existent partition', () => {
      const partitionInfo = manager.getPartitionInfo(999);
      expect(partitionInfo).toBeUndefined();
    });
  });

  describe('Load Balancing and Auto-Scaling', () => {
    it('should start auto-scaling when enabled', () => {
      config.autoScaling = true;
      manager = new PartitioningManager(mockRedis, config);
      
      // Auto-scaling should be started in constructor
      expect(manager).toBeInstanceOf(PartitioningManager);
    });

    it('should stop auto-scaling', () => {
      manager.stopAutoScaling();
      // This test verifies the method doesn't throw
      expect(manager).toBeInstanceOf(PartitioningManager);
    });

    it('should update partition metrics', async () => {
      const partitionId = 0;
      const messageCount = 100;
      const consumerCount = 2;

      await manager.updatePartitionMetrics(partitionId, messageCount, consumerCount);

      const partitionInfo = manager.getPartitionInfo(partitionId);
      expect(partitionInfo?.messageCount).toBe(messageCount);
      expect(partitionInfo?.consumerCount).toBe(consumerCount);
    });
  });

  describe('Partitioning Strategy Information', () => {
    it('should return correct strategy capabilities for hash', () => {
      config.strategy = 'hash';
      manager = new PartitioningManager(mockRedis, config);

      const strategy = manager.getPartitioningStrategy();

      expect(strategy.hashBased).toBe(true);
      expect(strategy.roundRobin).toBe(false);
      expect(strategy.keyBased).toBe(false);
      expect(strategy.dynamicPartitioning).toBe(false);
      expect(strategy.partitionRebalancing).toBe(true);
    });

    it('should return correct strategy capabilities for round-robin', () => {
      config.strategy = 'roundRobin';
      manager = new PartitioningManager(mockRedis, config);

      const strategy = manager.getPartitioningStrategy();

      expect(strategy.hashBased).toBe(false);
      expect(strategy.roundRobin).toBe(true);
      expect(strategy.keyBased).toBe(false);
      expect(strategy.dynamicPartitioning).toBe(false);
      expect(strategy.partitionRebalancing).toBe(true);
    });

    it('should return correct strategy capabilities for key-based', () => {
      config.strategy = 'keyBased';
      manager = new PartitioningManager(mockRedis, config);

      const strategy = manager.getPartitioningStrategy();

      expect(strategy.hashBased).toBe(false);
      expect(strategy.roundRobin).toBe(false);
      expect(strategy.keyBased).toBe(true);
      expect(strategy.dynamicPartitioning).toBe(false);
      expect(strategy.partitionRebalancing).toBe(true);
    });

    it('should return correct strategy capabilities for dynamic', () => {
      config.strategy = 'dynamic';
      manager = new PartitioningManager(mockRedis, config);

      const strategy = manager.getPartitioningStrategy();

      expect(strategy.hashBased).toBe(false);
      expect(strategy.roundRobin).toBe(false);
      expect(strategy.keyBased).toBe(false);
      expect(strategy.dynamicPartitioning).toBe(true);
      expect(strategy.partitionRebalancing).toBe(true);
    });
  });

  describe('Partition Health Calculation', () => {
    it('should calculate healthy partition status', () => {
      const partition: PartitionInfo = {
        id: 0,
        streamName: 'partition-0',
        messageCount: 100,
        consumerCount: 2,
        lastMessageTime: Date.now(),
        throughput: 50,
        health: 'healthy'
      };

      // Mock the private method by accessing it through the instance
      const health = (manager as any).calculatePartitionHealth(partition);
      expect(health).toBe('healthy');
    });

    it('should calculate unhealthy partition status', () => {
      const partition: PartitionInfo = {
        id: 0,
        streamName: 'partition-0',
        messageCount: 100,
        consumerCount: 0, // No consumers
        lastMessageTime: Date.now(),
        throughput: 50,
        health: 'healthy'
      };

      const health = (manager as any).calculatePartitionHealth(partition);
      expect(health).toBe('unhealthy');
    });

    it('should calculate degraded partition status', () => {
      const partition: PartitionInfo = {
        id: 0,
        streamName: 'partition-0',
        messageCount: 100,
        consumerCount: 1,
        lastMessageTime: Date.now(),
        throughput: 1500, // High throughput
        health: 'healthy'
      };

      const health = (manager as any).calculatePartitionHealth(partition);
      expect(health).toBe('degraded');
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources properly', async () => {
      await manager.cleanup();
      // This test verifies the method doesn't throw
      expect(manager).toBeInstanceOf(PartitioningManager);
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis errors gracefully', async () => {
      mockRedis.xadd.mockRejectedValue(new Error('Redis connection failed'));
      
      await expect(manager.createPartition(5)).rejects.toThrow('Redis connection failed');
    });

    it('should handle invalid partition ID', async () => {
      // First create partitions to reach the max limit
      for (let i = 4; i < 16; i++) {
        mockRedis.xadd.mockResolvedValue(`1234567890-${i}`);
        await manager.createPartition(i);
      }
      
      // Now try to create one more partition, which should fail
      await expect(manager.createPartition(16)).rejects.toThrow('Maximum partition count');
    });

    it('should handle partition deletion when min partitions reached', async () => {
      // Delete partitions until min is reached
      for (let i = 3; i >= config.minPartitions; i--) {
        await manager.deletePartition(i);
      }
      
      await expect(manager.deletePartition(config.minPartitions - 1))
        .rejects.toThrow(`Cannot delete partition: minimum count (${config.minPartitions}) reached`);
    });

    it('should handle partition deletion when partition is not empty', async () => {
      // Update partition to have messages
      await manager.updatePartitionMetrics(1, 5, 1);
      
      await expect(manager.deletePartition(1))
        .rejects.toThrow('Cannot delete non-empty partition 1');
    });

    it('should handle partition rebalancing when disabled', async () => {
      const noRebalanceConfig = { ...config, partitionRebalancing: false };
      const noRebalanceManager = new PartitioningManager(mockRedis, noRebalanceConfig);
      
      // Should not throw and should return early
      await expect(noRebalanceManager['rebalancePartitions']()).resolves.toBeUndefined();
    });

    it('should handle rebalancing with no partitions', async () => {
      const emptyManager = new PartitioningManager(mockRedis, { ...config, partitionCount: 0 });
      
      // Should not throw when no partitions exist
      await expect(emptyManager['rebalancePartitions']()).resolves.toBeUndefined();
    });

    it('should handle moveMessages with empty stream', async () => {
      mockRedis.xread.mockResolvedValueOnce([]);
      
      // Should not throw when no messages to move
      await expect(manager['moveMessages'](0, 5)).resolves.toBeUndefined();
    });

    it('should handle receiveMessages with no source partitions', async () => {
      // All partitions have 0 load
      for (let i = 0; i < config.partitionCount; i++) {
        manager['partitionLoads'].set(i, 0);
      }
      
      // Should not throw when no source partitions have load
      await expect(manager['receiveMessages'](0, 5)).resolves.toBeUndefined();
    });

    it('should handle partition health calculation edge cases', () => {
      const partition: PartitionInfo = {
        id: 0,
        streamName: 'test',
        messageCount: 0,
        consumerCount: 0,
        lastMessageTime: Date.now(),
        throughput: 0,
        health: 'healthy'
      };
      
      // Test with 0 consumer count
      expect(manager['calculatePartitionHealth'](partition)).toBe('unhealthy');
      
      // Test with high throughput
      partition.consumerCount = 1;
      partition.throughput = 1500;
      expect(manager['calculatePartitionHealth'](partition)).toBe('degraded');
      
      // Test with normal conditions
      partition.throughput = 500;
      expect(manager['calculatePartitionHealth'](partition)).toBe('healthy');
    });
  });
});
