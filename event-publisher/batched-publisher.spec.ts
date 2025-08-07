import { BatchedEventPublisher, BatchConfig } from './batched-publisher';
import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';
import { EventValidator } from '../event-types';

// Mock validator
const mockValidator: EventValidator = {
  validate: jest.fn().mockReturnValue({ valid: true }),
  getSchema: jest.fn().mockReturnValue({
    parse: jest.fn(),
  }),
} as any; // Type as any to allow jest mocking

// Mock ClientProxy
class MockClientProxy extends ClientProxy {
  emit<TResult = any, TInput = any>(pattern: any, data: TInput) {
    return of(undefined as TResult);
  }
  
  dispatchEvent<T = any>(packet: any): Promise<T> {
    return Promise.resolve(undefined as T);
  }
  
  connect(): Promise<any> {
    return Promise.resolve(undefined);
  }
  
  close(): Promise<any> {
    return Promise.resolve(undefined);
  }
  
  send<TResult = any, TInput = any>(pattern: any, data: TInput) {
    return of(undefined as TResult);
  }
  
  publish(packet: any, callback: any): () => void {
    return () => {};
  }
}

describe('BatchedEventPublisher', () => {
  let publisher: BatchedEventPublisher;
  let redis: MockClientProxy;
  let consoleTransport: MockClientProxy;
  let mockEmit: jest.SpyInstance;
  let mockDispatchEvent: jest.SpyInstance;
  let mockConsoleDispatchEvent: jest.SpyInstance;

  const defaultBatchConfig: BatchConfig = {
    maxSize: 5,
    maxWaitMs: 100,
    maxConcurrentBatches: 3,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redis = new MockClientProxy();
    consoleTransport = new MockClientProxy();
    mockEmit = jest.spyOn(redis, 'emit');
    mockDispatchEvent = jest.spyOn(redis, 'dispatchEvent');
    mockConsoleDispatchEvent = jest.spyOn(consoleTransport, 'dispatchEvent');
    
    // Reset mock validator
    (mockValidator.validate as jest.Mock).mockReturnValue({ valid: true });
    
    publisher = new BatchedEventPublisher({
      redis,
      console: consoleTransport,
    }, {
      originServiceName: 'test-service',
      validator: mockValidator,
      batchConfig: defaultBatchConfig,
      transportType: 'redis',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create publisher with batch config', () => {
      expect(publisher).toBeDefined();
      expect(publisher.validator).toBe(mockValidator);
    });
  });

  describe('publish', () => {
    it('should add message to batch queue', async () => {
      await publisher.addMessage('user.updated', { userId: '123' });

      // Message should be in queue but not sent yet
      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });

    it('should validate messages before adding to queue', async () => {
      (mockValidator.validate as jest.Mock).mockReturnValue({ valid: false, error: 'Invalid data' });

      await expect(publisher.addMessage('user.updated', { invalid: 'data' })).rejects.toThrow('Invalid event body for type user.updated: Invalid data');
    });

    it('should flush batch when max size is reached', async () => {
      const config: BatchConfig = { maxSize: 2, maxWaitMs: 1000, maxConcurrentBatches: 3 };
      publisher = new BatchedEventPublisher({ redis }, { originServiceName: 'test-service', validator: mockValidator, batchConfig: config });
      (mockValidator.validate as jest.Mock).mockReturnValue({ valid: true }); // Ensure validator returns valid for this test

      // Mock dispatchEvent to fail for batch, so it falls back to individual messages
      mockDispatchEvent.mockRejectedValueOnce(new Error('Batch transport error'));

      await publisher.addMessage('user.updated', { userId: '1' });
      await publisher.addMessage('user.updated', { userId: '2' });

      await new Promise(resolve => setTimeout(resolve, 10)); // Wait a bit for async processing

      // Should have sent individual messages (since batch failed and fell back)
      expect(mockDispatchEvent).toHaveBeenCalledTimes(2);
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'user-events:user.updated',
          data: expect.objectContaining({
            header: expect.objectContaining({
              type: 'test-service.user.updated',
              id: expect.any(String),
              timestamp: expect.any(String), // Original operation timestamp
            }),
            body: expect.any(Object),
          }),
        }),
        expect.any(Object)
      );
    });

    it('should flush batch when max wait time is reached', async () => {
      const config: BatchConfig = { maxSize: 10, maxWaitMs: 50, maxConcurrentBatches: 3 };
      publisher = new BatchedEventPublisher({ redis }, { originServiceName: 'test-service', validator: mockValidator, batchConfig: config });
      (mockValidator.validate as jest.Mock).mockReturnValue({ valid: true });

      // Mock dispatchEvent to fail for batch, so it falls back to individual messages
      mockDispatchEvent.mockRejectedValueOnce(new Error('Batch transport error'));

      await publisher.addMessage('user.updated', { userId: '123' });

      // Wait for the timer to trigger flush
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have sent individual message (since batch failed and fell back)
      expect(mockDispatchEvent).toHaveBeenCalledTimes(1);
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'user-events:user.updated',
          data: expect.objectContaining({
            header: expect.objectContaining({
              type: 'test-service.user.updated',
              id: expect.any(String),
              timestamp: expect.any(String), // Original operation timestamp
            }),
            body: expect.any(Object),
          }),
        }),
        expect.any(Object)
      );
    });

    it('should force flush all queues', async () => {
      // Mock dispatchEvent to fail for batch, so it falls back to individual messages
      // The batch send uses the 'console' transport, so we need to mock that
      mockConsoleDispatchEvent.mockRejectedValue(new Error('Batch transport error'));

      // Also mock the redis transport for individual messages
      mockDispatchEvent.mockRejectedValue(new Error('Individual transport error'));

      await publisher.addMessage('user.updated', { userId: '1' });
      await publisher.addMessage('order.created', { orderId: 'ord-1' });

      await publisher.flush();

      // Should have sent individual messages for both event types (since batch failed and fell back)
      // The redis transport is called for user.updated (which matches the user. pattern)
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'user-events:user.updated',
          data: expect.objectContaining({
            header: expect.objectContaining({
              type: 'test-service.user.updated',
              id: expect.any(String),
              timestamp: expect.any(String), // Original operation timestamp
            }),
            body: expect.any(Object),
          }),
        }),
        expect.any(Object)
      );
      // The console transport is called for order.created (which doesn't match any patterns)
      expect(mockConsoleDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'order.created',
          data: expect.objectContaining({
            header: expect.objectContaining({
              type: 'test-service.order.created',
            }),
            body: expect.any(Object),
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe('publishBatch', () => {
    it('should send batch immediately', async () => {
      const messages = [
        { userId: '1' },
        { userId: '2' },
        { userId: '3' },
      ];

      // Mock the strategy's sendBatch method to fail
      const originalSendBatch = publisher['strategy'].sendBatch;
      publisher['strategy'].sendBatch = jest.fn().mockRejectedValue(new Error('Batch transport error'));

      // Mock dispatchEvent to fail for individual messages too
      mockDispatchEvent.mockRejectedValue(new Error('Individual transport error'));

      await publisher.publishBatch('user.updated', messages);

      // Should have sent individual messages (since batch failed and fell back)
      expect(mockDispatchEvent).toHaveBeenCalledTimes(3);
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'user-events:user.updated',
          data: expect.objectContaining({
            header: expect.objectContaining({
              type: 'test-service.user.updated',
              id: expect.any(String),
              timestamp: expect.any(String), // Original operation timestamp
            }),
            body: expect.any(Object),
          }),
        }),
        expect.any(Object)
      );

      // Restore original method
      publisher['strategy'].sendBatch = originalSendBatch;
    });

    it('should handle publishBatch with multiple messages', async () => {
      const messages = [
        { userId: '1' },
        { userId: '2' },
        { userId: '3' },
      ];

      // Mock the strategy's sendBatch method to fail
      const originalSendBatch = publisher['strategy'].sendBatch;
      publisher['strategy'].sendBatch = jest.fn().mockRejectedValue(new Error('Batch transport error'));

      // Mock dispatchEvent to fail for individual messages too
      mockDispatchEvent.mockRejectedValue(new Error('Individual transport error'));

      await publisher.publishBatch('user.updated', messages);

      // Should have sent individual messages (since batch failed and fell back)
      expect(mockDispatchEvent).toHaveBeenCalledTimes(3);
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'user-events:user.updated',
          data: expect.objectContaining({
            header: expect.objectContaining({
              type: 'test-service.user.updated',
              id: expect.any(String),
              timestamp: expect.any(String), // Original operation timestamp
            }),
            body: expect.any(Object),
          }),
        }),
        expect.any(Object)
      );

      // Restore original method
      publisher['strategy'].sendBatch = originalSendBatch;
    });

    it('should handle publishBatch with empty array', async () => {
      await publisher.publishBatch('user.updated', []);

      // Should not send anything
      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('should force flush all queues', async () => {
      // Mock dispatchEvent to fail for batch, so it falls back to individual messages
      // The batch send uses the 'console' transport, so we need to mock that
      mockConsoleDispatchEvent.mockRejectedValue(new Error('Batch transport error'));

      // Also mock the redis transport for individual messages
      mockDispatchEvent.mockRejectedValue(new Error('Individual transport error'));

      await publisher.addMessage('user.updated', { userId: '1' });
      await publisher.addMessage('order.created', { orderId: 'ord-1' });

      await publisher.flush();

      // Should have sent individual messages for both event types (since batch failed and fell back)
      // The redis transport is called for user.updated (which matches the user. pattern)
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'user-events:user.updated',
          data: expect.objectContaining({
            header: expect.objectContaining({
              type: 'test-service.user.updated',
              id: expect.any(String),
              timestamp: expect.any(String), // Original operation timestamp
            }),
            body: expect.any(Object),
          }),
        }),
        expect.any(Object)
      );
      // The console transport is called for order.created (which doesn't match any patterns)
      expect(mockConsoleDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'order.created',
          data: expect.objectContaining({
            header: expect.objectContaining({
              type: 'test-service.order.created',
            }),
            body: expect.any(Object),
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe('failed messages', () => {
    it('should track failed messages', async () => {
      // Mock the strategy's sendBatch method to fail
      const originalSendBatch = publisher['strategy'].sendBatch;
      publisher['strategy'].sendBatch = jest.fn().mockRejectedValue(new Error('Batch transport error'));

      // Mock dispatchEvent to fail for individual messages too
      mockDispatchEvent.mockRejectedValue(new Error('Individual transport error'));

      await publisher.addMessage('user.updated', { userId: '1' });
      await publisher.addMessage('user.updated', { userId: '2' });

      await publisher.flush();

      // Wait longer for async processing to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      const failedMessages = publisher.getFailedMessages();
      expect(failedMessages).toHaveLength(2);
      expect(failedMessages[0].body).toEqual({ userId: '1' });
      expect(failedMessages[1].body).toEqual({ userId: '2' });
    });

    it('should clear failed messages', async () => {
      // Mock the strategy's sendBatch method to fail
      const originalSendBatch = publisher['strategy'].sendBatch;
      publisher['strategy'].sendBatch = jest.fn().mockRejectedValue(new Error('Batch transport error'));

      // Mock dispatchEvent to fail for individual messages too
      mockDispatchEvent.mockRejectedValue(new Error('Individual transport error'));

      await publisher.addMessage('user.updated', { userId: '1' });
      await publisher.flush();

      // Wait longer for async processing to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      const failedMessages = publisher.getFailedMessages();
      expect(failedMessages).toHaveLength(1);

      publisher.clearFailedMessages();
      expect(publisher.getFailedMessages()).toHaveLength(0);
    });

    it('should respect concurrent batch limits', async () => {
      const config: BatchConfig = { maxSize: 1, maxWaitMs: 1000, maxConcurrentBatches: 1 };
      publisher = new BatchedEventPublisher({ redis }, { originServiceName: 'test-service', validator: mockValidator, batchConfig: config });
      (mockValidator.validate as jest.Mock).mockReturnValue({ valid: true });

      // Mock the strategy's sendBatch method to be very slow (never completes)
      const originalSendBatch = publisher['strategy'].sendBatch;
      publisher['strategy'].sendBatch = jest.fn().mockImplementation(() => 
        new Promise(() => {}) // Never resolves or rejects
      );

      // Start first batch (this will never complete due to the mock)
      const promise1 = publisher.addMessage('user.updated', { userId: '1' });
      
      // Wait a bit to ensure the first batch has started
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Try to start second batch - this should fail due to concurrent batch limit
      const promise2 = publisher.addMessage('order.created', { orderId: '1' });

      // The first promise should never resolve (batch is stuck)
      // The second promise should fail due to concurrent batch limits
      await expect(promise2).rejects.toThrow('Too many concurrent batches');
    });
  });

  describe('batching type strategy', () => {
    it('should batch by exact event type when strategy is exact', async () => {
      const publisher = new BatchedEventPublisher({
        redis,
        console: new MockClientProxy(),
      }, {
        originServiceName: 'test-service',
        validator: mockValidator,
        batchConfig: {
          maxSize: 10,
          maxWaitMs: 1000,
          maxConcurrentBatches: 5,
          batchingTypeStrategy: 'exact',
        },
        transportType: 'redis',
        typePrefix: 'test',
      });

      // These should be in separate batches because they're different event types
      await publisher.addMessage('user.register', { userId: '1' });
      await publisher.addMessage('user.login', { userId: '2' });
      await publisher.addMessage('user.register', { userId: '3' }); // Same as first

      await publisher.flush();

      // Should have 2 separate batches: one for 'user.register' and one for 'user.login'
      expect(publisher['queues'].size).toBe(2);
    });

    it('should batch by position 0 (first token) when strategy is 0', async () => {
      const publisher = new BatchedEventPublisher({
        redis,
        console: new MockClientProxy(),
      }, {
        originServiceName: 'test-service',
        validator: mockValidator,
        batchConfig: {
          maxSize: 10,
          maxWaitMs: 1000,
          maxConcurrentBatches: 5,
          batchingTypeStrategy: 0,
        },
        transportType: 'redis',
        typePrefix: 'test',
      });

      // These should be in the same batch because they all start with 'user'
      await publisher.addMessage('user.register', { userId: '1' });
      await publisher.addMessage('user.login', { userId: '2' });
      await publisher.addMessage('user.logout', { userId: '3' });

      await publisher.flush();

      // Should have 1 batch because all events start with 'user'
      expect(publisher['queues'].size).toBe(1);
    });

    it('should batch by position 1 (second token) when strategy is 1', async () => {
      const publisher = new BatchedEventPublisher({
        redis,
        console: new MockClientProxy(),
      }, {
        originServiceName: 'test-service',
        validator: mockValidator,
        batchConfig: {
          maxSize: 10,
          maxWaitMs: 1000,
          maxConcurrentBatches: 5,
          batchingTypeStrategy: 1,
        },
        transportType: 'redis',
        typePrefix: 'test',
      });

      // These should be in separate batches because 'user.register' != 'user.login'
      await publisher.addMessage('user.register', { userId: '1' });
      await publisher.addMessage('user.login', { userId: '2' });
      await publisher.addMessage('user.register', { userId: '3' }); // Same as first

      await publisher.flush();

      // Should have 2 separate batches: one for 'user.register' and one for 'user.login'
      expect(publisher['queues'].size).toBe(2);
    });

    it('should handle position beyond available tokens', async () => {
      const publisher = new BatchedEventPublisher({
        redis,
        console: new MockClientProxy(),
      }, {
        originServiceName: 'test-service',
        validator: mockValidator,
        batchConfig: {
          maxSize: 10,
          maxWaitMs: 1000,
          maxConcurrentBatches: 5,
          batchingTypeStrategy: 5, // Beyond the available tokens
        },
        transportType: 'redis',
        typePrefix: 'test',
      });

      // These should be in separate batches because position 5 doesn't exist
      await publisher.addMessage('user.register', { userId: '1' });
      await publisher.addMessage('user.login', { userId: '2' });

      await publisher.flush();

      // Should have 2 separate batches because position 5 doesn't exist, so it uses exact matching
      expect(publisher['queues'].size).toBe(2);
    });
  });
});
