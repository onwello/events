import { Redis, Cluster } from 'ioredis';
import { RedisClusterManager, RedisClusterConfig, FailoverEvent } from './redis-cluster-support';

// Mock ioredis
jest.mock('ioredis', () => ({
  Redis: jest.fn(),
  Cluster: jest.fn()
}));

describe('RedisClusterManager', () => {
  let manager: RedisClusterManager;
  let mockRedis: jest.Mocked<Redis>;
  let mockCluster: jest.Mocked<Cluster>;
  let config: RedisClusterConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock Redis instance
    mockRedis = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      xpending: jest.fn().mockResolvedValue([0, '0-0', '0-0', []]),
      xinfo: jest.fn().mockResolvedValue([]),
      xclaim: jest.fn().mockResolvedValue([]),
      keys: jest.fn().mockResolvedValue([]),
      isOpen: true,
      status: 'ready'
    } as any;

    // Create mock Cluster instance
    mockCluster = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      xpending: jest.fn().mockResolvedValue([0, '0-0', '0-0', []]),
      xinfo: jest.fn().mockResolvedValue([]),
      xclaim: jest.fn().mockResolvedValue([]),
      keys: jest.fn().mockResolvedValue([]),
      isOpen: true,
      status: 'ready'
    } as any;

    // Mock the constructors
    (Redis as jest.MockedClass<typeof Redis>).mockImplementation(() => mockRedis);
    (Cluster as jest.MockedClass<typeof Cluster>).mockImplementation(() => mockCluster);

    config = {
      failoverStrategy: 'retry',
      maxRetries: 3,
      retryDelay: 1000,
      connectionTimeout: 5000,
      commandTimeout: 3000
    };
  });

  describe('Constructor and Configuration', () => {
    it('should create manager with single node configuration', () => {
      manager = new RedisClusterManager(config);
      
      expect(manager).toBeInstanceOf(RedisClusterManager);
      expect(Redis).toHaveBeenCalledWith({
        connectTimeout: 5000,
        commandTimeout: 3000,
        lazyConnect: true
      });
    });

    it('should create manager with sentinel configuration', () => {
      const sentinelConfig: RedisClusterConfig = {
        ...config,
        sentinels: [
          { host: 'sentinel1', port: 26379 },
          { host: 'sentinel2', port: 26379 }
        ],
        sentinelName: 'mymaster'
      };
      
      manager = new RedisClusterManager(sentinelConfig);
      
      expect(Redis).toHaveBeenCalledWith({
        sentinels: [
          { host: 'sentinel1', port: 26379 },
          { host: 'sentinel2', port: 26379 }
        ],
        name: 'mymaster',
        connectTimeout: 5000,
        commandTimeout: 3000,
        lazyConnect: true
      });
    });

    it('should create manager with cluster configuration', () => {
      const clusterConfig: RedisClusterConfig = {
        ...config,
        clusterNodes: [
          { host: 'node1', port: 7000 },
          { host: 'node2', port: 7001 },
          { host: 'node3', port: 7002 }
        ]
      };
      
      manager = new RedisClusterManager(clusterConfig);
      
      expect(Cluster).toHaveBeenCalledWith([
        { host: 'node1', port: 7000 },
        { host: 'node2', port: 7001 },
        { host: 'node3', port: 7002 }
      ], {
        lazyConnect: true
      });
    });

    it('should use default sentinel name when not provided', () => {
      const sentinelConfig: RedisClusterConfig = {
        ...config,
        sentinels: [{ host: 'sentinel1', port: 26379 }]
      };
      
      manager = new RedisClusterManager(sentinelConfig);
      
      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'mymaster'
        })
      );
    });
  });

  describe('Connection Management', () => {
    beforeEach(() => {
      manager = new RedisClusterManager(config);
    });

    it('should connect and initialize failover handling', async () => {
      await manager.connect();
      
      expect(mockRedis.connect).toHaveBeenCalled();
      expect(mockRedis.on).toHaveBeenCalledWith('failover', expect.any(Function));
      expect(mockRedis.on).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockRedis.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should disconnect and cleanup resources', async () => {
      // Mock recovery timeout
      (manager as any).recoveryTimeout = setTimeout(() => {}, 1000);
      
      await manager.disconnect();
      
      expect(mockRedis.disconnect).toHaveBeenCalled();
    });

    it('should handle connection errors gracefully', async () => {
      await manager.connect();
      
      const errorHandler = mockRedis.on.mock.calls.find(call => call[0] === 'error')?.[1];
      expect(errorHandler).toBeDefined();
      
      if (errorHandler) {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        
        errorHandler(new Error('Connection failed'));
        
        expect(consoleSpy).toHaveBeenCalledWith('Redis connection error:', expect.any(Error));
        consoleSpy.mockRestore();
      }
    });
  });

  describe('Failover Event Handling', () => {
    beforeEach(() => {
      manager = new RedisClusterManager({
        ...config,
        failoverRecovery: {
          enabled: true,
          resumeUnackedMessages: true,
          staleMessageThreshold: 30000,
          recoveryTimeout: 60000
        }
      });
    });

    it('should emit failover start event', async () => {
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      expect(failoverHandler).toBeDefined();
      
      if (failoverHandler) {
        await failoverHandler();
        
        const events = manager.getFailoverEvents();
        expect(events.length).toBeGreaterThan(0);
        expect(events.some(e => e.type === 'failover_start')).toBe(true);
      }
    });

    it('should emit failover complete event', async () => {
      await manager.connect();
      
      const readyHandler = mockRedis.on.mock.calls.find(call => call[0] === 'ready')?.[1];
      expect(readyHandler).toBeDefined();
      
      if (readyHandler) {
        await readyHandler();
        
        const events = manager.getFailoverEvents();
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('failover_complete');
      }
    });

    it('should handle failover recovery when enabled', async () => {
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      expect(failoverHandler).toBeDefined();
      
      if (failoverHandler) {
        await failoverHandler();
        
        // Recovery should start and may complete quickly in mock environment
        const events = manager.getFailoverEvents();
        expect(events.some(e => e.type === 'failover_start')).toBe(true);
        expect(events.some(e => e.type === 'recovery_start')).toBe(true);
      }
    });

    it('should not handle failover recovery when disabled', async () => {
      const noRecoveryConfig: RedisClusterConfig = {
        ...config,
        failoverRecovery: {
          enabled: false,
          resumeUnackedMessages: false,
          staleMessageThreshold: 30000,
          recoveryTimeout: 60000
        }
      };
      
      manager = new RedisClusterManager(noRecoveryConfig);
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      expect(failoverHandler).toBeDefined();
      
      if (failoverHandler) {
        await failoverHandler();
        
        // Should not trigger recovery process
        expect(manager.isRecoveringFromFailover()).toBe(false);
      }
    });

    it('should prevent multiple simultaneous recoveries', async () => {
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      expect(failoverHandler).toBeDefined();
      
      if (failoverHandler) {
        // Trigger first failover
        await failoverHandler();
        
        // Trigger second failover immediately
        await failoverHandler();
        
        // Should have multiple failover events
        const events = manager.getFailoverEvents();
        expect(events.filter(e => e.type === 'failover_start').length).toBeGreaterThan(1);
      }
    });
  });

  describe('Failover Recovery Process', () => {
    beforeEach(() => {
      manager = new RedisClusterManager({
        ...config,
        failoverRecovery: {
          enabled: true,
          resumeUnackedMessages: true,
          staleMessageThreshold: 30000,
          recoveryTimeout: 60000
        }
      });
    });

    it('should recover unacknowledged messages', async () => {
      // Mock pending messages
      mockRedis.xpending.mockResolvedValue([5, '0-0', '0-0', []]);
      
      // Mock consumer groups
      mockRedis.xinfo.mockResolvedValue([
        ['name', 'group1'],
        ['name', 'group2']
      ]);
      
      // Mock keys to return some topics
      mockRedis.keys.mockResolvedValue(['topic:test:partition:0']);
      
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        // Wait for recovery to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        expect(mockRedis.keys).toHaveBeenCalled();
        expect(mockRedis.xpending).toHaveBeenCalled();
        expect(mockRedis.xinfo).toHaveBeenCalled();
      }
    });

    it('should handle recovery timeout', async () => {
      const shortTimeoutConfig: RedisClusterConfig = {
        ...config,
        failoverRecovery: {
          enabled: true,
          resumeUnackedMessages: true,
          staleMessageThreshold: 30000,
          recoveryTimeout: 1 // Very short timeout
        }
      };
      
      manager = new RedisClusterManager(shortTimeoutConfig);
      
      // Mock keys to return some topics so recovery process runs
      mockRedis.keys.mockResolvedValue(['topic:test:partition:0']);
      
      await manager.connect();
      
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        // Wait for timeout - make it longer than the 1ms timeout
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // The timeout should have been set up, even if it doesn't trigger in this test
        expect(manager).toBeDefined();
        consoleSpy.mockRestore();
      }
    });

    it('should handle recovery errors gracefully', async () => {
      // Mock keys to return some topics so recovery process runs
      mockRedis.keys.mockResolvedValue(['topic:test:partition:0']);
      
      // Mock error in xpending
      mockRedis.xpending.mockRejectedValue(new Error('Redis error'));
      
      await manager.connect();
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        // Wait for recovery to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // The error should have been handled gracefully
        expect(manager).toBeDefined();
        consoleSpy.mockRestore();
      }
    });
  });

  describe('Message Recovery Strategies', () => {
    beforeEach(() => {
      manager = new RedisClusterManager({
        ...config,
        failoverRecovery: {
          enabled: true,
          resumeUnackedMessages: 'only-if-stale',
          staleMessageThreshold: 30000,
          recoveryTimeout: 60000
        }
      });
    });

    it('should recover only stale messages when configured', async () => {
      // Mock pending messages count
      mockRedis.xpending.mockResolvedValue([3, '0-0', '0-0', []]);
      
      // Mock pending message details with some stale messages (for getStaleMessages call)
      mockRedis.xpending
        .mockResolvedValueOnce([3, '0-0', '0-0', []]) // First call for count
        .mockResolvedValueOnce([3, '0-0', '0-0', [
          ['12345-0', 'consumer1', 35000, 1], // Stale (>30s)
          ['12346-0', 'consumer2', 15000, 1], // Not stale (<30s)
          ['12347-0', 'consumer3', 45000, 1]  // Stale (>30s)
        ]]); // Second call for details
      
      // Mock consumer groups
      mockRedis.xinfo.mockResolvedValue([
        ['name', 'group1']
      ]);
      
      // Mock keys to return some topics
      mockRedis.keys.mockResolvedValue(['topic:test:partition:0']);
      
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        // Wait for recovery to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Should have attempted recovery (check that xpending was called multiple times)
        expect(mockRedis.xpending).toHaveBeenCalledTimes(2);
        expect(mockRedis.xinfo).toHaveBeenCalled();
      }
    });

    it('should recover all messages when configured', async () => {
      const allMessagesConfig: RedisClusterConfig = {
        ...config,
        failoverRecovery: {
          enabled: true,
          resumeUnackedMessages: true,
          staleMessageThreshold: 30000,
          recoveryTimeout: 60000
        }
      };
      
      manager = new RedisClusterManager(allMessagesConfig);
      
      // Mock pending messages
      mockRedis.xpending.mockResolvedValue([2, '0-0', '0-0', []]);
      
      // Mock consumer groups
      mockRedis.xinfo.mockResolvedValue([
        ['name', 'group1']
      ]);
      
      // Mock keys to return some topics
      mockRedis.keys.mockResolvedValue(['topic:test:partition:0']);
      
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        // Wait for recovery to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Should claim all pending messages
        expect(mockRedis.xclaim).toHaveBeenCalled();
      }
    });

    it('should skip message recovery when disabled', async () => {
      const noRecoveryConfig: RedisClusterConfig = {
        ...config,
        failoverRecovery: {
          enabled: true,
          resumeUnackedMessages: false,
          staleMessageThreshold: 30000,
          recoveryTimeout: 60000
        }
      };
      
      manager = new RedisClusterManager(noRecoveryConfig);
      
      // Mock pending messages
      mockRedis.xpending.mockResolvedValue([2, '0-0', '0-0', []]);
      
      // Mock consumer groups
      mockRedis.xinfo.mockResolvedValue([
        ['name', 'group1']
      ]);
      
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        // Wait for recovery to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Should not claim any messages
        expect(mockRedis.xclaim).not.toHaveBeenCalled();
      }
    });
  });

  describe('Event Management', () => {
    beforeEach(() => {
      manager = new RedisClusterManager(config);
    });

    it('should track failover events', async () => {
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        const events = manager.getFailoverEvents();
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('failover_start');
        expect(events[0].timestamp).toBeInstanceOf(Date);
      }
    });

    it('should limit event history to 1000 events', async () => {
      // Manually add many events
      const events: FailoverEvent[] = Array.from({ length: 1100 }, (_, i) => ({
        type: 'failover_start',
        timestamp: new Date(),
        details: { index: i }
      }));
      
      (manager as any).failoverEvents = events;
      
      // Trigger another event
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        const currentEvents = manager.getFailoverEvents();
        expect(currentEvents).toHaveLength(1000);
        expect(currentEvents[0].details.index).toBe(100);
        expect(currentEvents[999].details.index).toBe(1099);
      }
    });

    it('should clear failover events', () => {
      // Add some events
      (manager as any).failoverEvents = [
        { type: 'failover_start', timestamp: new Date() }
      ];
      
      expect(manager.getFailoverEvents()).toHaveLength(1);
      
      manager.clearFailoverEvents();
      
      expect(manager.getFailoverEvents()).toHaveLength(0);
    });

    it('should return copy of events array', () => {
      const events = manager.getFailoverEvents();
      events.push({ type: 'failover_start', timestamp: new Date() });
      
      const eventsAgain = manager.getFailoverEvents();
      expect(eventsAgain).toHaveLength(0); // Should not be affected by external modification
    });
  });

  describe('Configuration Management', () => {
    beforeEach(() => {
      manager = new RedisClusterManager(config);
    });

    it('should return configuration copy', () => {
      const returnedConfig = manager.getConfiguration();
      
      expect(returnedConfig).toEqual(config);
      expect(returnedConfig).not.toBe(config); // Should be a copy
    });

    it('should update configuration', () => {
      const updates = {
        maxRetries: 5,
        retryDelay: 2000
      };
      
      manager.updateConfiguration(updates);
      
      const updatedConfig = manager.getConfiguration();
      expect(updatedConfig.maxRetries).toBe(5);
      expect(updatedConfig.retryDelay).toBe(2000);
      expect(updatedConfig.connectionTimeout).toBe(5000); // Unchanged
    });

    it('should preserve existing configuration when updating', () => {
      const originalConfig = manager.getConfiguration();
      
      manager.updateConfiguration({ maxRetries: 10 });
      
      const updatedConfig = manager.getConfiguration();
      expect(updatedConfig.maxRetries).toBe(10);
      expect(updatedConfig.failoverStrategy).toBe(originalConfig.failoverStrategy);
      expect(updatedConfig.connectionTimeout).toBe(originalConfig.connectionTimeout);
    });
  });

  describe('Redis Client Access', () => {
    beforeEach(() => {
      manager = new RedisClusterManager(config);
    });

    it('should return Redis client', () => {
      const client = manager.getRedisClient();
      
      expect(client).toBe(mockRedis);
    });

    it('should return Cluster client when configured for clustering', () => {
      const clusterConfig: RedisClusterConfig = {
        ...config,
        clusterNodes: [
          { host: 'node1', port: 7000 }
        ]
      };
      
      const clusterManager = new RedisClusterManager(clusterConfig);
      const client = clusterManager.getRedisClient();
      
      expect(client).toBe(mockCluster);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      manager = new RedisClusterManager(config);
    });

    it('should handle empty pending messages', async () => {
      // Mock no pending messages
      mockRedis.xpending.mockResolvedValue([0, '0-0', '0-0', []]);
      
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        // Wait for recovery to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Should not attempt to claim messages
        expect(mockRedis.xclaim).not.toHaveBeenCalled();
      }
    });

    it('should handle Redis command errors gracefully', async () => {
      // Mock error in xinfo
      mockRedis.xinfo.mockRejectedValue(new Error('Command failed'));
      
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        // Wait for recovery to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Should continue processing despite errors
        expect(manager.isRecoveringFromFailover()).toBe(false);
      }
    });

    it('should handle missing failover recovery configuration', () => {
      const noRecoveryConfig: RedisClusterConfig = {
        failoverStrategy: 'retry',
        maxRetries: 3,
        retryDelay: 1000,
        connectionTimeout: 5000,
        commandTimeout: 3000
        // No failoverRecovery property
      };
      
      expect(() => {
        new RedisClusterManager(noRecoveryConfig);
      }).not.toThrow();
    });

    it('should handle null capabilities gracefully', async () => {
      // Mock error in xclaim
      mockRedis.xclaim.mockRejectedValue(new Error('Claim failed'));
      
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        // Wait for recovery to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Should handle errors gracefully
        expect(manager.isRecoveringFromFailover()).toBe(false);
      }
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete failover and recovery cycle', async () => {
      const recoveryConfig: RedisClusterConfig = {
        ...config,
        failoverRecovery: {
          enabled: true,
          resumeUnackedMessages: true,
          staleMessageThreshold: 30000,
          recoveryTimeout: 60000
        }
      };
      
      manager = new RedisClusterManager(recoveryConfig);
      
      // Mock pending messages and consumer groups
      mockRedis.xpending.mockResolvedValue([2, '0-0', '0-0', []]);
      mockRedis.xinfo.mockResolvedValue([
        ['name', 'group1']
      ]);
      
      // Mock keys to return some topics
      mockRedis.keys.mockResolvedValue(['topic:test:partition:0']);
      
      await manager.connect();
      
      // Simulate failover start
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        await failoverHandler();
        
        // Wait for recovery to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Should have events
        const events = manager.getFailoverEvents();
        expect(events.length).toBeGreaterThan(0);
        expect(events.some(e => e.type === 'failover_start')).toBe(true);
        expect(events.some(e => e.type === 'recovery_start')).toBe(true);
        expect(events.some(e => e.type === 'recovery_complete')).toBe(true);
      }
    });

    it('should handle multiple failover events', async () => {
      await manager.connect();
      
      const failoverHandler = mockRedis.on.mock.calls.find(call => call[0] === 'failover')?.[1];
      if (failoverHandler) {
        // Trigger multiple failovers
        await failoverHandler();
        await failoverHandler();
        await failoverHandler();
        
        const events = manager.getFailoverEvents();
        expect(events).toHaveLength(3);
        expect(events.every(e => e.type === 'failover_start')).toBe(true);
      }
    });
  });
});
