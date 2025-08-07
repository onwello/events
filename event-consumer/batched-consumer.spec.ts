import { BatchedEventConsumer, BatchedEventConsumerOptions } from './batched-consumer';
import { EventValidator } from '../event-types';
import { BatchEnvelope, BatchMessage } from '../event-publisher/batched-publisher';

// Mock validator
const mockValidator: EventValidator = {
  validate: jest.fn().mockReturnValue({ valid: true }),
  getSchema: jest.fn().mockReturnValue({
    parse: jest.fn(),
  }),
} as any;

describe('BatchedEventConsumer', () => {
  let consumer: BatchedEventConsumer;
  let mockHandler: jest.MockedFunction<any>;
  let mockErrorHandler: jest.MockedFunction<any>;

  const defaultOptions: BatchedEventConsumerOptions = {
    handlers: { 'user.updated': jest.fn() },
    validator: mockValidator,
    processBatchInOrder: true,
    maxConcurrentBatches: 5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHandler = jest.fn();
    mockErrorHandler = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create consumer with batch processing', () => {
      consumer = new BatchedEventConsumer({
        ...defaultOptions,
        handlers: { 'user.updated': mockHandler },
      });
      
      expect(consumer).toBeDefined();
      expect(consumer.activeBatchCount).toBe(0);
    });

    it('should register batch handler', () => {
      consumer = new BatchedEventConsumer(defaultOptions);
      
      // Should have registered 'batch' handler
      expect(consumer.handlers['batch']).toBeDefined();
    });
  });

  describe('batch processing', () => {
    beforeEach(() => {
      consumer = new BatchedEventConsumer({
        ...defaultOptions,
        handlers: { 'user.updated': mockHandler },
      });
    });

    it('should process batch messages in order', async () => {
      const batchEnvelope: BatchEnvelope = {
        header: {
          type: 'batch',
          messageCount: 3,
          batchId: 'batch-123',
          timestamp: '2023-01-01T00:00:00Z',
        },
        body: {
          messages: [
            {
              eventType: 'user.updated',
              body: { userId: '1' },
              originalId: 'msg-1',
              timestamp: '2023-01-01T00:00:00Z',
              envelope: {
                header: {
                  id: 'msg-1',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:00Z',
                  hash: 'hash1',
                  version: '1.0.0',
                },
                body: { userId: '1' },
              },
            },
            {
              eventType: 'user.updated',
              body: { userId: '2' },
              originalId: 'msg-2',
              timestamp: '2023-01-01T00:00:01Z',
              envelope: {
                header: {
                  id: 'msg-2',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:01Z',
                  hash: 'hash2',
                  version: '1.0.0',
                },
                body: { userId: '2' },
              },
            },
            {
              eventType: 'user.updated',
              body: { userId: '3' },
              originalId: 'msg-3',
              timestamp: '2023-01-01T00:00:02Z',
              envelope: {
                header: {
                  id: 'msg-3',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:02Z',
                  hash: 'hash3',
                  version: '1.0.0',
                },
                body: { userId: '3' },
              },
            },
          ],
        },
      };

      await consumer.handleMessage(batchEnvelope);

      // Should have called handler 3 times in order
      expect(mockHandler).toHaveBeenCalledTimes(3);
      expect(mockHandler).toHaveBeenNthCalledWith(1, { userId: '1' }, expect.any(Object), expect.any(Object));
      expect(mockHandler).toHaveBeenNthCalledWith(2, { userId: '2' }, expect.any(Object), expect.any(Object));
      expect(mockHandler).toHaveBeenNthCalledWith(3, { userId: '3' }, expect.any(Object), expect.any(Object));
    });

    it('should handle mixed event types in batch', async () => {
      const userHandler = jest.fn();
      const orderHandler = jest.fn();
      
      consumer = new BatchedEventConsumer({
        ...defaultOptions,
        handlers: {
          'user.updated': userHandler,
          'order.created': orderHandler,
        },
      });

      const batchEnvelope: BatchEnvelope = {
        header: {
          type: 'batch',
          messageCount: 2,
          batchId: 'batch-123',
          timestamp: '2023-01-01T00:00:00Z',
        },
        body: {
          messages: [
            {
              eventType: 'user.updated',
              body: { userId: '1' },
              originalId: 'msg-1',
              timestamp: '2023-01-01T00:00:00Z',
              envelope: {
                header: {
                  id: 'msg-1',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:00Z',
                  hash: 'hash1',
                  version: '1.0.0',
                },
                body: { userId: '1' },
              },
            },
            {
              eventType: 'order.created',
              body: { orderId: 'ord-1' },
              originalId: 'msg-2',
              timestamp: '2023-01-01T00:00:01Z',
              envelope: {
                header: {
                  id: 'msg-2',
                  type: 'order.created',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:01Z',
                  hash: 'hash2',
                  version: '1.0.0',
                },
                body: { orderId: 'ord-1' },
              },
            },
          ],
        },
      };

      await consumer.handleMessage(batchEnvelope);

      expect(userHandler).toHaveBeenCalledWith({ userId: '1' }, expect.any(Object), expect.any(Object));
      expect(orderHandler).toHaveBeenCalledWith({ orderId: 'ord-1' }, expect.any(Object), expect.any(Object));
    });

    it('should ignore unregistered event types in batch', async () => {
      const batchEnvelope: BatchEnvelope = {
        header: {
          type: 'batch',
          messageCount: 2,
          batchId: 'batch-123',
          timestamp: '2023-01-01T00:00:00Z',
        },
        body: {
          messages: [
            {
              eventType: 'user.updated',
              body: { userId: '1' },
              originalId: 'msg-1',
              timestamp: '2023-01-01T00:00:00Z',
              envelope: {
                header: {
                  id: 'msg-1',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:00Z',
                  hash: 'hash1',
                  version: '1.0.0',
                },
                body: { userId: '1' },
              },
            },
            {
              eventType: 'unknown.event',
              body: { data: 'unknown' },
              originalId: 'msg-2',
              timestamp: '2023-01-01T00:00:01Z',
              envelope: {
                header: {
                  id: 'msg-2',
                  type: 'unknown.event',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:01Z',
                  hash: 'hash2',
                  version: '1.0.0',
                },
                body: { data: 'unknown' },
              },
            },
          ],
        },
      };

      await consumer.handleMessage(batchEnvelope);

      // Should only call handler for registered event type
      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith({ userId: '1' }, expect.any(Object), expect.any(Object));
    });

    it('should handle individual message failures gracefully', async () => {
      mockHandler
        .mockResolvedValueOnce(undefined) // First call succeeds
        .mockRejectedValueOnce(new Error('Handler error')) // Second call fails
        .mockResolvedValueOnce(undefined); // Third call succeeds

      const batchEnvelope: BatchEnvelope = {
        header: {
          type: 'batch',
          messageCount: 3,
          batchId: 'batch-123',
          timestamp: '2023-01-01T00:00:00Z',
        },
        body: {
          messages: [
            {
              eventType: 'user.updated',
              body: { userId: '1' },
              originalId: 'msg-1',
              timestamp: '2023-01-01T00:00:00Z',
              envelope: {
                header: {
                  id: 'msg-1',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:00Z',
                  hash: 'hash1',
                  version: '1.0.0',
                },
                body: { userId: '1' },
              },
            },
            {
              eventType: 'user.updated',
              body: { userId: '2' },
              originalId: 'msg-2',
              timestamp: '2023-01-01T00:00:01Z',
              envelope: {
                header: {
                  id: 'msg-2',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:01Z',
                  hash: 'hash2',
                  version: '1.0.0',
                },
                body: { userId: '2' },
              },
            },
            {
              eventType: 'user.updated',
              body: { userId: '3' },
              originalId: 'msg-3',
              timestamp: '2023-01-01T00:00:02Z',
              envelope: {
                header: {
                  id: 'msg-3',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:02Z',
                  hash: 'hash3',
                  version: '1.0.0',
                },
                body: { userId: '3' },
              },
            },
          ],
        },
      };

      // Should not throw, should process all messages
      await expect(consumer.handleMessage(batchEnvelope)).resolves.toBeUndefined();

      // Should have called handler 3 times despite one failure
      expect(mockHandler).toHaveBeenCalledTimes(3);
    });
  });

  describe('concurrent batch limits', () => {
    it('should respect maxConcurrentBatches', async () => {
      consumer = new BatchedEventConsumer({
        ...defaultOptions,
        maxConcurrentBatches: 1,
      });

      const batchEnvelope: BatchEnvelope = {
        header: {
          type: 'batch',
          messageCount: 1,
          batchId: 'batch-123',
          timestamp: '2023-01-01T00:00:00Z',
        },
        body: {
          messages: [
            {
              eventType: 'user.updated',
              body: { userId: '1' },
              originalId: 'msg-1',
              timestamp: '2023-01-01T00:00:00Z',
              envelope: {
                header: {
                  id: 'msg-1',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:00Z',
                  hash: 'hash1',
                  version: '1.0.0',
                },
                body: { userId: '1' },
              },
            },
          ],
        },
      };

      // Mock handler to be slow
      mockHandler.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

      // Start first batch
      const promise1 = consumer.handleMessage(batchEnvelope);
      
      // Try to start second batch immediately
      const promise2 = consumer.handleMessage(batchEnvelope);

      await expect(Promise.all([promise1, promise2])).rejects.toThrow('Too many concurrent batches being processed');
    });
  });

  describe('concurrent processing', () => {
    it('should process messages concurrently when processBatchInOrder is false', async () => {
      consumer = new BatchedEventConsumer({
        ...defaultOptions,
        processBatchInOrder: false,
        handlers: { 'user.updated': mockHandler },
      });

      const batchEnvelope: BatchEnvelope = {
        header: {
          type: 'batch',
          messageCount: 3,
          batchId: 'batch-123',
          timestamp: '2023-01-01T00:00:00Z',
        },
        body: {
          messages: [
            {
              eventType: 'user.updated',
              body: { userId: '1' },
              originalId: 'msg-1',
              timestamp: '2023-01-01T00:00:00Z',
              envelope: {
                header: {
                  id: 'msg-1',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:00Z',
                  hash: 'hash1',
                  version: '1.0.0',
                },
                body: { userId: '1' },
              },
            },
            {
              eventType: 'user.updated',
              body: { userId: '2' },
              originalId: 'msg-2',
              timestamp: '2023-01-01T00:00:01Z',
              envelope: {
                header: {
                  id: 'msg-2',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:01Z',
                  hash: 'hash2',
                  version: '1.0.0',
                },
                body: { userId: '2' },
              },
            },
            {
              eventType: 'user.updated',
              body: { userId: '3' },
              originalId: 'msg-3',
              timestamp: '2023-01-01T00:00:02Z',
              envelope: {
                header: {
                  id: 'msg-3',
                  type: 'user.updated',
                  origin: 'test-service',
                  timestamp: '2023-01-01T00:00:02Z',
                  hash: 'hash3',
                  version: '1.0.0',
                },
                body: { userId: '3' },
              },
            },
          ],
        },
      };

      await consumer.handleMessage(batchEnvelope);

      // Should have called handler 3 times (regardless of order)
      expect(mockHandler).toHaveBeenCalledTimes(3);
      
      // Verify all messages were processed
      expect(mockHandler).toHaveBeenCalledWith({ userId: '1' }, expect.any(Object), expect.any(Object));
      expect(mockHandler).toHaveBeenCalledWith({ userId: '2' }, expect.any(Object), expect.any(Object));
      expect(mockHandler).toHaveBeenCalledWith({ userId: '3' }, expect.any(Object), expect.any(Object));
    });
  });
});
