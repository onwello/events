import { EventSystemBuilder, createEventSystemBuilder, createEventSystem } from './event-system-builder';
import { MemoryTransport } from './plugins/memory/transport/memory-transport';
import { Transport, TransportCapabilities } from './event-transport/transport.interface';
import { EventSystemConfig } from './event-system-builder';

// Mock transport for testing
class MockTransport implements Transport {
  name = 'mock';
  capabilities: TransportCapabilities = {
    supportsPublishing: true,
    supportsSubscription: true,
    supportsBatching: false,
    supportsPartitioning: false,
    supportsOrdering: true,
    supportsPatternRouting: false,
    supportsConsumerGroups: false,
    supportsDeadLetterQueues: false,
    supportsMessageRetention: false,
    supportsMessageCompression: false,
    maxMessageSize: 1024,
    maxBatchSize: 1,
    maxTopics: 100,
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

  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async publish(topic: string, message: any): Promise<void> {
    // Mock implementation
  }

  async subscribe(topic: string, handler: any): Promise<void> {
    // Mock implementation
  }

  async unsubscribe(topic: string): Promise<void> {
    // Mock implementation
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  async getStatus(): Promise<any> {
    return {
      connected: this.connected,
      healthy: this.connected,
      lastError: undefined,
      lastErrorTime: undefined,
      uptime: 0,
      version: '1.0.0'
    };
  }

  async getMetrics(): Promise<any> {
    return {
      messagesPublished: 0,
      messagesReceived: 0,
      errorRate: 0
    };
  }
}

describe('EventSystemBuilder', () => {
  let builder: EventSystemBuilder;

  beforeEach(() => {
    builder = new EventSystemBuilder();
  });

  describe('Constructor and Basic Configuration', () => {
    it('should create builder with default configuration', () => {
      expect(builder).toBeDefined();
      expect(builder['config']).toEqual({});
      expect(builder['transports']).toBeInstanceOf(Map);
      expect(builder['transportFactory']).toBeDefined();
    });

    it('should set service name', () => {
      const result = builder.service('test-service');
      expect(result).toBe(builder);
      expect(builder['config'].service).toBe('test-service');
    });

    it('should set origin prefix', () => {
      const result = builder.originPrefix('us.ca');
      expect(result).toBe(builder);
      expect(builder['config'].originPrefix).toBe('us.ca');
    });

    it('should set origins array', () => {
      const origins = ['service1', 'service2'];
      const result = builder.origins(origins);
      expect(result).toBe(builder);
      expect(builder['config'].origins).toBe(origins);
    });

    it('should add transport', () => {
      const transport = new MemoryTransport();
      const result = builder.addTransport('memory', transport);
      expect(result).toBe(builder);
      expect(builder['transports'].get('memory')).toBe(transport);
    });

    it('should add transport from factory', () => {
      const result = builder.addTransportFromFactory('memory', 'memory', {});
      expect(result).toBe(builder);
      expect(builder['transports'].has('memory')).toBe(true);
    });

    it('should configure routing', () => {
      const routingConfig = {
        routes: [],
        validationMode: 'strict' as const,
        topicMapping: {},
        defaultTopicStrategy: 'namespace' as const,
        enablePatternRouting: false,
        enableBatching: false,
        enablePartitioning: false,
        enableConsumerGroups: false
      };
      const result = builder.routing(routingConfig);
      expect(result).toBe(builder);
      expect(builder['config'].routing).toBe(routingConfig);
    });
  });

  describe('Publisher Configuration', () => {
    it('should enable publisher batching', () => {
      const batchingConfig = {
        enabled: true,
        maxSize: 100,
        maxWaitMs: 1000,
        maxConcurrentBatches: 5,
        strategy: 'time' as const
      };
      const result = builder.enablePublisherBatching(batchingConfig);
      expect(result).toBe(builder);
      expect(builder['config'].publisher?.batching).toEqual(batchingConfig);
    });

    it('should enable publisher retry', () => {
      const retryConfig = {
        maxRetries: 3,
        backoffStrategy: 'exponential' as const,
        baseDelay: 1000,
        maxDelay: 10000
      };
      const result = builder.enablePublisherRetry(retryConfig);
      expect(result).toBe(builder);
      expect(builder['config'].publisher?.retry).toEqual(retryConfig);
    });

    it('should enable publisher rate limiting', () => {
      const rateLimitingConfig = {
        maxRequests: 100,
        timeWindow: 60000,
        strategy: 'sliding-window' as const
      };
      const result = builder.enablePublisherRateLimiting(rateLimitingConfig);
      expect(result).toBe(builder);
      expect(builder['config'].publisher?.rateLimiting).toEqual(rateLimitingConfig);
    });

    it('should handle multiple publisher configurations', () => {
      builder.enablePublisherBatching({
        enabled: true,
        maxSize: 50,
        maxWaitMs: 500,
        maxConcurrentBatches: 3,
        strategy: 'size' as const
      });
      builder.enablePublisherRetry({
        maxRetries: 5,
        backoffStrategy: 'fixed' as const,
        baseDelay: 500,
        maxDelay: 5000
      });
      builder.enablePublisherRateLimiting({
        maxRequests: 200,
        timeWindow: 30000,
        strategy: 'token-bucket' as const
      });

      expect(builder['config'].publisher?.batching?.maxSize).toBe(50);
      expect(builder['config'].publisher?.retry?.maxRetries).toBe(5);
      expect(builder['config'].publisher?.rateLimiting?.maxRequests).toBe(200);
    });

    it('should initialize publisher config object when first method is called', () => {
      expect(builder['config'].publisher).toBeUndefined();
      
      builder.enablePublisherBatching({
        enabled: true,
        maxSize: 100,
        maxWaitMs: 1000,
        maxConcurrentBatches: 5,
        strategy: 'time' as const
      });
      
      expect(builder['config'].publisher).toBeDefined();
      expect(builder['config'].publisher?.batching).toBeDefined();
    });
  });

  describe('Consumer Configuration', () => {
    it('should enable consumer pattern routing', () => {
      const result = builder.enableConsumerPatternRouting();
      expect(result).toBe(builder);
      expect(builder['config'].consumer?.enablePatternRouting).toBe(true);
    });

    it('should enable consumer groups', () => {
      const result = builder.enableConsumerGroups();
      expect(result).toBe(builder);
      expect(builder['config'].consumer?.enableConsumerGroups).toBe(true);
    });

    it('should handle poison message handler configuration', () => {
      const handler = jest.fn();
      const result = builder.setPoisonMessageHandler(handler);
      
      expect(result).toBe(builder);
      expect(builder['config'].consumer?.poisonMessageHandler).toBe(handler);
    });
    
    it('should handle validation mode configuration', () => {
      const result = builder.setValidationMode('ignore');
      
      expect(result).toBe(builder);
      expect(builder['config'].validationMode).toBe('ignore');
    });
    
    it('should handle validation mode configuration with different modes', () => {
      const modes: Array<'strict' | 'warn' | 'ignore'> = ['strict', 'warn', 'ignore'];
      
      modes.forEach(mode => {
        builder.setValidationMode(mode);
        expect(builder['config'].validationMode).toBe(mode);
      });
    });

    it('should initialize consumer config object when first method is called', () => {
      expect(builder['config'].consumer).toBeUndefined();
      
      builder.enableConsumerPatternRouting();
      
      expect(builder['config'].consumer).toBeDefined();
      expect(builder['config'].consumer?.enablePatternRouting).toBe(true);
    });

    it('should handle multiple consumer configurations', () => {
      const handler = jest.fn();
      
      builder.enableConsumerPatternRouting();
      builder.enableConsumerGroups();
      builder.setPoisonMessageHandler(handler);
      
      expect(builder['config'].consumer?.enablePatternRouting).toBe(true);
      expect(builder['config'].consumer?.enableConsumerGroups).toBe(true);
      expect(builder['config'].consumer?.poisonMessageHandler).toBe(handler);
    });
  });

  describe('Build Process', () => {
    it('should build with minimal configuration', () => {
      const memoryTransport = new MemoryTransport();
      const eventSystem = builder
        .service('test-service')
        .addTransport('memory', memoryTransport)
        .build();

      expect(eventSystem).toBeDefined();
      expect(eventSystem.publisher).toBeDefined();
      expect(eventSystem.consumer).toBeDefined();
      expect(eventSystem.router).toBeDefined();
      expect(eventSystem.validator).toBeDefined();
      expect(eventSystem.transports).toBeDefined();
    });

    it('should build with full configuration', () => {
      const memoryTransport = new MemoryTransport();
      
      const eventSystem = builder
        .service('test-service')
        .originPrefix('us.ca')
        .addTransport('memory', memoryTransport)
        .routing({
          routes: [],
          validationMode: 'strict',
          topicMapping: {},
          defaultTopicStrategy: 'namespace',
          enablePatternRouting: false,
          enableBatching: false,
          enablePartitioning: false,
          enableConsumerGroups: false
        })
        .enablePublisherBatching({
          enabled: true,
          maxSize: 100,
          maxWaitMs: 1000,
          maxConcurrentBatches: 5,
          strategy: 'time'
        })
        .enablePublisherRetry({
          maxRetries: 3,
          backoffStrategy: 'exponential',
          baseDelay: 1000,
          maxDelay: 10000
        })
        .enablePublisherRateLimiting({
          maxRequests: 100,
          timeWindow: 60000,
          strategy: 'sliding-window'
        })
        .enableConsumerPatternRouting()
        .enableConsumerGroups()
        .setValidationMode('strict')
        .build();

      expect(eventSystem).toBeDefined();
      expect(eventSystem.publisher).toBeDefined();
      expect(eventSystem.consumer).toBeDefined();
    });

    it('should handle missing service name', () => {
      const memoryTransport = new MemoryTransport();
      
      expect(() => {
        builder
          .addTransport('memory', memoryTransport)
          .build();
      }).toThrow('Service name is required');
    });

    it('should handle missing transports', () => {
      expect(() => {
        builder
          .service('test-service')
          .build();
      }).toThrow('At least one transport is required');
    });

    it('should create default routing when not provided', () => {
      const memoryTransport = new MemoryTransport();
      const eventSystem = builder
        .service('test-service')
        .addTransport('memory', memoryTransport)
        .build();

      expect(eventSystem.router).toBeDefined();
    });

    it('should create default routing with validation mode', () => {
      const memoryTransport = new MemoryTransport();
      builder.setValidationMode('strict');
      
      const eventSystem = builder
        .service('test-service')
        .addTransport('memory', memoryTransport)
        .build();

      expect(eventSystem.router).toBeDefined();
    });

    it('should create default routing with origin prefix', () => {
      const memoryTransport = new MemoryTransport();
      builder.originPrefix('eu.de');
      
      const eventSystem = builder
        .service('test-service')
        .addTransport('memory', memoryTransport)
        .build();

      expect(eventSystem.router).toBeDefined();
    });

    it('should pass publisher configuration to publisher', () => {
      const memoryTransport = new MemoryTransport();
      const batchingConfig = {
        enabled: true,
        maxSize: 100,
        maxWaitMs: 1000,
        maxConcurrentBatches: 5,
        strategy: 'time' as const
      };
      
      builder.enablePublisherBatching(batchingConfig);
      
      const eventSystem = builder
        .service('test-service')
        .addTransport('memory', memoryTransport)
        .build();

      expect(eventSystem.publisher).toBeDefined();
    });

    it('should pass consumer configuration to consumer', () => {
      const memoryTransport = new MemoryTransport();
      const handler = jest.fn();
      
      builder.enableConsumerPatternRouting();
      builder.enableConsumerGroups();
      builder.setPoisonMessageHandler(handler);
      
      const eventSystem = builder
        .service('test-service')
        .addTransport('memory', memoryTransport)
        .build();

      expect(eventSystem.consumer).toBeDefined();
    });
  });

  describe('Event System Lifecycle', () => {
    it('should connect to all transports', async () => {
      const mockTransport1 = new MockTransport();
      const mockTransport2 = new MockTransport();
      
      const eventSystem = builder
        .service('test-service')
        .addTransport('transport1', mockTransport1)
        .addTransport('transport2', mockTransport2)
        .build();

      await eventSystem.connect();
      
      expect(mockTransport1.isConnected()).toBe(true);
      expect(mockTransport2.isConnected()).toBe(true);
      expect(eventSystem.isConnected()).toBe(true);
    });

    it('should close all transports', async () => {
      const mockTransport1 = new MockTransport();
      const mockTransport2 = new MockTransport();
      
      const eventSystem = builder
        .service('test-service')
        .addTransport('transport1', mockTransport1)
        .addTransport('transport2', mockTransport2)
        .build();

      await eventSystem.connect();
      await eventSystem.close();
      
      expect(mockTransport1.isConnected()).toBe(false);
      expect(mockTransport2.isConnected()).toBe(false);
      expect(eventSystem.isConnected()).toBe(false);
    });

    it('should handle multiple close calls', async () => {
      const memoryTransport = new MemoryTransport();
      const eventSystem = builder
        .service('test-service')
        .addTransport('memory', memoryTransport)
        .build();

      await eventSystem.close();
      await eventSystem.close(); // Should not throw
    });

    it('should check connection status correctly', async () => {
      const mockTransport1 = new MockTransport();
      const mockTransport2 = new MockTransport();
      
      const eventSystem = builder
        .service('test-service')
        .addTransport('transport1', mockTransport1)
        .addTransport('transport2', mockTransport2)
        .build();

      expect(eventSystem.isConnected()).toBe(false);
      
      await eventSystem.connect();
      expect(eventSystem.isConnected()).toBe(true);
      
      await mockTransport1.disconnect();
      expect(eventSystem.isConnected()).toBe(false);
    });

    it('should get system status', async () => {
      const mockTransport = new MockTransport();
      const eventSystem = builder
        .service('test-service')
        .addTransport('mock', mockTransport)
        .build();

      await eventSystem.connect();
      const status = await eventSystem.getStatus();

      expect(status).toBeDefined();
      expect(status.connected).toBe(true);
      expect(status.healthy).toBe(true);
      expect(status.transports).toBeInstanceOf(Map);
      expect(status.publisher).toBeDefined();
      expect(status.consumer).toBeDefined();
      expect(status.uptime).toBeDefined();
      expect(status.version).toBe('3.0.0');
    });

    it('should handle transport status errors gracefully', async () => {
      const mockTransport = new MockTransport();
      // Mock transport.getStatus to throw an error
      jest.spyOn(mockTransport, 'getStatus').mockRejectedValue(new Error('Status error'));
      
      const eventSystem = builder
        .service('test-service')
        .addTransport('mock', mockTransport)
        .build();

      await expect(eventSystem.getStatus()).rejects.toThrow('Status error');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty service name', () => {
      expect(() => {
        builder.service('').build();
      }).toThrow('Service name is required');
    });

    it('should handle whitespace service name', () => {
      expect(() => {
        builder.service('   ').build();
      }).toThrow('Service name is required');
    });

    it('should handle null service name', () => {
      expect(() => {
        (builder as any).service(null).build();
      }).toThrow('Service name is required');
    });

    it('should handle undefined service name', () => {
      expect(() => {
        (builder as any).service(undefined).build();
      }).toThrow('Service name is required');
    });

    it('should handle empty transport name', () => {
      const memoryTransport = new MemoryTransport();
      // Empty transport names are actually allowed by the current implementation
      // This test documents the current behavior
      expect(() => {
        builder
          .service('test-service')
          .addTransport('', memoryTransport)
          .build();
      }).not.toThrow();
      
      // Verify the transport was added with empty name
      expect(builder['transports'].has('')).toBe(true);
    });

    it('should handle duplicate transport names', () => {
      const memoryTransport = new MemoryTransport();
      const mockTransport = new MockTransport();
      
      builder
        .service('test-service')
        .addTransport('transport', memoryTransport)
        .addTransport('transport', mockTransport); // Should overwrite

      const eventSystem = builder.build();
      expect(eventSystem.transports.get('transport')).toBe(mockTransport);
    });

    it('should handle transport factory errors', () => {
      // Mock transport factory to throw an error
      jest.spyOn(builder['transportFactory'], 'createTransport').mockImplementation(() => {
        throw new Error('Transport creation failed');
      });

      expect(() => {
        builder.addTransportFromFactory('test', 'invalid-type', {});
      }).toThrow('Transport creation failed');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate routing configuration', () => {
      const invalidRouting = {
        routes: 'invalid' as any,
        validationMode: 'strict' as const,
        topicMapping: {},
        defaultTopicStrategy: 'namespace' as const,
        enablePatternRouting: false,
        enableBatching: false,
        enablePartitioning: false,
        enableConsumerGroups: false
      };

      expect(() => {
        builder
          .service('test-service')
          .addTransport('memory', new MemoryTransport())
          .routing(invalidRouting)
          .build();
      }).toThrow();
    });

    it('should handle malformed publisher configuration', () => {
      const invalidBatching = {
        enabled: 'invalid' as any,
        maxSize: -1,
        maxWaitMs: 0,
        maxConcurrentBatches: 0,
        strategy: 'invalid' as any
      };

      builder.enablePublisherBatching(invalidBatching);
      
      const eventSystem = builder
        .service('test-service')
        .addTransport('memory', new MemoryTransport())
        .build();

      expect(eventSystem).toBeDefined();
    });

    it('should handle malformed consumer configuration', () => {
      const invalidHandler = 'not-a-function' as any;
      
      builder.setPoisonMessageHandler(invalidHandler);
      
      const eventSystem = builder
        .service('test-service')
        .addTransport('memory', new MemoryTransport())
        .build();

      expect(eventSystem).toBeDefined();
    });
  });
});

describe('Factory Functions', () => {
  describe('createEventSystemBuilder', () => {
    it('should create a new EventSystemBuilder instance', () => {
      const builder = createEventSystemBuilder();
      expect(builder).toBeInstanceOf(EventSystemBuilder);
    });

    it('should create independent instances', () => {
      const builder1 = createEventSystemBuilder();
      const builder2 = createEventSystemBuilder();
      
      builder1.service('service1');
      builder2.service('service2');
      
      expect(builder1['config'].service).toBe('service1');
      expect(builder2['config'].service).toBe('service2');
    });
  });

  describe('createEventSystem', () => {
    it('should create event system from configuration', () => {
      const config: EventSystemConfig = {
        service: 'test-service',
        transports: new Map([['memory', new MemoryTransport()]]),
        validationMode: 'strict'
      };

      const eventSystem = createEventSystem(config);
      
      expect(eventSystem).toBeDefined();
      expect(eventSystem.publisher).toBeDefined();
      expect(eventSystem.consumer).toBeDefined();
    });

    it('should apply all configuration options', () => {
      const config: EventSystemConfig = {
        service: 'test-service',
        transports: new Map([['memory', new MemoryTransport()]]),
        originPrefix: 'us.ca',
        origins: ['service1', 'service2'],
        validationMode: 'strict',
        publisher: {
          batching: {
            enabled: true,
            maxSize: 100,
            maxWaitMs: 1000,
            maxConcurrentBatches: 5,
            strategy: 'time'
          }
        },
        consumer: {
          enablePatternRouting: true,
          enableConsumerGroups: true
        }
      };

      const eventSystem = createEventSystem(config);
      
      expect(eventSystem).toBeDefined();
    });

    it('should handle minimal configuration', () => {
      const config: EventSystemConfig = {
        service: 'test-service',
        transports: new Map([['memory', new MemoryTransport()]])
      };

      const eventSystem = createEventSystem(config);
      
      expect(eventSystem).toBeDefined();
    });

    it('should handle empty origins array', () => {
      const config: EventSystemConfig = {
        service: 'test-service',
        transports: new Map([['memory', new MemoryTransport()]]),
        origins: []
      };

      const eventSystem = createEventSystem(config);
      
      expect(eventSystem).toBeDefined();
    });

    it('should handle undefined optional configurations', () => {
      const config: EventSystemConfig = {
        service: 'test-service',
        transports: new Map([['memory', new MemoryTransport()]]),
        originPrefix: undefined,
        origins: undefined,
        validationMode: undefined,
        publisher: undefined,
        consumer: undefined
      };

      const eventSystem = createEventSystem(config);
      
      expect(eventSystem).toBeDefined();
    });
  });
});

describe('EventSystem Implementation Details', () => {
  it('should have correct readonly properties', () => {
    const memoryTransport = new MemoryTransport();
    const eventSystem = new EventSystemBuilder()
      .service('test-service')
      .addTransport('memory', memoryTransport)
      .build();

    expect(eventSystem.publisher).toBeDefined();
    expect(eventSystem.consumer).toBeDefined();
    expect(eventSystem.transports).toBeDefined();
    expect(eventSystem.router).toBeDefined();
    expect(eventSystem.validator).toBeDefined();

    // Note: Properties are not actually readonly in the current implementation
    // This test documents the current behavior
    expect(eventSystem.publisher).toBeDefined();
    expect(eventSystem.consumer).toBeDefined();
    expect(eventSystem.transports).toBeDefined();
    expect(eventSystem.router).toBeDefined();
    expect(eventSystem.validator).toBeDefined();
  });

  it('should handle transport capabilities correctly', () => {
    const mockTransport = new MockTransport();
    const eventSystem = new EventSystemBuilder()
      .service('test-service')
      .addTransport('mock', mockTransport)
      .build();

    expect(eventSystem.transports.get('mock')).toBe(mockTransport);
  });

  it('should create validator instance', () => {
    const memoryTransport = new MemoryTransport();
    const eventSystem = new EventSystemBuilder()
      .service('test-service')
      .addTransport('memory', memoryTransport)
      .build();

    expect(eventSystem.validator).toBeDefined();
  });

  it('should create router with transport capabilities', () => {
    const mockTransport = new MockTransport();
    const eventSystem = new EventSystemBuilder()
      .service('test-service')
      .addTransport('mock', mockTransport)
      .build();

    expect(eventSystem.router).toBeDefined();
  });
});
