import { Transport, TransportCapabilities } from './transport.interface';

// Generic plugin interface for better type safety
export interface TransportPlugin<TConfig = any> {
  name: string;
  version: string;
  capabilities: TransportCapabilities;
  
  // Core plugin methods with proper typing
  createTransport(config: TConfig): Transport;
  validateConfig(config: TConfig): { valid: boolean; errors: string[] };
  getDefaultConfig(): TConfig;
  
  // Plugin structure information
  getPluginStructure(): PluginStructure;
  
  // Optional lifecycle hooks
  onRegister?(): void;
  onUnregister?(): void;
}

// Plugin structure information
export interface PluginStructure {
  transport?: string; // Path to transport implementation
  routing?: string[]; // Paths to routing implementations
  tools?: string[];   // Paths to tool implementations
  exports?: string[]; // Additional exports from the plugin
}

// Plugin registry interface
export interface PluginRegistry {
  registerPlugin<TConfig = any>(plugin: TransportPlugin<TConfig>): void;
  unregisterPlugin(name: string): void;
  getPlugin<TConfig = any>(name: string): TransportPlugin<TConfig> | undefined;
  getAllPlugins(): Map<string, TransportPlugin>;
  getSupportedTypes(): string[];
  
  // New methods for plugin structure
  getPluginStructure(name: string): PluginStructure | undefined;
  getAllPluginStructures(): Map<string, PluginStructure>;
}
