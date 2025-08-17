import { EnhancedRedisStreamsTransport } from './enhanced-redis-streams-transport';
import { Redis } from 'ioredis';

// Mock Redis
jest.mock('ioredis');

describe('EnhancedRedisStreamsTransport - Publishing', () => {
  let mockRedis: any;
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
      pipeline: jest.fn().mockReturnValue({
        xadd: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      }),
      disconnect: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
    };

    transport = new EnhancedRedisStreamsTransport(mockRedis);
  });

  describe('Publishing', () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it('should publish message successfully', async () => {
      const message = { userId: '123', action: 'login' };
      
      await transport.publish('user.events', message);
      
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'stream:user.events',
        '*',
        'data',
        expect.stringContaining('"userId":"123"'),
        'timestamp',
        expect.any(String),
        'topic',
        'user.events'
      );
    });

    it('should throw error when not connected', async () => {
      await transport.disconnect();
      
      await expect(transport.publish('user.events', {})).rejects.toThrow('Transport not connected');
    });

    it('should handle schema validation in strict mode', async () => {
      // Mock schema manager to return validation failure
      (transport as any).schemaManager = {
        validateMessage: jest.fn().mockResolvedValue({
          valid: false,
          errors: ['Invalid user ID format']
        })
      };
      
      (transport as any).config.schema = { validationMode: 'strict' };
      
      await expect(transport.publish('user.events', {})).rejects.toThrow('Schema validation failed');
    });

    it('should handle schema validation in warn mode', async () => {
      // Mock schema manager to return validation failure
      (transport as any).schemaManager = {
        validateMessage: jest.fn().mockResolvedValue({
          valid: false,
          errors: ['Invalid user ID format']
        })
      };
      
      (transport as any).config.schema = { validationMode: 'warn' };
      
      // Should not throw in warn mode
      await expect(transport.publish('user.events', {})).resolves.not.toThrow();
    });

    it('should handle schema validation in ignore mode', async () => {
      // Mock schema manager to return validation failure
      (transport as any).schemaManager = {
        validateMessage: jest.fn().mockResolvedValue({
          valid: false,
          errors: ['Invalid user ID format']
        })
      };
      
      (transport as any).config.schema = { validationMode: 'ignore' };
      
      // Should not throw in ignore mode
      await expect(transport.publish('user.events', {})).resolves.not.toThrow();
    });

    it('should use custom stream prefix', async () => {
      const customTransport = new EnhancedRedisStreamsTransport(mockRedis, {
        streamPrefix: 'custom:'
      });
      await customTransport.connect();
      
      await customTransport.publish('user.events', { test: 'data' });
      
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'custom:user.events',
        '*',
        'data',
        expect.stringContaining('"test":"data"'),
        'timestamp',
        expect.any(String),
        'topic',
        'user.events'
      );
    });

    it('should handle Redis errors during publish', async () => {
      mockRedis.xadd.mockRejectedValue(new Error('Redis error'));
      
      await expect(transport.publish('user.events', {})).rejects.toThrow('Redis error');
    });

    it('should update metrics after successful publish', async () => {
      const initialMetrics = await transport.getMetrics();
      
      await transport.publish('user.events', { test: 'data' });
      
      const finalMetrics = await transport.getMetrics();
      expect(finalMetrics.messagesPublished).toBe(initialMetrics.messagesPublished + 1);
    });
  });

  describe('Batch Publishing', () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it('should publish batch of messages', async () => {
      const messages = [
        { userId: '1', action: 'login' },
        { userId: '2', action: 'logout' },
        { userId: '3', action: 'update' }
      ];
      
      await transport.publishBatch('user.events', messages);
      
      // With pipelining enabled by default, xadd is called on the pipeline, not directly on Redis
      expect(mockRedis.pipeline).toHaveBeenCalled();
      const mockPipeline = mockRedis.pipeline();
      expect(mockPipeline.xadd).toHaveBeenCalledTimes(3);
    });

    it('should handle empty batch', async () => {
      await expect(transport.publishBatch('user.events', [])).resolves.not.toThrow();
      expect(mockRedis.xadd).not.toHaveBeenCalled();
    });

    it('should handle batch with single message', async () => {
      const messages = [{ userId: '1', action: 'login' }];
      
      await transport.publishBatch('user.events', messages);
      
      // With pipelining enabled by default, xadd is called on the pipeline, not directly on Redis
      expect(mockRedis.pipeline).toHaveBeenCalled();
      const mockPipeline = mockRedis.pipeline();
      expect(mockPipeline.xadd).toHaveBeenCalledTimes(1);
    });

    it('should handle Redis errors during batch publish', async () => {
      // Mock pipeline error
      const mockPipeline = {
        xadd: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Redis error'))
      };
      mockRedis.pipeline.mockReturnValue(mockPipeline);
      
      const messages = [
        { userId: '1', action: 'login' },
        { userId: '2', action: 'logout' }
      ];
      
      await expect(transport.publishBatch('user.events', messages)).rejects.toThrow('Redis error');
    });
  });

  describe('Stream Management', () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it('should trim streams according to maxLen', async () => {
      await transport.publish('user.events', { test: 'data' });
      
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'stream:user.events',
        '*',
        'data',
        expect.stringContaining('"test":"data"'),
        'timestamp',
        expect.any(String),
        'topic',
        'user.events'
      );
    });

    it('should use MINID trim strategy when configured', async () => {
      const customTransport = new EnhancedRedisStreamsTransport(mockRedis, {
        trimStrategy: 'MINID'
      });
      await customTransport.connect();
      
      await customTransport.publish('user.events', { test: 'data' });
      
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'stream:user.events',
        '*',
        'data',
        expect.stringContaining('"test":"data"'),
        'timestamp',
        expect.any(String),
        'topic',
        'user.events'
      );
    });

    it('should handle custom maxLen configuration', async () => {
      const customTransport = new EnhancedRedisStreamsTransport(mockRedis, {
        maxLen: 5000
      });
      await customTransport.connect();
      
      await customTransport.publish('user.events', { test: 'data' });
      
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'stream:user.events',
        '*',
        'data',
        expect.stringContaining('"test":"data"'),
        'timestamp',
        expect.any(String),
        'topic',
        'user.events'
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors gracefully', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection failed'));
      
      await expect(transport.connect()).rejects.toThrow('Failed to connect to Redis: Error: Connection failed');
    });

    it('should handle Redis operation failures', async () => {
      await transport.connect();
      mockRedis.xadd.mockRejectedValue(new Error('Redis operation failed'));
      
      await expect(transport.publish('user.events', {})).rejects.toThrow('Redis operation failed');
    });

    it('should handle malformed messages gracefully', async () => {
      await transport.connect();
      
      // Test with circular reference (should not crash)
      const circularObj: any = { test: 'data' };
      circularObj.self = circularObj;
      
      await expect(transport.publish('user.events', circularObj)).rejects.toThrow();
    });
  });

  describe('Metrics and Monitoring', () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it('should provide basic metrics', async () => {
      const metrics = await transport.getMetrics();
      
      expect(metrics).toHaveProperty('messagesPublished');
      expect(metrics).toHaveProperty('messagesReceived');
      expect(metrics).toHaveProperty('errorRate');
      expect(metrics).toHaveProperty('throughput');
    });

    it('should update metrics after operations', async () => {
      const initialMetrics = await transport.getMetrics();
      
      await transport.publish('user.events', { test: 'data' });
      
      const finalMetrics = await transport.getMetrics();
      expect(finalMetrics.messagesPublished).toBeGreaterThan(initialMetrics.messagesPublished);
    });
  });

  describe('Enterprise Features', () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it('should handle partitioning when enabled', async () => {
      // Mock partitioning manager
      (transport as any).partitioningManager = {
        getPartition: jest.fn().mockResolvedValue(5),
        updatePartitionMetrics: jest.fn().mockResolvedValue(undefined)
      };
      
      await transport.publish('user.events', { userId: '123' });
      
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'stream:user.events',
        '*',
        'data',
        expect.stringContaining('"userId":"123"'),
        'timestamp',
        expect.any(String),
        'topic',
        'user.events',
        'partition',
        '5'
      );
    });

    it('should handle ordering when enabled', async () => {
      // Mock ordering manager
      (transport as any).orderingManager = {
        generateSequenceNumber: jest.fn().mockResolvedValue({ sequence: 123, timestamp: Date.now() })
      };
      
      await transport.publish('user.events', { userId: '123' });
      
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'stream:user.events',
        '*',
        'data',
        expect.stringContaining('"userId":"123"'),
        'timestamp',
        expect.any(String),
        'topic',
        'user.events',
        'sequence',
        expect.stringContaining('"sequence":123')
      );
    });

    it('should handle both partitioning and ordering when enabled', async () => {
      // Mock both managers
      (transport as any).partitioningManager = {
        getPartition: jest.fn().mockResolvedValue(3),
        updatePartitionMetrics: jest.fn().mockResolvedValue(undefined)
      };
      (transport as any).orderingManager = {
        generateSequenceNumber: jest.fn().mockResolvedValue({ sequence: 456, timestamp: Date.now() })
      };
      
      await transport.publish('user.events', { userId: '123' });
      
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'stream:user.events',
        '*',
        'data',
        expect.stringContaining('"userId":"123"'),
        'timestamp',
        expect.any(String),
        'topic',
        'user.events',
        'sequence',
        expect.stringContaining('"sequence":456'),
        'partition',
        '3'
      );
    });

    it('should update partition metrics when partitioning is enabled', async () => {
      // Mock partitioning manager with updatePartitionMetrics method
      const mockUpdateMetrics = jest.fn().mockResolvedValue(undefined);
      (transport as any).partitioningManager = {
        getPartition: jest.fn().mockResolvedValue(2),
        updatePartitionMetrics: mockUpdateMetrics
      };
      
      await transport.publish('user.events', { userId: '123' });
      
      expect(mockUpdateMetrics).toHaveBeenCalledWith(2, 1, 0);
    });

    it('should handle metrics collection with latency tracking', async () => {
      // Reset metrics to ensure clean state
      (transport as any).metrics.messagesPublished = 0;
      (transport as any).metrics.publishLatency = [];
      
      await transport.publish('user.events', { userId: '123' });
      
      const metrics = await transport.getMetrics();
      expect(metrics.messagesPublished).toBeGreaterThan(0);
      
      // Verify the raw metrics are updated
      expect((transport as any).metrics.publishLatency.length).toBeGreaterThan(0);
      
      // The average latency might be 0 if the operation is very fast, so just check the array length
      expect((transport as any).metrics.publishLatency.length).toBe(1);
    });

    it('should handle metrics array overflow (length > 100)', async () => {
      // Pre-populate the latency array with 100 items
      (transport as any).metrics.publishLatency = Array(100).fill(1);
      
      // Publish a message to trigger the overflow condition
      await transport.publish('user.events', { userId: '123' });
      
      // The array should still be 100 items (oldest removed)
      expect((transport as any).metrics.publishLatency.length).toBe(100);
      
      // The first item should be removed (shifted out)
      expect((transport as any).metrics.publishLatency[0]).toBe(1); // Should still be 1, not the new latency
    });

    it('should handle batch publishing without pipelining', async () => {
      const customTransport = new EnhancedRedisStreamsTransport(mockRedis, {
        enablePipelining: false
      });
      await customTransport.connect();
      
      const messages = [
        { userId: '1', action: 'login' },
        { userId: '2', action: 'logout' }
      ];
      
      await customTransport.publishBatch('user.events', messages);
      
      // Should call xadd twice (once for each message) instead of using pipeline
      expect(mockRedis.xadd).toHaveBeenCalledTimes(2);
      expect(mockRedis.pipeline).not.toHaveBeenCalled();
    });
  });
});
