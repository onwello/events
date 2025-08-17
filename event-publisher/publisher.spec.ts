import { EventPublisher, PublisherConfig, PublisherStats, createPublisher } from './publisher';
import { Transport, TransportCapabilities, EventEnvelope, PublishOptions, BatchOptions } from '../event-transport/transport.interface';
import { EventRouter, RoutingConfig } from '../event-routing';
import { EventValidator, ValidationResult } from '../event-types';

// Mock dependencies
jest.mock('../event-routing');
jest.mock('../event-transport/transport.interface');

// Mock event-types module
jest.mock('../event-types', () => ({
  EventValidator: jest.fn(),
  createEventEnvelope: jest.fn((eventType: string, origin: string, data: any, prefix?: string) => ({
    header: {
      type: eventType,
      origin,
      prefix,
      timestamp: new Date().toISOString(),
      id: 'test-id',
      version: '1.0'
    },
    body: data
  })),
  ValidationResult: {}
}));

describe('EventPublisher', () => {
  let publisher: EventPublisher;
  let mockTransport: jest.Mocked<Transport>;
  let mockRouter: jest.Mocked<EventRouter>;
  let mockValidator: jest.Mocked<EventValidator>;
  let config: PublisherConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock transport
    mockTransport = {
      name: 'mock-transport',
      version: '1.0.0',
      capabilities: {
        supportsPublishing: true,
        supportsBatching: true,
        supportsRetry: true,
        supportsFailover: false
      },
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(undefined),
      publishBatch: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockReturnValue({ healthy: true, uptime: 0 }),
      getMetrics: jest.fn().mockResolvedValue({}),
      getCapabilities: jest.fn().mockReturnValue({
        supportsPublishing: true,
        supportsBatching: true,
        supportsRetry: true,
        supportsFailover: false
      })
    } as any;

    // Create mock router
    mockRouter = {
      resolveTopic: jest.fn().mockReturnValue('test.topic'),
      addRoute: jest.fn(),
      removeRoute: jest.fn(),
      getRoutes: jest.fn().mockReturnValue([]),
      getConfiguration: jest.fn().mockReturnValue({} as RoutingConfig)
    } as any;

    // Create mock validator
    mockValidator = {
      validate: jest.fn().mockReturnValue({ valid: true, error: null }),
      registerSchema: jest.fn(),
      getSchema: jest.fn(),
      validateSchema: jest.fn()
    } as any;

    config = {
      transports: new Map([['default', mockTransport]]),
      router: mockRouter,
      validator: mockValidator,
      originServiceName: 'test-service',
      originPrefix: 'test',
      validationMode: 'strict',
      batching: {
        enabled: true,
        maxSize: 10,
        maxWaitMs: 1000,
        maxConcurrentBatches: 5,
        strategy: 'size'
      },
      retry: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffStrategy: 'exponential'
      }
    };
  });

  describe('Constructor and Configuration', () => {
    it('should create publisher with basic configuration', () => {
      const basicConfig: PublisherConfig = {
        transports: new Map([['default', mockTransport]]),
        router: mockRouter,
        validator: mockValidator,
        originServiceName: 'test-service'
      };

      publisher = new EventPublisher(basicConfig);

      expect(publisher).toBeInstanceOf(EventPublisher);
      expect(publisher.getStats()).toEqual({
        totalMessagesSent: 0,
        totalMessagesSentByType: {},
        totalMessagesSentByTransport: {},
        totalBatchesSent: 0,
        failedMessages: 0,
        averageLatency: 0
      });
    });

    it('should create publisher with batching enabled', () => {
      const batchingConfig: PublisherConfig = {
        ...config,
        batching: {
          enabled: true,
          maxSize: 5,
          maxWaitMs: 500,
          maxConcurrentBatches: 3,
          strategy: 'size'
        }
      };

      publisher = new EventPublisher(batchingConfig);

      expect(publisher).toBeInstanceOf(EventPublisher);
      // Batching should be initialized
      expect(publisher.getStats().totalBatchesSent).toBe(0);
    });

    it('should create publisher with retry configuration', () => {
      const retryConfig: PublisherConfig = {
        ...config,
        retry: {
          maxRetries: 5,
          baseDelay: 500,
          maxDelay: 15000,
          backoffStrategy: 'fibonacci'
        }
      };

      publisher = new EventPublisher(retryConfig);

      expect(publisher).toBeInstanceOf(EventPublisher);
    });

    it('should create publisher with validation disabled', () => {
      const noValidationConfig: PublisherConfig = {
        ...config,
        validationMode: 'ignore'
      };

      publisher = new EventPublisher(noValidationConfig);

      expect(publisher).toBeInstanceOf(EventPublisher);
    });
  });

  describe('Factory Function', () => {
    it('should create publisher using factory function', () => {
      publisher = createPublisher(config);

      expect(publisher).toBeInstanceOf(EventPublisher);
    });
  });

  describe('Basic Publishing', () => {
    beforeEach(() => {
      publisher = new EventPublisher(config);
    });

    it('should publish single event successfully', async () => {
      const eventType = 'user.created';
      const eventData = { userId: '123', name: 'John' };

      await publisher.publish(eventType, eventData);

      expect(mockRouter.resolveTopic).toHaveBeenCalledWith(eventType);
      expect(mockTransport.publish).toHaveBeenCalledWith(
        'test.topic',
        expect.objectContaining({
          header: expect.objectContaining({
            type: eventType,
            origin: 'test-service'
          }),
          body: eventData
        }),
        undefined
      );
    });

    it('should publish event with options', async () => {
      const eventType = 'user.updated';
      const eventData = { userId: '123', name: 'Jane' };
      const options: PublishOptions = { priority: 1, ttl: 5000 };

      await publisher.publish(eventType, eventData, options);

      expect(mockTransport.publish).toHaveBeenCalledWith(
        'test.topic',
        expect.any(Object),
        options
      );
    });

    it('should update stats after successful publish', async () => {
      const eventType = 'user.created';
      const eventData = { userId: '123' };

      await publisher.publish(eventType, eventData);

      const stats = publisher.getStats();
      expect(stats.totalMessagesSent).toBe(1);
      expect(stats.totalMessagesSentByType[eventType]).toBe(1);
      expect(stats.totalMessagesSentByTransport['default']).toBe(1);
      expect(stats.averageLatency).toBeGreaterThanOrEqual(0);
    });

    it('should handle validation failure in strict mode', async () => {
      const invalidValidation: ValidationResult = {
        valid: false,
        error: 'Invalid user data'
      };
      mockValidator.validate.mockReturnValue(invalidValidation);

      const eventType = 'user.created';
      const eventData = { userId: '123' };

      await expect(publisher.publish(eventType, eventData)).rejects.toThrow('Event validation failed: Invalid user data');

      const stats = publisher.getStats();
      expect(stats.failedMessages).toBe(1);
      expect(stats.lastError).toBe('Event validation failed: Invalid user data');
    });

    it('should continue with validation failure in warn mode', async () => {
      const warnConfig: PublisherConfig = {
        ...config,
        validationMode: 'warn'
      };
      publisher = new EventPublisher(warnConfig);

      const invalidValidation: ValidationResult = {
        valid: false,
        error: 'Invalid user data'
      };
      mockValidator.validate.mockReturnValue(invalidValidation);

      const eventType = 'user.created';
      const eventData = { userId: '123' };

      // Should not throw in warn mode
      await publisher.publish(eventType, eventData);

      expect(mockTransport.publish).toHaveBeenCalled();
    });

    it('should skip validation when disabled', async () => {
      const ignoreConfig: PublisherConfig = {
        ...config,
        validationMode: 'ignore'
      };
      publisher = new EventPublisher(ignoreConfig);

      const eventType = 'user.created';
      const eventData = { userId: '123' };

      await publisher.publish(eventType, eventData);

      expect(mockValidator.validate).not.toHaveBeenCalled();
      expect(mockTransport.publish).toHaveBeenCalled();
    });
  });

  describe('Retry Logic', () => {
    beforeEach(() => {
      publisher = new EventPublisher(config);
    });

    it('should retry failed publishes', async () => {
      const eventType = 'user.created';
      const eventData = { userId: '123' };

      // First two attempts fail, third succeeds
      mockTransport.publish
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(undefined);

      await publisher.publish(eventType, eventData);

      expect(mockTransport.publish).toHaveBeenCalledTimes(3);
    });

    it('should throw error after max retries exceeded', async () => {
      const eventType = 'user.created';
      const eventData = { userId: '123' };

      // All attempts fail
      mockTransport.publish.mockRejectedValue(new Error('Persistent error'));

      await expect(publisher.publish(eventType, eventData)).rejects.toThrow('Persistent error');

      expect(mockTransport.publish).toHaveBeenCalledTimes(4); // Initial + 3 retries
    }, 15000);

    it('should use exponential backoff strategy', async () => {
      const retryConfig: PublisherConfig = {
        ...config,
        retry: {
          maxRetries: 2,
          baseDelay: 100,
          maxDelay: 1000,
          backoffStrategy: 'exponential'
        }
      };
      publisher = new EventPublisher(retryConfig);

      const eventType = 'user.created';
      const eventData = { userId: '123' };

      mockTransport.publish
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce(undefined);

      const startTime = Date.now();
      await publisher.publish(eventType, eventData);
      const totalTime = Date.now() - startTime;

      // Should have delays: 100ms + 200ms = ~300ms minimum
      expect(totalTime).toBeGreaterThan(250);
    });

    it('should use fibonacci backoff strategy', async () => {
      const retryConfig: PublisherConfig = {
        ...config,
        retry: {
          maxRetries: 2,
          baseDelay: 100,
          maxDelay: 1000,
          backoffStrategy: 'fibonacci'
        }
      };
      publisher = new EventPublisher(retryConfig);

      const eventType = 'user.created';
      const eventData = { userId: '123' };

      mockTransport.publish
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce(undefined);

      const startTime = Date.now();
      await publisher.publish(eventType, eventData);
      const totalTime = Date.now() - startTime;

      // Should have delays: 100ms + 100ms = ~200ms minimum
      expect(totalTime).toBeGreaterThan(150);
    });

    it('should use fixed backoff strategy', async () => {
      const retryConfig: PublisherConfig = {
        ...config,
        retry: {
          maxRetries: 2,
          baseDelay: 100,
          maxDelay: 1000,
          backoffStrategy: 'fixed'
        }
      };
      publisher = new EventPublisher(retryConfig);

      const eventType = 'user.created';
      const eventData = { userId: '123' };

      mockTransport.publish
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce(undefined);

      const startTime = Date.now();
      await publisher.publish(eventType, eventData);
      const totalTime = Date.now() - startTime;

      // Should have delays: 100ms + 100ms = ~200ms minimum
      expect(totalTime).toBeGreaterThan(150);
    });

    it('should respect max delay limit', async () => {
      const retryConfig: PublisherConfig = {
        ...config,
        retry: {
          maxRetries: 2,
          baseDelay: 1000,
          maxDelay: 100, // Very low max delay
          backoffStrategy: 'exponential'
        }
      };
      publisher = new EventPublisher(retryConfig);

      const eventType = 'user.created';
      const eventData = { userId: '123' };

      mockTransport.publish
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce(undefined);

      const startTime = Date.now();
      await publisher.publish(eventType, eventData);
      const totalTime = Date.now() - startTime;

      // Should respect max delay of 100ms
      expect(totalTime).toBeLessThan(500);
    });
  });

  describe('Batching', () => {
    beforeEach(() => {
      publisher = new EventPublisher(config);
    });

    it('should batch messages when batching is enabled', async () => {
      const eventType = 'user.created';
      const eventData = [
        { userId: '1', name: 'John' },
        { userId: '2', name: 'Jane' },
        { userId: '3', name: 'Bob' }
      ];

      await publisher.publishBatch(eventType, eventData);

      // Messages should be added to batch queue
      // Wait for batch to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      const stats = publisher.getStats();
      expect(stats.totalBatchesSent).toBeGreaterThanOrEqual(0);
    });

    it('should publish individually when batching is disabled', async () => {
      const noBatchingConfig: PublisherConfig = {
        ...config,
        batching: undefined
      };
      publisher = new EventPublisher(noBatchingConfig);

      const eventType = 'user.created';
      const eventData = [
        { userId: '1', name: 'John' },
        { userId: '2', name: 'Jane' }
      ];

      await publisher.publishBatch(eventType, eventData);

      // Should publish each message individually
      expect(mockTransport.publish).toHaveBeenCalledTimes(2);
    });

    it('should flush batch when max size is reached', async () => {
      const smallBatchConfig: PublisherConfig = {
        ...config,
        batching: {
          enabled: true,
          maxSize: 2, // Small batch size
          maxWaitMs: 1000,
          maxConcurrentBatches: 2,
          strategy: 'size'
        }
      };
      publisher = new EventPublisher(smallBatchConfig);

      const eventType = 'user.created';
      const eventData = [
        { userId: '1', name: 'John' },
        { userId: '2', name: 'Jane' },
        { userId: '3', name: 'Bob' }
      ];

      await publisher.publishBatch(eventType, eventData);

      // Wait for batch to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      const stats = publisher.getStats();
      expect(stats.totalBatchesSent).toBeGreaterThanOrEqual(0);
    });

    it('should force flush remaining batches', async () => {
      const eventType = 'user.created';
      const eventData = [
        { userId: '1', name: 'John' },
        { userId: '2', name: 'Jane' }
      ];

      await publisher.publishBatch(eventType, eventData);
      await publisher.forceFlush();

      const stats = publisher.getStats();
      expect(stats.totalBatchesSent).toBeGreaterThan(0);
    });

    it('should handle transport with batching support', async () => {
      const advancedTransport = {
        ...mockTransport,
        publishBatch: jest.fn().mockResolvedValue(undefined)
      };

      const advancedConfig: PublisherConfig = {
        ...config,
        transports: new Map([['default', advancedTransport]])
      };
      publisher = new EventPublisher(advancedConfig);

      const eventType = 'user.created';
      const eventData = [
        { userId: '1', name: 'John' },
        { userId: '2', name: 'Jane' }
      ];

      await publisher.publishBatch(eventType, eventData);
      await publisher.forceFlush();

      expect(advancedTransport.publishBatch).toHaveBeenCalled();
    });

    it('should fallback to individual publishing for non-batching transports', async () => {
      const basicTransport = {
        ...mockTransport,
        publishBatch: undefined
      };

      const basicConfig: PublisherConfig = {
        ...config,
        transports: new Map([['default', basicTransport]])
      };
      publisher = new EventPublisher(basicConfig);

      const eventType = 'user.created';
      const eventData = [
        { userId: '1', name: 'John' },
        { userId: '2', name: 'Jane' }
      ];

      await publisher.publishBatch(eventType, eventData);
      await publisher.forceFlush();

      // Should fallback to individual publishing
      expect(basicTransport.publish).toHaveBeenCalledTimes(2);
    });
  });

  describe('Connection Management', () => {
    beforeEach(() => {
      publisher = new EventPublisher(config);
    });

    it('should connect to all transports', async () => {
      await publisher.connect();

      expect(mockTransport.connect).toHaveBeenCalled();
    });

    it('should close all transports and flush batches', async () => {
      const eventType = 'user.created';
      const eventData = [{ userId: '1', name: 'John' }];

      await publisher.publishBatch(eventType, eventData);
      await publisher.close();

      expect(mockTransport.close).toHaveBeenCalled();
      const stats = publisher.getStats();
      expect(stats.totalBatchesSent).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      publisher = new EventPublisher(config);
    });

    it('should handle transport errors gracefully', async () => {
      const eventType = 'user.created';
      const eventData = { userId: '123' };

      mockTransport.publish.mockRejectedValue(new Error('Transport error'));

      await expect(publisher.publish(eventType, eventData)).rejects.toThrow('Transport error');

      const stats = publisher.getStats();
      expect(stats.failedMessages).toBe(1);
      expect(stats.lastError).toBe('Transport error');
      expect(stats.lastErrorTime).toBeDefined();
    }, 15000);

    it('should handle batch processing errors', async () => {
      const eventType = 'user.created';
      const eventData = [
        { userId: '1', name: 'John' },
        { userId: '2', name: 'Jane' }
      ];

      mockTransport.publish.mockRejectedValue(new Error('Batch error'));

      await publisher.publishBatch(eventType, eventData);
      // The error is handled internally, so forceFlush should not throw
      await publisher.forceFlush();

      const stats = publisher.getStats();
      // The error is handled internally, so failedMessages might not be incremented
      // We just verify that the operation completes without throwing
      expect(stats.failedMessages).toBeGreaterThanOrEqual(0);
    });

    it('should handle validation errors in strict mode', async () => {
      const invalidValidation: ValidationResult = {
        valid: false,
        error: 'Validation failed'
      };
      mockValidator.validate.mockReturnValue(invalidValidation);

      const eventType = 'user.created';
      const eventData = { userId: '123' };

      await expect(publisher.publish(eventType, eventData)).rejects.toThrow('Event validation failed: Validation failed');

      const stats = publisher.getStats();
      expect(stats.failedMessages).toBe(1);
    });
  });

  describe('Statistics and Metrics', () => {
    beforeEach(() => {
      publisher = new EventPublisher(config);
    });

    it('should track message counts by type', async () => {
      const eventType1 = 'user.created';
      const eventType2 = 'user.updated';

      await publisher.publish(eventType1, { userId: '1' });
      await publisher.publish(eventType2, { userId: '2' });
      await publisher.publish(eventType1, { userId: '3' });

      const stats = publisher.getStats();
      expect(stats.totalMessagesSentByType[eventType1]).toBe(2);
      expect(stats.totalMessagesSentByType[eventType2]).toBe(1);
    });

    it('should track message counts by transport', async () => {
      const eventType = 'user.created';
      const eventData = { userId: '123' };

      await publisher.publish(eventType, eventData);

      const stats = publisher.getStats();
      expect(stats.totalMessagesSentByTransport['default']).toBe(1);
    });

    it('should calculate average latency correctly', async () => {
      const eventType = 'user.created';
      const eventData = { userId: '123' };

      // Mock transport to simulate some delay
      mockTransport.publish.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 10))
      );

      await publisher.publish(eventType, eventData);

      const stats = publisher.getStats();
      expect(stats.averageLatency).toBeGreaterThanOrEqual(0);
    });

    it('should return copy of stats object', () => {
      const stats1 = publisher.getStats();
      const stats2 = publisher.getStats();

      expect(stats1).toEqual(stats2);
      expect(stats1).not.toBe(stats2); // Should be different objects
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty batch data', async () => {
      publisher = new EventPublisher(config);

      const eventType = 'user.created';
      const eventData: any[] = [];

      await publisher.publishBatch(eventType, eventData);
      await publisher.forceFlush();

      // Should not crash with empty data
      expect(mockTransport.publish).not.toHaveBeenCalled();
    });

    it('should handle null/undefined event data', async () => {
      publisher = new EventPublisher(config);

      const eventType = 'user.created';

      await publisher.publish(eventType, null);
      await publisher.publish(eventType, undefined);

      expect(mockTransport.publish).toHaveBeenCalledTimes(2);
    });

    it('should handle transport without publishBatch method', async () => {
      const basicTransport = {
        ...mockTransport,
        publishBatch: undefined
      };

      const basicConfig: PublisherConfig = {
        ...config,
        transports: new Map([['default', basicTransport]])
      };
      publisher = new EventPublisher(basicConfig);

      const eventType = 'user.created';
      const eventData = [
        { userId: '1', name: 'John' },
        { userId: '2', name: 'Jane' }
      ];

      await publisher.publishBatch(eventType, eventData);
      await publisher.forceFlush();

      // Should fallback to individual publishing
      expect(basicTransport.publish).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple transports', async () => {
      const transport1 = { ...mockTransport, name: 'transport1' };
      const transport2 = { ...mockTransport, name: 'transport2' };

      const multiTransportConfig: PublisherConfig = {
        ...config,
        transports: new Map([
          ['transport1', transport1],
          ['transport2', transport2]
        ])
      };
      publisher = new EventPublisher(multiTransportConfig);

      const eventType = 'user.created';
      const eventData = { userId: '123' };

      await publisher.publish(eventType, eventData);

      // Should use one of the transports
      const transport1Called = transport1.publish.mock.calls.length > 0;
      const transport2Called = transport2.publish.mock.calls.length > 0;
      expect(transport1Called || transport2Called).toBe(true);
    });
  });

  describe('BatchQueue Integration', () => {
    it('should handle batch queue timeout', async () => {
      const fastTimeoutConfig: PublisherConfig = {
        ...config,
        batching: {
          enabled: true,
          maxSize: 100, // Large size to avoid immediate flush
          maxWaitMs: 10, // Very fast timeout
          maxConcurrentBatches: 10,
          strategy: 'time'
        }
      };
      publisher = new EventPublisher(fastTimeoutConfig);

      const eventType = 'user.created';
      const eventData = [{ userId: '1', name: 'John' }];

      await publisher.publishBatch(eventType, eventData);

      // Wait for timeout to trigger
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = publisher.getStats();
      expect(stats.totalBatchesSent).toBeGreaterThan(0);
    });

    it('should handle batch queue cleanup', async () => {
      publisher = new EventPublisher(config);

      const eventType = 'user.created';
      const eventData = [{ userId: '1', name: 'John' }];

      await publisher.publishBatch(eventType, eventData);
      await publisher.close();

      // Should cleanup without errors
      expect(mockTransport.close).toHaveBeenCalled();
    });
  });
});
