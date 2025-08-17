import { TransportPlugin, PluginStructure } from '../../event-transport/plugin.interface';
import { Transport, TransportCapabilities } from '../../event-transport/transport.interface';
import { MemoryTransport } from './transport/memory-transport';

export interface MemoryTransportConfig {
  originPrefix?: string;
}

export class MemoryTransportPlugin implements TransportPlugin {
  name = 'memory';
  version = '1.0.0';
  
  capabilities: TransportCapabilities = {
    supportsPublishing: true,
    supportsSubscription: true,
    supportsBatching: false,
    supportsPartitioning: false,
    supportsOrdering: true,
    supportsPatternRouting: true,
    supportsConsumerGroups: false,
    supportsDeadLetterQueues: false,
    supportsMessageRetention: false,
    supportsMessageCompression: false,
    maxMessageSize: 1024 * 1024, // 1MB
    maxBatchSize: 1,
    maxTopics: 1000,
    maxPartitions: 1,
    maxConsumerGroups: 0,
    supportsPersistence: false,
    supportsReplication: false,
    supportsFailover: false,
    supportsTransactions: false,
    supportsMetrics: true,
    supportsTracing: false,
    supportsHealthChecks: true
  };
  
  createTransport(config: MemoryTransportConfig): Transport {
    return new MemoryTransport({
      originPrefix: config.originPrefix
    });
  }
  
  validateConfig(config: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Validate originPrefix if provided
    if (config.originPrefix !== undefined) {
      if (typeof config.originPrefix !== 'string') {
        errors.push('originPrefix must be a string');
      } else if (config.originPrefix.includes(' ')) {
        errors.push('originPrefix cannot contain spaces');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  getDefaultConfig(): MemoryTransportConfig {
    return {
      originPrefix: undefined
    };
  }
  
  getPluginStructure(): PluginStructure {
    return {
      transport: './transport/memory-transport',
      exports: []
    };
  }
  
  onRegister(): void {
    console.log(`Memory Transport plugin v${this.version} registered`);
  }
  
  onUnregister(): void {
    console.log('Memory Transport plugin unregistered');
  }
}
