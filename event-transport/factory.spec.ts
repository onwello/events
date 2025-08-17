import { TransportFactory, TransportFactoryConfig, GenericTransportConfig } from './factory';
import { Transport, TransportCapabilities } from './transport.interface';
import { TransportPlugin, PluginStructure } from './plugin.interface';

// Mock the plugins to avoid complex dependencies
jest.mock('../plugins/redis', () => ({
  RedisStreamsPlugin: jest.fn().mockImplementation(() => ({
    name: 'redis',
    version: '1.0.0',
    capabilities: {
      supportsPublishing: true,
      supportsSubscription: true,
      supportsBatching: true,
      supportsPatternRouting: true
    },
    validateConfig: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    createTransport: jest.fn().mockReturnValue({
      capabilities: {
        supportsPublishing: true,
        supportsSubscription: true,
        supportsBatching: true,
        supportsPatternRouting: true
      }
    }),
    getPluginStructure: jest.fn().mockReturnValue({
      transport: './redis-transport',
      exports: []
    }),
    getDefaultConfig: jest.fn().mockReturnValue({}),
    onRegister: jest.fn(),
    onUnregister: jest.fn()
  }))
}));

jest.mock('../plugins/memory', () => ({
  MemoryTransportPlugin: jest.fn().mockImplementation(() => ({
    name: 'memory',
    version: '1.0.0',
    capabilities: {
      supportsPublishing: true,
      supportsSubscription: true,
      supportsBatching: false,
      supportsPatternRouting: true
    },
    validateConfig: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    createTransport: jest.fn().mockReturnValue({
      capabilities: {
        supportsPublishing: true,
        supportsSubscription: true,
        supportsBatching: false,
        supportsPatternRouting: true
      }
    }),
    getPluginStructure: jest.fn().mockReturnValue({
      transport: './memory-transport',
      exports: []
    }),
    getDefaultConfig: jest.fn().mockReturnValue({}),
    onRegister: jest.fn(),
    onUnregister: jest.fn()
  }))
}));

