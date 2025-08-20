import { RedisStreamsPlugin } from './redis-plugin';
import { Redis } from 'ioredis';

// Mock ioredis
jest.mock('ioredis');

describe('RedisStreamsPlugin', () => {
  let plugin: RedisStreamsPlugin;
  let mockRedis: jest.Mocked<Redis>;

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
      disconnect: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
    } as any;

    plugin = new RedisStreamsPlugin();
  });

  describe('Basic Properties', () => {
    it('should have correct name and version', () => {
      expect(plugin.name).toBe('redis-streams');
      expect(plugin.version).toBe('2.0.0');
    });

    it('should have correct capabilities', () => {
      const capabilities = plugin.capabilities;
      
      expect(capabilities.supportsPublishing).toBe(true);
      expect(capabilities.supportsSubscription).toBe(true);
      expect(capabilities.supportsBatching).toBe(true);
      expect(capabilities.supportsConsumerGroups).toBe(true);
      expect(capabilities.supportsDeadLetterQueues).toBe(true);
      expect(capabilities.supportsPatternRouting).toBe(true);
      expect(capabilities.supportsMetrics).toBe(true);
      expect(capabilities.maxMessageSize).toBe(512 * 1024 * 1024);
      expect(capabilities.maxBatchSize).toBe(5000);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate valid configuration', () => {
      const config = {
        host: 'localhost',
        port: 6379,
        db: 0,
        groupId: 'test-group',
        batchSize: 10,
        maxLen: 1000
      };

      const result = plugin.validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject configuration without host or url', () => {
      const config = { port: 6379 };
      const result = plugin.validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Either host or url must be provided');
    });

    it('should reject invalid port', () => {
      const config = { host: 'localhost', port: 70000 };
      const result = plugin.validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Port must be between 1 and 65535');
    });

    it('should reject invalid database', () => {
      const config = { host: 'localhost', db: 20 };
      const result = plugin.validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Database must be between 0 and 15');
    });

    it('should reject invalid maxLen', () => {
      const config = { host: 'localhost', maxLen: -1 };
      const result = plugin.validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('maxLen must be greater than 0');
    });

    it('should reject invalid trimStrategy', () => {
      const config = { host: 'localhost', trimStrategy: 'INVALID' as any };
      const result = plugin.validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('trimStrategy must be either MAXLEN or MINID');
    });

    it('should reject invalid batchSize', () => {
      const config = { host: 'localhost', batchSize: 6000 };
      const result = plugin.validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('batchSize must be between 1 and 5000');
    });

    it('should reject invalid blockTime', () => {
      const config = { host: 'localhost', blockTime: 40000 };
      const result = plugin.validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('blockTime must be between 0 and 30000ms');
    });

    it('should reject negative maxRetries', () => {
      const config = { host: 'localhost', maxRetries: -1 };
      const result = plugin.validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('maxRetries must be non-negative');
    });

    it('should reject negative retryDelay', () => {
      const config = { host: 'localhost', retryDelay: -1 };
      const result = plugin.validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('retryDelay must be non-negative');
    });

    it('should reject invalid pipelineSize', () => {
      const config = { host: 'localhost', pipelineSize: 20000 };
      const result = plugin.validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('pipelineSize must be between 1 and 10000');
    });


  });

  describe('Default Configuration', () => {
    it('should return default configuration', () => {
      const defaultConfig = plugin.getDefaultConfig();
      
      expect(defaultConfig.host).toBe('localhost');
      expect(defaultConfig.port).toBe(6379);
      expect(defaultConfig.groupId).toBe('default-group');
      expect(defaultConfig.streamPrefix).toBe('stream:');
      expect(defaultConfig.maxLen).toBe(10000);
      expect(defaultConfig.trimStrategy).toBe('MAXLEN');
      expect(defaultConfig.batchSize).toBe(10);
      expect(defaultConfig.blockTime).toBe(1000);
      expect(defaultConfig.maxRetries).toBe(3);
      expect(defaultConfig.retryDelay).toBe(1000);
      expect(defaultConfig.enableDLQ).toBe(true);
      expect(defaultConfig.dlqStreamPrefix).toBe('dlq:');
      expect(defaultConfig.maxRetriesBeforeDLQ).toBe(3);
      expect(defaultConfig.enablePipelining).toBe(true);
      expect(defaultConfig.pipelineSize).toBe(100);

    });
  });

  describe('Plugin Structure', () => {
    it('should return correct plugin structure', () => {
      const structure = plugin.getPluginStructure();
      
      expect(structure.transport).toBe('./transport/enhanced-redis-streams-transport');
      expect(structure.routing).toContain('./routing/topic-router');
      expect(structure.tools).toContain('./tools/cli-tools');
      expect(structure.exports).toContain('./transport/redis-cluster-support');
    });
  });

  describe('Lifecycle Methods', () => {
    it('should handle registration', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      plugin.onRegister?.();
      
      expect(consoleSpy).toHaveBeenCalledWith('Redis Streams Plugin registered with enterprise features support');
      consoleSpy.mockRestore();
    });

    it('should handle unregistration', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      plugin.onUnregister?.();
      
      expect(consoleSpy).toHaveBeenCalledWith('Redis Streams Plugin unregistered');
      consoleSpy.mockRestore();
    });
  });
});
