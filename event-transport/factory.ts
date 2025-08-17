import { Transport, TransportCapabilities } from './transport.interface';
import { TransportPlugin, PluginRegistry, PluginStructure } from './plugin.interface';
import { RedisStreamsPlugin } from '../plugins/redis';
import { MemoryTransportPlugin } from '../plugins/memory';

export interface TransportFactoryConfig {
  enableValidation?: boolean;
  strictMode?: boolean;
  autoDiscoverPlugins?: boolean;
  pluginPaths?: string[];
}

// Generic transport config interface for the factory
export interface GenericTransportConfig {
  type: string;
  options: any;
}

export class TransportFactory implements PluginRegistry {
  private config: TransportFactoryConfig;
  private plugins: Map<string, TransportPlugin> = new Map();
  private pluginStructures: Map<string, PluginStructure> = new Map();
  
  constructor(config: TransportFactoryConfig = {}) {
    this.config = {
      enableValidation: true,
      strictMode: false,
      autoDiscoverPlugins: false,
      pluginPaths: [],
      ...config
    };
    
    // Register built-in plugins
    this.registerBuiltInPlugins();
    
    // Auto-discover external plugins if enabled
    if (this.config.autoDiscoverPlugins) {
      this.discoverPlugins();
    }
  }
  
  // Plugin registry implementation with improved typing
  registerPlugin<TConfig = any>(plugin: TransportPlugin<TConfig>): void {
    this.plugins.set(plugin.name, plugin);
    this.pluginStructures.set(plugin.name, plugin.getPluginStructure());
    plugin.onRegister?.();
  }
  
  unregisterPlugin(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.onUnregister?.();
      this.plugins.delete(name);
      this.pluginStructures.delete(name);
    }
  }
  
  getPlugin<TConfig = any>(name: string): TransportPlugin<TConfig> | undefined {
    return this.plugins.get(name) as TransportPlugin<TConfig>;
  }
  
  getAllPlugins(): Map<string, TransportPlugin> {
    return new Map(this.plugins);
  }
  
  getSupportedTypes(): string[] {
    return Array.from(this.plugins.keys());
  }
  
  // New plugin structure methods
  getPluginStructure(name: string): PluginStructure | undefined {
    return this.pluginStructures.get(name);
  }
  
  getAllPluginStructures(): Map<string, PluginStructure> {
    return new Map(this.pluginStructures);
  }
  
  // Transport creation with generic config
  createTransport(config: GenericTransportConfig): Transport {
    const plugin = this.plugins.get(config.type);
    if (!plugin) {
      const availablePlugins = Array.from(this.plugins.keys()).join(', ');
      throw new Error(`Transport plugin '${config.type}' not found. Available: ${availablePlugins}`);
    }
    
    // Validate config using plugin
    const validation = plugin.validateConfig(config.options);
    if (!validation.valid) {
      throw new Error(`Invalid config for transport '${config.type}': ${validation.errors.join(', ')}`);
    }
    
    // Create transport
    const transport = plugin.createTransport(config.options);
    
    // Validate transport capabilities if strict mode is enabled
    if (this.config.enableValidation && this.config.strictMode) {
      const capabilityValidation = this.validateTransportCapabilities(transport, plugin.capabilities);
      if (capabilityValidation.errors.length > 0) {
        throw new Error(`Transport capability validation failed: ${capabilityValidation.errors.join(', ')}`);
      }
    }
    
    return transport;
  }
  
  // Convenience method for creating transports with plugin-specific configs
  createTransportWithPlugin<T>(pluginName: string, config: T): Transport {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      const availablePlugins = Array.from(this.plugins.keys()).join(', ');
      throw new Error(`Transport plugin '${pluginName}' not found. Available: ${availablePlugins}`);
    }
    
    // Validate config using plugin
    const validation = plugin.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config for transport '${pluginName}': ${validation.errors.join(', ')}`);
    }
    
    // Create transport
    const transport = plugin.createTransport(config);
    
    // Validate transport capabilities if strict mode is enabled
    if (this.config.enableValidation && this.config.strictMode) {
      const capabilityValidation = this.validateTransportCapabilities(transport, plugin.capabilities);
      if (capabilityValidation.errors.length > 0) {
        throw new Error(`Transport capability validation failed: ${capabilityValidation.errors.join(', ')}`);
      }
    }
    
    return transport;
  }
  
  // Private methods
  private registerBuiltInPlugins(): void {
    this.registerPlugin(new RedisStreamsPlugin());
    this.registerPlugin(new MemoryTransportPlugin());
  }
  
  private async discoverPlugins(): Promise<void> {
    // Future: Implement plugin discovery from file system or registry
    // For now, this is a placeholder for future extensibility
    console.log('Plugin discovery not yet implemented');
  }
  
  private validateTransportCapabilities(transport: Transport, expectedCapabilities: TransportCapabilities): {
    warnings: string[];
    errors: string[];
  } {
    const warnings: string[] = [];
    const errors: string[] = [];
    
    const actualCapabilities = transport.capabilities;
    
    // Validate core capabilities
    if (expectedCapabilities.supportsPublishing && !actualCapabilities.supportsPublishing) {
      errors.push('Transport does not support publishing');
    }
    
    if (expectedCapabilities.supportsSubscription && !actualCapabilities.supportsSubscription) {
      errors.push('Transport does not support subscription');
    }
    
    // Validate optional capabilities
    if (expectedCapabilities.supportsBatching && !actualCapabilities.supportsBatching) {
      warnings.push('Transport does not support batching');
    }
    
    if (expectedCapabilities.supportsPatternRouting && !actualCapabilities.supportsPatternRouting) {
      warnings.push('Transport does not support pattern routing');
    }
    
    return { warnings, errors };
  }
}

// Factory function
export function createTransportFactory(config?: TransportFactoryConfig): TransportFactory {
  return new TransportFactory(config);
}