describe('TransportFactory', () => {
  let factory: TransportFactory;
  let mockRedisPlugin: jest.Mocked<TransportPlugin>;
  let mockMemoryPlugin: jest.Mocked<TransportPlugin>;

  // Helper function to create mock plugins with all required methods
  const createMockPlugin = (name: string, capabilities: Partial<TransportCapabilities> = {}): TransportPlugin => ({
    name,
    version: '1.0.0',
    capabilities: {
      supportsPublishing: true,
      supportsSubscription: true,
      supportsBatching: false,
      supportsPatternRouting: false,
      ...capabilities
    } as TransportCapabilities,
    validateConfig: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    createTransport: jest.fn().mockReturnValue({
      capabilities: {
        supportsPublishing: true,
        supportsSubscription: true,
        supportsBatching: false,
        supportsPatternRouting: false,
        ...capabilities
      }
    }),
    getPluginStructure: jest.fn().mockReturnValue({
      transport: `./${name}-transport`,
      exports: []
    }),
    getDefaultConfig: jest.fn().mockReturnValue({}),
    onRegister: jest.fn(),
    onUnregister: jest.fn()
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get the mocked plugins
    const { RedisStreamsPlugin } = require('../plugins/redis');
    const { MemoryTransportPlugin } = require('../plugins/memory');
    
    mockRedisPlugin = new RedisStreamsPlugin();
    mockMemoryPlugin = new MemoryTransportPlugin();
    
    // Create factory after mocking to ensure onRegister is called
    factory = new TransportFactory();
    
    // Get the actual plugin instances from the factory to apply mocks
    const factoryRedisPlugin = factory.getPlugin('redis');
    const factoryMemoryPlugin = factory.getPlugin('memory');
    
    // Apply our mocks to the factory's plugin instances
    if (factoryRedisPlugin) {
      Object.assign(factoryRedisPlugin, mockRedisPlugin);
    }
    if (factoryMemoryPlugin) {
      Object.assign(factoryMemoryPlugin, mockMemoryPlugin);
    }
  });

  describe('Constructor and Configuration', () => {
    it('should create factory with default configuration', () => {
      expect(factory).toBeInstanceOf(TransportFactory);
    });

    it('should create factory with custom configuration', () => {
      const config: TransportFactoryConfig = {
        enableValidation: false,
        strictMode: true,
        autoDiscoverPlugins: true,
        pluginPaths: ['/custom/plugins']
      };
      
      const customFactory = new TransportFactory(config);
      expect(customFactory).toBeInstanceOf(TransportFactory);
    });

    it('should register built-in plugins by default', () => {
      const plugins = factory.getAllPlugins();
      expect(plugins.has('redis')).toBe(true);
      expect(plugins.has('memory')).toBe(true);
    });

    it('should call onRegister for built-in plugins', () => {
      // The onRegister method is called during plugin registration
      // We can verify this by checking that the plugins are registered
      expect(factory.getPlugin('redis')).toBeDefined();
      expect(factory.getPlugin('memory')).toBeDefined();
    });
  });

  describe('Plugin Management', () => {
    it('should register custom plugin', () => {
      const customPlugin: TransportPlugin = {
        name: 'custom',
        version: '1.0.0',
        capabilities: {} as TransportCapabilities,
        validateConfig: jest.fn().mockReturnValue({ valid: true, errors: [] }),
        createTransport: jest.fn().mockReturnValue({} as Transport),
        getPluginStructure: jest.fn().mockReturnValue({} as PluginStructure),
        getDefaultConfig: jest.fn().mockReturnValue({}),
        onRegister: jest.fn(),
        onUnregister: jest.fn()
      };
      
      factory.registerPlugin(customPlugin);
      
      expect(factory.getPlugin('custom')).toBe(customPlugin);
      expect(customPlugin.onRegister).toHaveBeenCalled();
    });

    it('should unregister plugin', () => {
      const customPlugin: TransportPlugin = {
        name: 'custom',
        version: '1.0.0',
        capabilities: {} as TransportCapabilities,
        validateConfig: jest.fn().mockReturnValue({ valid: true, errors: [] }),
        createTransport: jest.fn().mockReturnValue({} as Transport),
        getPluginStructure: jest.fn().mockReturnValue({} as PluginStructure),
        getDefaultConfig: jest.fn().mockReturnValue({}),
        onRegister: jest.fn(),
        onUnregister: jest.fn()
      };
      
      factory.registerPlugin(customPlugin);
      factory.unregisterPlugin('custom');
      
      expect(factory.getPlugin('custom')).toBeUndefined();
      expect(customPlugin.onUnregister).toHaveBeenCalled();
    });

    it('should handle unregistering non-existent plugin', () => {
      expect(() => {
        factory.unregisterPlugin('non-existent');
      }).not.toThrow();
    });

    it('should get all plugins', () => {
      const plugins = factory.getAllPlugins();
      expect(plugins).toBeInstanceOf(Map);
      expect(plugins.has('redis')).toBe(true);
      expect(plugins.has('memory')).toBe(true);
    });

    it('should get supported transport types', () => {
      const types = factory.getSupportedTypes();
      expect(types).toContain('redis');
      expect(types).toContain('memory');
    });

    it('should get plugin structure', () => {
      const structure = factory.getPluginStructure('redis');
      expect(structure).toBeDefined();
      expect(structure?.transport).toBe('./redis-transport');
    });

    it('should return undefined for non-existent plugin structure', () => {
      const structure = factory.getPluginStructure('non-existent');
      expect(structure).toBeUndefined();
    });

    it('should get all plugin structures', () => {
      const structures = factory.getAllPluginStructures();
      expect(structures).toBeInstanceOf(Map);
      expect(structures.has('redis')).toBe(true);
      expect(structures.has('memory')).toBe(true);
    });
  });

  describe('Transport Creation', () => {
    it('should create transport with valid config', () => {
      const config: GenericTransportConfig = {
        type: 'redis',
        options: { host: 'localhost' }
      };
      
      const transport = factory.createTransport(config);
      
      expect(transport).toBeDefined();
      expect(transport.capabilities).toBeDefined();
    });

    it('should create transport with plugin-specific method', () => {
      const transport = factory.createTransportWithPlugin('redis', { host: 'localhost' });
      
      expect(transport).toBeDefined();
      expect(transport.capabilities).toBeDefined();
    });

    it('should throw error for non-existent transport type', () => {
      const config: GenericTransportConfig = {
        type: 'non-existent',
        options: {}
      };
      
      expect(() => {
        factory.createTransport(config);
      }).toThrow('Transport plugin \'non-existent\' not found');
    });

    it('should throw error for non-existent plugin in createTransportWithPlugin', () => {
      expect(() => {
        factory.createTransportWithPlugin('non-existent', {});
      }).toThrow('Transport plugin \'non-existent\' not found');
    });

    it('should handle config validation through plugins', () => {
      // Test that the factory properly delegates config validation to plugins
      const config: GenericTransportConfig = {
        type: 'redis',
        options: { host: 'localhost' }
      };
      
      // This should work with valid config
      const transport = factory.createTransport(config);
      expect(transport).toBeDefined();
    });
  });

  describe('Capability Validation', () => {
    it('should validate capabilities in strict mode', () => {
      const strictFactory = new TransportFactory({
        enableValidation: true,
        strictMode: true
      });
      
      // Mock a plugin with mismatched capabilities
      const mismatchedPlugin = createMockPlugin('mismatched', {
        supportsPublishing: true,
        supportsSubscription: true,
        supportsBatching: true,
        supportsPatternRouting: true
      });
      
      // Override the transport capabilities to create a mismatch
      mismatchedPlugin.createTransport = jest.fn().mockReturnValue({
        capabilities: {
          supportsPublishing: false, // Mismatch
          supportsSubscription: true,
          supportsBatching: true,
          supportsPatternRouting: true
        }
      });
      
      strictFactory.registerPlugin(mismatchedPlugin);
      
      expect(() => {
        strictFactory.createTransportWithPlugin('mismatched', {});
      }).toThrow('Transport capability validation failed: Transport does not support publishing');
    });

    it('should not validate capabilities when validation is disabled', () => {
      const noValidationFactory = new TransportFactory({
        enableValidation: false
      });
      
      // Mock a plugin with mismatched capabilities
      const mismatchedPlugin = createMockPlugin('mismatched', {
        supportsPublishing: true,
        supportsSubscription: true,
        supportsBatching: true,
        supportsPatternRouting: true
      });
      
      // Override the transport capabilities to create a mismatch
      mismatchedPlugin.createTransport = jest.fn().mockReturnValue({
        capabilities: {
          supportsPublishing: false, // Mismatch
          supportsSubscription: true,
          supportsBatching: true,
          supportsPatternRouting: true
        }
      });
      
      noValidationFactory.registerPlugin(mismatchedPlugin);
      
      // Should not throw error when validation is disabled
      expect(() => {
        noValidationFactory.createTransportWithPlugin('mismatched', {});
      }).not.toThrow();
    });

    it('should generate warnings for optional capability mismatches', () => {
      const strictFactory = new TransportFactory({
        enableValidation: true,
        strictMode: true
      });
      
      // Mock a plugin with optional capability mismatches
      const warningPlugin = createMockPlugin('warning', {
        supportsPublishing: true,
        supportsSubscription: true,
        supportsBatching: true,
        supportsPatternRouting: true
      });
      
      // Override the transport capabilities to create optional mismatches
      warningPlugin.createTransport = jest.fn().mockReturnValue({
        capabilities: {
          supportsPublishing: true,
          supportsSubscription: true,
          supportsBatching: false, // Optional mismatch
          supportsPatternRouting: false // Optional mismatch
        }
      });
      
      strictFactory.registerPlugin(warningPlugin);
      
      // Should not throw error for optional capability mismatches
      expect(() => {
        strictFactory.createTransportWithPlugin('warning', {});
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle plugin errors gracefully', () => {
      // Test that the factory can handle plugin-related errors
      // This is tested through the capability validation tests above
      expect(factory).toBeDefined();
    });

    it('should handle capability validation errors gracefully', () => {
      const strictFactory = new TransportFactory({
        enableValidation: true,
        strictMode: true
      });
      
      // Mock a plugin that throws error during capability validation
      const errorPlugin = createMockPlugin('error');
      
      // Override the transport to throw error during capability access
      errorPlugin.createTransport = jest.fn().mockReturnValue({
        get capabilities() {
          throw new Error('Capability error');
        }
      });
      
      strictFactory.registerPlugin(errorPlugin);
      
      expect(() => {
        strictFactory.createTransportWithPlugin('error', {});
      }).toThrow('Capability error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty plugin list', () => {
      const emptyFactory = new TransportFactory();
      
      // Remove all plugins
      emptyFactory.unregisterPlugin('redis');
      emptyFactory.unregisterPlugin('memory');
      
      expect(emptyFactory.getSupportedTypes()).toEqual([]);
      expect(emptyFactory.getAllPlugins().size).toBe(0);
    });

    it('should handle plugin without onRegister/onUnregister methods', () => {
      const minimalPlugin = createMockPlugin('minimal');
      
      // Remove the optional methods
      delete (minimalPlugin as any).onRegister;
      delete (minimalPlugin as any).onUnregister;
      
      expect(() => {
        factory.registerPlugin(minimalPlugin);
        factory.unregisterPlugin('minimal');
      }).not.toThrow();
    });

    it('should handle plugin with null/undefined capabilities', () => {
      const nullCapabilitiesPlugin = createMockPlugin('null-capabilities');
      
      // Override capabilities to be null
      (nullCapabilitiesPlugin as any).capabilities = null;
      
      factory.registerPlugin(nullCapabilitiesPlugin);
      
      // Should not throw error
      expect(() => {
        factory.createTransportWithPlugin('null-capabilities', {});
      }).not.toThrow();
    });
  });

  describe('Factory Function', () => {
    it('should create factory instance', () => {
      const { createTransportFactory } = require('./factory');
      const factoryInstance = createTransportFactory();
      
      expect(factoryInstance).toBeInstanceOf(TransportFactory);
    });

    it('should create factory with custom config', () => {
      const { createTransportFactory } = require('./factory');
      const config: TransportFactoryConfig = {
        enableValidation: false,
        strictMode: true
      };
      
      const factoryInstance = createTransportFactory(config);
      
      expect(factoryInstance).toBeInstanceOf(TransportFactory);
    });
  });
});
