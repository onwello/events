import { MemoryTransportPlugin, MemoryTransportConfig } from './memory-plugin';
import { MemoryTransport } from './transport/memory-transport';

// Mock the MemoryTransport to avoid complex dependencies
jest.mock('./transport/memory-transport');

describe('MemoryTransportPlugin', () => {
  let plugin: MemoryTransportPlugin;
  let mockMemoryTransport: jest.Mocked<MemoryTransport>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Mock the MemoryTransport constructor
    const MockMemoryTransport = MemoryTransport as jest.MockedClass<typeof MemoryTransport>;
    mockMemoryTransport = {
      // Add any methods that might be called during testing
    } as any;
    MockMemoryTransport.mockImplementation(() => mockMemoryTransport);
    
    plugin = new MemoryTransportPlugin();
  });

  describe('Basic Properties', () => {
    it('should have correct name and version', () => {
      expect(plugin.name).toBe('memory');
      expect(plugin.version).toBe('1.0.0');
    });

    it('should have correct capabilities', () => {
      const capabilities = plugin.capabilities;
      
      expect(capabilities.supportsPublishing).toBe(true);
      expect(capabilities.supportsSubscription).toBe(true);
      expect(capabilities.supportsBatching).toBe(false);
      expect(capabilities.supportsPartitioning).toBe(false);
      expect(capabilities.supportsOrdering).toBe(true);
      expect(capabilities.supportsPatternRouting).toBe(true);
      expect(capabilities.supportsConsumerGroups).toBe(false);
      expect(capabilities.supportsDeadLetterQueues).toBe(false);
      expect(capabilities.supportsMessageRetention).toBe(false);
      expect(capabilities.supportsMessageCompression).toBe(false);
      expect(capabilities.maxMessageSize).toBe(1024 * 1024);
      expect(capabilities.maxBatchSize).toBe(1);
      expect(capabilities.maxTopics).toBe(1000);
      expect(capabilities.maxPartitions).toBe(1);
      expect(capabilities.maxConsumerGroups).toBe(0);
      expect(capabilities.supportsPersistence).toBe(false);
      expect(capabilities.supportsReplication).toBe(false);
      expect(capabilities.supportsFailover).toBe(false);
      expect(capabilities.supportsTransactions).toBe(false);
      expect(capabilities.supportsMetrics).toBe(true);
      expect(capabilities.supportsTracing).toBe(false);
      expect(capabilities.supportsHealthChecks).toBe(true);
    });
  });

  describe('createTransport', () => {
    it('should create transport with default config', () => {
      const transport = plugin.createTransport({});
      
      expect(MemoryTransport).toHaveBeenCalledWith({
        originPrefix: undefined
      });
      expect(transport).toBe(mockMemoryTransport);
    });

    it('should create transport with custom originPrefix', () => {
      const config: MemoryTransportConfig = {
        originPrefix: 'us-east'
      };
      
      const transport = plugin.createTransport(config);
      
      expect(MemoryTransport).toHaveBeenCalledWith({
        originPrefix: 'us-east'
      });
      expect(transport).toBe(mockMemoryTransport);
    });

    it('should create transport with undefined originPrefix', () => {
      const config: MemoryTransportConfig = {
        originPrefix: undefined
      };
      
      const transport = plugin.createTransport(config);
      
      expect(MemoryTransport).toHaveBeenCalledWith({
        originPrefix: undefined
      });
      expect(transport).toBe(mockMemoryTransport);
    });
  });

  describe('validateConfig', () => {
    it('should validate empty config as valid', () => {
      const result = plugin.validateConfig({});
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate config with undefined originPrefix as valid', () => {
      const result = plugin.validateConfig({ originPrefix: undefined });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate config with valid string originPrefix as valid', () => {
      const result = plugin.validateConfig({ originPrefix: 'us-east' });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject config with non-string originPrefix', () => {
      const result = plugin.validateConfig({ originPrefix: 123 });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('originPrefix must be a string');
    });

    it('should reject config with null originPrefix', () => {
      const result = plugin.validateConfig({ originPrefix: null });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('originPrefix must be a string');
    });

    it('should reject config with boolean originPrefix', () => {
      const result = plugin.validateConfig({ originPrefix: true });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('originPrefix must be a string');
    });

    it('should reject config with originPrefix containing spaces', () => {
      const result = plugin.validateConfig({ originPrefix: 'us east' });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('originPrefix cannot contain spaces');
    });

    it('should reject config with originPrefix containing multiple spaces', () => {
      const result = plugin.validateConfig({ originPrefix: 'us  east' });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('originPrefix cannot contain spaces');
    });

    it('should reject config with originPrefix containing leading space', () => {
      const result = plugin.validateConfig({ originPrefix: ' us-east' });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('originPrefix cannot contain spaces');
    });

    it('should reject config with originPrefix containing trailing space', () => {
      const result = plugin.validateConfig({ originPrefix: 'us-east ' });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('originPrefix cannot contain spaces');
    });

    it('should accept config with originPrefix containing tab character', () => {
      const result = plugin.validateConfig({ originPrefix: 'us\teast' });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept config with originPrefix containing newline character', () => {
      const result = plugin.validateConfig({ originPrefix: 'us\neast' });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject config with multiple validation errors', () => {
      const result = plugin.validateConfig({ 
        originPrefix: 123,
        invalidField: 'value'
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('originPrefix must be a string');
      expect(result.errors.length).toBe(1);
    });

    it('should handle config with additional valid fields', () => {
      const result = plugin.validateConfig({ 
        originPrefix: 'us-east',
        region: 'east',
        environment: 'prod'
      });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('getDefaultConfig', () => {
    it('should return default configuration', () => {
      const config = plugin.getDefaultConfig();
      
      expect(config).toEqual({
        originPrefix: undefined
      });
    });

    it('should return new object instance each time', () => {
      const config1 = plugin.getDefaultConfig();
      const config2 = plugin.getDefaultConfig();
      
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different instances
    });
  });

  describe('getPluginStructure', () => {
    it('should return correct plugin structure', () => {
      const structure = plugin.getPluginStructure();
      
      expect(structure).toEqual({
        transport: './transport/memory-transport',
        exports: []
      });
    });

    it('should return new object instance each time', () => {
      const structure1 = plugin.getPluginStructure();
      const structure2 = plugin.getPluginStructure();
      
      expect(structure1).toEqual(structure2);
      expect(structure1).not.toBe(structure2); // Different instances
    });
  });

  describe('Lifecycle Methods', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log message on register', () => {
      plugin.onRegister();
      
      expect(consoleSpy).toHaveBeenCalledWith('Memory Transport plugin v1.0.0 registered');
    });

    it('should log message on unregister', () => {
      plugin.onUnregister();
      
      expect(consoleSpy).toHaveBeenCalledWith('Memory Transport plugin unregistered');
    });
  });

  describe('Edge Cases', () => {
    it('should handle config with empty string originPrefix', () => {
      const result = plugin.validateConfig({ originPrefix: '' });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle config with very long originPrefix', () => {
      const longPrefix = 'a'.repeat(1000);
      const result = plugin.validateConfig({ originPrefix: longPrefix });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle config with special characters in originPrefix', () => {
      const specialPrefix = 'us-east-1_prod@v2';
      const result = plugin.validateConfig({ originPrefix: specialPrefix });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle config with unicode characters in originPrefix', () => {
      const unicodePrefix = 'us-éast-1';
      const result = plugin.validateConfig({ originPrefix: unicodePrefix });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
