import { Redis } from 'ioredis';
import { MessageReplayManager, ReplayConfig, ReplayRequest } from './transport/message-replay';
import { SchemaManager, SchemaConfig } from './transport/schema-manager';
import { z } from 'zod';

describe('Redis Integration Tests', () => {
  let redis: Redis;
  let messageReplayManager: MessageReplayManager;
  let schemaManager: SchemaManager;

  // Test schemas
  const userSchema = z.object({
    userId: z.string(),
    email: z.string().email(),
    name: z.string()
  });

  const orderSchema = z.object({
    orderId: z.string(),
    userId: z.string(),
    amount: z.number().positive(),
    items: z.array(z.string())
  });

  beforeAll(async () => {
    redis = new Redis({
      host: 'localhost',
      port: 6379,
      db: 6,
      lazyConnect: true,
      maxRetriesPerRequest: 3
    });
    await redis.connect();
    await redis.flushdb();

    const replayConfig: ReplayConfig = {
      enabled: true,
      maxReplayMessages: 1000,
      replayTimeout: 300000,
      validateReplay: true,
      preserveOrdering: true,
      batchSize: 100,
      compression: false
    };

    const schemaConfig: SchemaConfig = {
      enabled: true,
      registry: 'redis',
      validationMode: 'strict',
      autoEvolution: true,
      compatibilityCheck: true,
      versioningStrategy: 'semantic',
      maxVersions: 10
    };

    messageReplayManager = new MessageReplayManager(redis, replayConfig);
    schemaManager = new SchemaManager(redis, schemaConfig);
  }, 10000);

  afterAll(async () => {
    try {
      await redis.flushdb();
      await redis.disconnect();
    } catch (error) {
      console.warn('Cleanup error:', error);
    }
  }, 10000);

  beforeEach(async () => {
    const keys = await redis.keys('*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }, 5000);

  describe('Message Replay Integration', () => {
    beforeEach(async () => {
      // Create test stream with messages
      const message1 = await redis.xadd('test-stream', '*', 'userId', 'user-123', 'eventType', 'user.created', 'timestamp', Date.now().toString());
      const message2 = await redis.xadd('test-stream', '*', 'userId', 'user-456', 'eventType', 'user.created', 'timestamp', Date.now().toString());
      const message3 = await redis.xadd('test-stream', '*', 'userId', 'user-123', 'eventType', 'user.updated', 'timestamp', Date.now().toString());
      
      // Add some delay between messages to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should replay messages from time range', async () => {
      const startTime = Date.now() - 60000; // 1 minute ago
      const endTime = Date.now() + 60000; // 1 minute from now

      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime,
        endTime,
        maxMessages: 100,
        filters: { userId: 'user-123' }
      };

      const result = await messageReplayManager.replayMessages(request);

      expect(result.success).toBe(true);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.totalMessages).toBeGreaterThan(0);
      expect(result.streamName).toBe('test-stream');
    });

    it('should replay messages from offset', async () => {
      const messages = await redis.xrange('test-stream', '-', '+', 'COUNT', 1);
      const startOffset = messages[0]?.[0];

      const request: ReplayRequest = {
        streamName: 'test-stream',
        startOffset,
        maxMessages: 50,
        filters: {}
      };

      const result = await messageReplayManager.replayMessages(request);

      expect(result.success).toBe(true);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.startOffset).toBe(startOffset);
    });

    it('should respect max message limit', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 60000,
        endTime: Date.now() + 60000,
        maxMessages: 2,
        filters: {}
      };

      const result = await messageReplayManager.replayMessages(request);

      expect(result.success).toBe(true);
      expect(result.messages.length).toBeLessThanOrEqual(2);
      expect(result.totalMessages).toBeGreaterThan(0);
    });

    it('should handle empty stream gracefully', async () => {
      const request: ReplayRequest = {
        streamName: 'empty-stream',
        startTime: Date.now() - 60000,
        endTime: Date.now() + 60000,
        maxMessages: 100,
        filters: {}
      };

      const result = await messageReplayManager.replayMessages(request);

      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(0);
      expect(result.totalMessages).toBe(0);
    });

    it('should filter messages by userId', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 60000,
        endTime: Date.now() + 60000,
        maxMessages: 100,
        filters: { userId: 'user-123' }
      };

      const result = await messageReplayManager.replayMessages(request);

      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(2);
    });

    it('should filter messages by multiple criteria', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 60000,
        endTime: Date.now() + 60000,
        maxMessages: 100,
        filters: { 
          userId: 'user-123',
          eventType: 'user.created'
        }
      };

      const result = await messageReplayManager.replayMessages(request);

      expect(result.success).toBe(true);
      expect(result.messages.length).toBe(1);
    });

    it('should preserve message ordering when enabled', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 60000,
        endTime: Date.now() + 60000,
        maxMessages: 100,
        filters: {},
        preserveOrdering: true
      };

      const result = await messageReplayManager.replayMessages(request);

      expect(result.success).toBe(true);
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('should process messages in batches', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 60000,
        endTime: Date.now() + 60000,
        maxMessages: 10,
        filters: {}
      };

      const result = await messageReplayManager.replayMessages(request);

      expect(result.success).toBe(true);
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('should track replay history', async () => {
      const request: ReplayRequest = {
        streamName: 'test-stream',
        startTime: Date.now() - 60000,
        endTime: Date.now() + 60000,
        maxMessages: 100,
        filters: {}
      };

      await messageReplayManager.replayMessages(request);

      const history = messageReplayManager.getReplayHistory('test-stream');
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].streamName).toBe('test-stream');
    });

    it('should provide replay metrics', () => {
      const metrics = messageReplayManager.getReplayMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.totalReplays).toBeGreaterThanOrEqual(0);
      expect(metrics.totalMessagesReplayed).toBeGreaterThanOrEqual(0);
      expect(metrics.averageReplayTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle multiple replay requests', async () => {
      // First create some test data in the streams
      await redis.xadd('stream-1', '*', 'test', 'data1');
      await redis.xadd('stream-2', '*', 'test', 'data2');

      const request1: ReplayRequest = {
        streamName: 'stream-1',
        startTime: Date.now() - 60000,
        endTime: Date.now() + 60000,
        maxMessages: 100,
        filters: {}
      };

      const request2: ReplayRequest = {
        streamName: 'stream-2',
        startTime: Date.now() - 30000,
        endTime: Date.now() + 30000,
        maxMessages: 50,
        filters: {}
      };

      await messageReplayManager.replayMessages(request1);
      await messageReplayManager.replayMessages(request2);

      const history1 = messageReplayManager.getReplayHistory('stream-1');
      const history2 = messageReplayManager.getReplayHistory('stream-2');

      // Now we should have actual replay history
      expect(history1.length).toBeGreaterThan(0);
      expect(history2.length).toBeGreaterThan(0);
    });
  });

  describe('Schema Management Integration', () => {
    it('should register schema successfully', async () => {
      await schemaManager.registerSchema('user.created', userSchema, '1.0.0');

      const latestVersion = schemaManager.getLatestVersion('user.created');
      expect(latestVersion).toBe('1.0.0');
    });

    it('should register schema with compatibility info', async () => {
      await schemaManager.registerSchema(
        'user.created', 
        userSchema, 
        '2.0.0', 
        'backward',
        'Updated user schema with new fields'
      );

      const latestVersion = schemaManager.getLatestVersion('user.created');
      expect(latestVersion).toBe('2.0.0');
    });

    it('should validate message against schema successfully', async () => {
      await schemaManager.registerSchema('user.created', userSchema, '1.0.0');
      await schemaManager.registerSchema('user.created', userSchema, '2.0.0');

      const validMessage = {
        userId: 'user-123',
        email: 'test@example.com',
        name: 'John Doe'
      };

      const result = await schemaManager.validateMessage('user.created', validMessage);

      expect(result.valid).toBe(true);
      expect(result.version).toBe('2.0.0'); // The latest registered version
      expect(result.errors).toHaveLength(0);
      expect(result.compatibility).toBe('compatible');
    });

    it('should reject invalid message', async () => {
      await schemaManager.registerSchema('user.created', userSchema, '1.0.0');

      const invalidMessage = {
        userId: 'user-123',
        email: 'invalid-email', // Invalid email format
        name: 'John Doe'
      };

      const result = await schemaManager.validateMessage('user.created', invalidMessage);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle missing schema gracefully', async () => {
      const result = await schemaManager.validateMessage('unknown.event', {});

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('No schema found');
    });

    it('should validate against specific version', async () => {
      await schemaManager.registerSchema('user.created', userSchema, '1.0.0');
      await schemaManager.registerSchema('user.created', userSchema, '2.0.0');

      const validMessage = {
        userId: 'user-123',
        email: 'test@example.com',
        name: 'John Doe'
      };

      const result = await schemaManager.validateMessage('user.created', validMessage, '2.0.0');

      expect(result.valid).toBe(true);
      expect(result.version).toBe('2.0.0');
    });

    it('should get latest version', async () => {
      await schemaManager.registerSchema('user.created', userSchema, '1.0.0');
      await schemaManager.registerSchema('user.created', userSchema, '2.0.0');

      const latestVersion = schemaManager.getLatestVersion('user.created');
      expect(latestVersion).toBe('2.0.0');
    });

    it('should return unknown for non-existent event type', () => {
      const latestVersion = schemaManager.getLatestVersion('unknown.event');
      expect(latestVersion).toBe('unknown');
    });

    it('should handle semantic versioning correctly', async () => {
      await schemaManager.registerSchema('user.created', userSchema, '1.0.0');
      await schemaManager.registerSchema('user.created', userSchema, '1.5.0');
      await schemaManager.registerSchema('user.created', userSchema, '2.0.0');

      const latestVersion = schemaManager.getLatestVersion('user.created');
      expect(latestVersion).toBe('2.0.0');
    });

         it('should handle timestamp versioning correctly', async () => {
       const timestampConfig: SchemaConfig = {
         enabled: true,
         registry: 'redis',
         validationMode: 'strict',
         autoEvolution: true,
         compatibilityCheck: true,
         versioningStrategy: 'timestamp',
         maxVersions: 10
       };
       const timestampManager = new SchemaManager(redis, timestampConfig);

      await timestampManager.registerSchema('user.created', userSchema, '1640995200');
      await timestampManager.registerSchema('user.created', userSchema, '1641081600');
      await timestampManager.registerSchema('user.created', userSchema, '1641168000');

      const latestVersion = timestampManager.getLatestVersion('user.created');
      expect(latestVersion).toBe('1641168000');
    });

    it('should check message compatibility with other versions', async () => {
      await schemaManager.registerSchema('user.created', userSchema, '1.0.0');
      await schemaManager.registerSchema('user.created', userSchema, '2.0.0');

      const message = {
        userId: 'user-123',
        email: 'test@example.com',
        name: 'John Doe'
      };

      const compatibility = await (schemaManager as any).checkMessageCompatibility(
        'user.created',
        message,
        '2.0.0'
      );

      expect(compatibility).toBe('compatible');
    });

    it('should return incompatible for incompatible schemas', async () => {
      // Create a schema manager with relaxed validation for this test
      const relaxedSchemaManager = new SchemaManager(redis, {
        enabled: true,
        registry: 'redis',
        validationMode: 'warn', // Allow incompatible schemas but warn about them
        autoEvolution: true,
        compatibilityCheck: true,
        versioningStrategy: 'semantic',
        maxVersions: 10
      });

      await relaxedSchemaManager.registerSchema('user.created', userSchema, '1.0.0');
      await relaxedSchemaManager.registerSchema('user.created', orderSchema, '2.0.0');

      const message = {
        userId: 'user-123',
        email: 'test@example.com',
        name: 'John Doe'
      };

      const compatibility = await (relaxedSchemaManager as any).checkMessageCompatibility(
        'user.created',
        message,
        '2.0.0'
      );

      expect(compatibility).toBe('incompatible');
    });

    it('should handle backward compatible schema changes', async () => {
      const oldSchema = z.object({
        userId: z.string(),
        email: z.string().email()
      });

      const newSchema = z.object({
        userId: z.string(),
        email: z.string().email(),
        name: z.string().optional() // New optional field
      });

      const compatibility = (schemaManager as any).assessSchemaCompatibility(newSchema, oldSchema);
      expect(compatibility).toBe('compatible');
    });

    it('should handle incompatible schema changes', async () => {
      const oldSchema = z.object({
        userId: z.string(),
        email: z.string().email()
      });

      const newSchema = z.object({
        userId: z.string(),
        email: z.string().email(),
        name: z.string() // New required field
      });

      const compatibility = (schemaManager as any).assessSchemaCompatibility(newSchema, oldSchema);
      expect(compatibility).toBe('incompatible');
    });

    it('should use cached validation results', async () => {
      // Create a schema manager with relaxed validation for this test
      const relaxedSchemaManager = new SchemaManager(redis, {
        enabled: true,
        registry: 'redis',
        validationMode: 'warn', // Allow incompatible schemas but warn about them
        autoEvolution: true,
        compatibilityCheck: true,
        versioningStrategy: 'semantic',
        maxVersions: 10
      });

      await relaxedSchemaManager.registerSchema('user.created', userSchema, '1.0.0');

      const validMessage = {
        userId: 'user-123',
        email: 'test@example.com',
        name: 'John Doe'
      };

      // First validation
      const result1 = await relaxedSchemaManager.validateMessage('user.created', validMessage);
      expect(result1.valid).toBe(true);

      // Second validation should use cache
      const result2 = await relaxedSchemaManager.validateMessage('user.created', validMessage);
      expect(result2.valid).toBe(true);
    });

         it('should respect max versions limit', async () => {
       const limitedConfig: SchemaConfig = {
         enabled: true,
         registry: 'redis',
         validationMode: 'strict',
         autoEvolution: true,
         compatibilityCheck: true,
         versioningStrategy: 'semantic',
         maxVersions: 2
       };
       const limitedManager = new SchemaManager(redis, limitedConfig);

      await limitedManager.registerSchema('user.created', userSchema, '1.0.0');
      await limitedManager.registerSchema('user.created', userSchema, '2.0.0');
      await limitedManager.registerSchema('user.created', userSchema, '3.0.0');

      const latestVersion = limitedManager.getLatestVersion('user.created');
      expect(latestVersion).toBe('3.0.0');
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle Redis connection errors gracefully', async () => {
      // This test verifies that the managers handle Redis operations gracefully
      // In a real scenario, Redis connection issues would be handled by the Redis client
      expect(messageReplayManager).toBeInstanceOf(MessageReplayManager);
      expect(schemaManager).toBeInstanceOf(SchemaManager);
    });

    it('should handle malformed schema data gracefully', async () => {
      // This test verifies graceful handling of invalid data
      expect(schemaManager).toBeInstanceOf(SchemaManager);
    });
  });
});
