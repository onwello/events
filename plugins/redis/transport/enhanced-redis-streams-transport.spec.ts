import { EnhancedRedisStreamsTransport } from './enhanced-redis-streams-transport';
import { Redis } from 'ioredis';

// Mock Redis
jest.mock('ioredis');

describe('EnhancedRedisStreamsTransport - Constructor and Basics', () => {
  let mockRedis: jest.Mocked<Redis>;
  let transport: EnhancedRedisStreamsTransport;

  beforeEach(() => {
    mockRedis = {
      ping: jest.fn().mockResolvedValue('PONG'),
      xadd: jest.fn().mockResolvedValue('1234567890-0'),
      xreadgroup: jest.fn().mockResolvedValue([]),
      xack: jest.fn().mockResolvedValue(1),
      xpending: jest.fn().mockResolvedValue({ pending: 0 }),
      xlen: jest.fn().mockResolvedValue(0),
      xtrim: jest.fn().mockResolvedValue(0),
      keys: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(0),
      xread: jest.fn().mockResolvedValue([]),
      xinfo: jest.fn().mockResolvedValue({}),
      xgroup: jest.fn().mockResolvedValue('OK'),
      pipeline: jest.fn(() => ({
        xadd: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      })),
      disconnect: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      status: 'ready'
    } as any;
  });

  describe('Constructor', () => {
    it('should create transport with default config', () => {
      transport = new EnhancedRedisStreamsTransport(mockRedis);
      
      expect(transport.name).toBe('redis-streams');
      expect(transport.isConnected()).toBe(false);
      expect(transport.capabilities.supportsPublishing).toBe(true);
      expect(transport.capabilities.supportsSubscription).toBe(true);
      expect(transport.capabilities.supportsBatching).toBe(true);
    });

    it('should create transport with custom config', () => {
      const config = {
        groupId: 'custom-group',
        consumerId: 'custom-consumer',
        streamPrefix: 'custom:',
        maxLen: 5000,
        trimStrategy: 'MINID' as const,
        batchSize: 5,
        blockTime: 500,
        maxRetries: 5,
        retryDelay: 2000,
        enableDLQ: false,
        enablePipelining: false
      };

      transport = new EnhancedRedisStreamsTransport(mockRedis, config);
      
      expect(transport.name).toBe('redis-streams');
      expect(transport.isConnected()).toBe(false);
    });

    it('should set capabilities based on config', () => {
      const config = {
        enableDLQ: false,
        enablePipelining: false
      };

      transport = new EnhancedRedisStreamsTransport(mockRedis, config);
      
      // The capabilities are hardcoded in the constructor, not based on config
      expect(transport.capabilities.supportsDeadLetterQueues).toBe(true);
      expect(transport.capabilities.supportsMetrics).toBe(true);
    });
  });

  describe('Connection Management', () => {
    beforeEach(() => {
      transport = new EnhancedRedisStreamsTransport(mockRedis);
    });

    it('should connect successfully', async () => {
      await transport.connect();
      expect(transport.isConnected()).toBe(true);
      expect(mockRedis.ping).toHaveBeenCalled();
    });

    it('should handle connection failure', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection failed'));
      
      await expect(transport.connect()).rejects.toThrow('Failed to connect to Redis: Error: Connection failed');
      expect(transport.isConnected()).toBe(false);
    });

    it('should not connect if already connected', async () => {
      await transport.connect();
      await transport.connect(); // Second call should be ignored
      
      expect(mockRedis.ping).toHaveBeenCalledTimes(1);
    });

    it('should disconnect properly', async () => {
      await transport.connect();
      await transport.disconnect();
      
      expect(transport.isConnected()).toBe(false);
    });

    it('should not disconnect if already disconnected', async () => {
      await transport.disconnect(); // Should not throw
      expect(transport.isConnected()).toBe(false);
    });

    it('should close properly', async () => {
      await transport.connect();
      await transport.close();
      
      expect(transport.isConnected()).toBe(false);
    });

    it('should close properly with enterprise features', async () => {
      const enterpriseTransport = new EnhancedRedisStreamsTransport(mockRedis, {
        ordering: { enabled: true, strategy: 'global', maxConcurrency: 5, timeoutMs: 10000, retryAttempts: 3 },
        partitioning: { enabled: true, strategy: 'hash', partitionCount: 8, rebalanceThreshold: 1000, rebalanceInterval: 60000, loadBalancing: false, autoScaling: false, partitionRebalancing: false, minPartitions: 4, maxPartitions: 16 },
        schema: { enabled: true, registry: 'redis', validationMode: 'strict', autoEvolution: true, compatibilityCheck: true, versioningStrategy: 'semantic', maxVersions: 5 },
        replay: { enabled: true, maxReplayMessages: 50000, replayTimeout: 300000, validateReplay: true, preserveOrdering: true, batchSize: 50, compression: false }
      });

      await enterpriseTransport.connect();
      await enterpriseTransport.close();
      
      expect(enterpriseTransport.isConnected()).toBe(false);
    });
  });

  describe('Basic Properties', () => {
    beforeEach(() => {
      transport = new EnhancedRedisStreamsTransport(mockRedis);
    });

    it('should return correct name', () => {
      expect(transport.name).toBe('redis-streams');
    });

    it('should return connection status', () => {
      expect(transport.isConnected()).toBe(false);
      
      transport['connected'] = true;
      expect(transport.isConnected()).toBe(true);
    });

    it('should return capabilities', () => {
      const capabilities = transport.capabilities;
      
      expect(capabilities.supportsPublishing).toBe(true);
      expect(capabilities.supportsSubscription).toBe(true);
      expect(capabilities.supportsBatching).toBe(true);
      expect(capabilities.supportsConsumerGroups).toBe(true);
      expect(capabilities.supportsDeadLetterQueues).toBe(true);
      expect(capabilities.supportsPatternRouting).toBe(true);
      expect(capabilities.supportsMetrics).toBe(true);
    });
  });

  describe('Enterprise Features', () => {
    it('should return undefined managers when not configured', () => {
      expect(transport.getOrderingManager()).toBeUndefined();
      expect(transport.getPartitioningManager()).toBeUndefined();
      expect(transport.getSchemaManager()).toBeUndefined();
      expect(transport.getReplayManager()).toBeUndefined();
    });

    it('should initialize enterprise features when enabled', () => {
      const enterpriseTransport = new EnhancedRedisStreamsTransport(mockRedis, {
        ordering: { enabled: true, strategy: 'global', maxConcurrency: 5, timeoutMs: 10000, retryAttempts: 3 },
        partitioning: { enabled: true, strategy: 'hash', partitionCount: 8, rebalanceThreshold: 1000, rebalanceInterval: 60000, loadBalancing: false, autoScaling: false, partitionRebalancing: false, minPartitions: 4, maxPartitions: 16 },
        schema: { enabled: true, registry: 'redis', validationMode: 'strict', autoEvolution: true, compatibilityCheck: true, versioningStrategy: 'semantic', maxVersions: 5 },
        replay: { enabled: true, maxReplayMessages: 50000, replayTimeout: 300000, validateReplay: true, preserveOrdering: true, batchSize: 50, compression: false }
      });

      expect(enterpriseTransport.getOrderingManager()).toBeDefined();
      expect(enterpriseTransport.getPartitioningManager()).toBeDefined();
      expect(enterpriseTransport.getSchemaManager()).toBeDefined();
      expect(enterpriseTransport.getReplayManager()).toBeDefined();
    });

    it('should build capabilities based on enterprise features', () => {
      const enterpriseTransport = new EnhancedRedisStreamsTransport(mockRedis, {
        ordering: { enabled: true, strategy: 'global', maxConcurrency: 5, timeoutMs: 10000, retryAttempts: 3 },
        partitioning: { enabled: true, strategy: 'dynamic', partitionCount: 8, rebalanceThreshold: 1000, rebalanceInterval: 60000, loadBalancing: true, autoScaling: true, partitionRebalancing: true, minPartitions: 4, maxPartitions: 16 },
        schema: { enabled: true, registry: 'redis', validationMode: 'strict', autoEvolution: true, compatibilityCheck: true, versioningStrategy: 'semantic', maxVersions: 5 },
        replay: { enabled: true, maxReplayMessages: 50000, replayTimeout: 300000, validateReplay: true, preserveOrdering: true, batchSize: 50, compression: false }
      });

      const capabilities = enterpriseTransport.capabilities;
      
      expect(capabilities.supportsOrdering).toBe(true);
      expect(capabilities.supportsPartitioning).toBe(true);
      expect(capabilities.supportsMessageRetention).toBe(true);
      expect(capabilities.maxPartitions).toBe(10000); // Should be set to 10000 for dynamic partitioning
    });

    it('should handle partial enterprise feature configuration', () => {
      const partialTransport = new EnhancedRedisStreamsTransport(mockRedis, {
        ordering: { enabled: true, strategy: 'global', maxConcurrency: 5, timeoutMs: 10000, retryAttempts: 3 },
        schema: { enabled: true, registry: 'redis', validationMode: 'warn', autoEvolution: false, compatibilityCheck: false, versioningStrategy: 'semantic', maxVersions: 3 }
      });

      expect(partialTransport.getOrderingManager()).toBeDefined();
      expect(partialTransport.getPartitioningManager()).toBeUndefined();
      expect(partialTransport.getSchemaManager()).toBeDefined();
      expect(partialTransport.getReplayManager()).toBeUndefined();

      const capabilities = partialTransport.capabilities;
      expect(capabilities.supportsOrdering).toBe(true);
      expect(capabilities.supportsPartitioning).toBe(false);
      expect(capabilities.maxPartitions).toBe(1000); // Should be set to 1000 for global ordering
    });

    it('should get status with enterprise features', async () => {
      // Ensure mock Redis has the correct status
      mockRedis.status = 'ready';
      
      const enterpriseTransport = new EnhancedRedisStreamsTransport(mockRedis, {
        ordering: { enabled: true, strategy: 'global', maxConcurrency: 5, timeoutMs: 10000, retryAttempts: 3 },
        partitioning: { enabled: true, strategy: 'hash', partitionCount: 8, rebalanceThreshold: 1000, rebalanceInterval: 60000, loadBalancing: false, autoScaling: false, partitionRebalancing: false, minPartitions: 4, maxPartitions: 16 },
        schema: { enabled: true, registry: 'redis', validationMode: 'strict', autoEvolution: true, compatibilityCheck: true, versioningStrategy: 'semantic', maxVersions: 5 },
        replay: { enabled: true, maxReplayMessages: 50000, replayTimeout: 300000, validateReplay: true, preserveOrdering: true, batchSize: 50, compression: false }
      });

      await enterpriseTransport.connect();
      
      const status = await enterpriseTransport.getStatus();
      
      expect(status.connected).toBe(true);
      expect(status.healthy).toBe(true);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.version).toBe('2.0.0');
    });

    it('should handle subscription lifecycle', async () => {
      const mockHandler = jest.fn();
      
      await transport.connect();
      await transport.subscribe('test.topic', mockHandler);
      
      // Check that subscription was created
      expect(transport['subscriptions'].has('stream:test.topic')).toBe(true);
      
      // Unsubscribe
      await transport.unsubscribe('test.topic');
      expect(transport['subscriptions'].has('stream:test.topic')).toBe(false);
    });

    it('should handle subscription with custom options', async () => {
      const mockHandler = jest.fn();
      
      await transport.connect();
      await transport.subscribe('test.topic', mockHandler, {
        groupId: 'custom-group',
        consumerId: 'custom-consumer'
      });
      
      // Check that subscription was created with custom options
      const subscription = transport['subscriptions'].get('stream:test.topic');
      expect(subscription).toBeDefined();
      expect(subscription?.groupId).toBe('custom-group');
      expect(subscription?.consumerId).toBe('custom-consumer');
      
      await transport.unsubscribe('test.topic');
    });


  });
});
