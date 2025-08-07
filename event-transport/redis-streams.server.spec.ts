// Jest test file: uses Jest globals (describe, it, expect, jest)
import { Server, CustomTransportStrategy } from '@nestjs/microservices';
import Redis from 'ioredis';
import { RedisStreamsServer } from './redis-streams.server';
import { RedisStreamConsumer } from '../event-consumer/redis-streams-consumer';

// Mock the RedisStreamConsumer
jest.mock('../event-consumer/redis-streams-consumer');
const MockRedisStreamConsumer = RedisStreamConsumer as jest.MockedClass<typeof RedisStreamConsumer>;

// Mock Redis constructor
const mockRedis = {
  xgroup: jest.fn(),
  quit: jest.fn(),
} as unknown as jest.Mocked<Redis>;

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockRedis),
  };
});

describe('RedisStreamsServer', () => {
  let server: RedisStreamsServer;
  let mockHandler: jest.MockedFunction<any>;
  let mockCallback: jest.MockedFunction<() => void>;
  let mockConsumer: jest.Mocked<RedisStreamConsumer>;

  beforeEach(() => {
    jest.clearAllMocks();
    MockRedisStreamConsumer.mockClear();
    
    mockHandler = jest.fn();
    mockCallback = jest.fn();

    mockConsumer = {
      start: jest.fn(),
      stop: jest.fn(),
    } as unknown as jest.Mocked<RedisStreamConsumer>;
    
    MockRedisStreamConsumer.mockImplementation(() => mockConsumer);
    server = new RedisStreamsServer({
      host: 'localhost',
      port: 6379,
      stream: 'test-stream',
      group: 'test-group',
      consumer: 'test-consumer',
    });
  });

  afterEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    // Ensure server is properly closed after each test
    if (server) {
      await server.close();
    }
  });

  afterAll(async () => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should extend Server and implement CustomTransportStrategy', () => {
      expect(server).toBeInstanceOf(Server);
      expect(server).toBeDefined();
    });

    it('should accept options with dead letter stream', () => {
      const serverWithDeadLetter = new RedisStreamsServer({
        host: 'localhost',
        port: 6379,
        stream: 'test-stream',
        group: 'test-group',
        deadLetterStream: 'dead-letter-stream',
      });
      expect(serverWithDeadLetter).toBeDefined();
    });
  });

  describe('listen', () => {
    it('should create consumer group and start polling', async () => {
      // Mock the getHandlers method
      const mockGetHandlers = jest.fn().mockReturnValue(new Map([
        ['user.updated', mockHandler],
      ]));
      server.getHandlers = mockGetHandlers;

      // Mock the RedisStreamConsumer instance
      const mockConsumerInstance = {
        pollAndHandle: jest.fn(),
        stop: jest.fn(),
      };
      MockRedisStreamConsumer.mockImplementation(() => mockConsumerInstance as any);

      await server.listen(mockCallback);

      expect(mockRedis.xgroup).toHaveBeenCalledWith(
        'CREATE', 'test-stream', 'test-group', '$', 'MKSTREAM'
      );
      expect(MockRedisStreamConsumer).toHaveBeenCalledWith({
        redis: mockRedis,
        stream: 'test-stream',
        group: 'test-group',
        consumer: 'test-consumer',
        handlers: {
          'user.updated': expect.any(Function),
        },
        blockMs: 10000,
        deadLetterStream: undefined,
        verbose: false,
        onError: expect.any(Function),
      });
      expect(mockCallback).toHaveBeenCalled();
    });

    it('should handle consumer group creation errors gracefully', async () => {
      const mockGetHandlers = jest.fn().mockReturnValue(new Map());
      server.getHandlers = mockGetHandlers;

      const mockConsumerInstance = {
        pollAndHandle: jest.fn(),
        stop: jest.fn(),
      };
      MockRedisStreamConsumer.mockImplementation(() => mockConsumerInstance as any);

      // Mock xgroup to throw BUSYGROUP error (which should be ignored)
      mockRedis.xgroup.mockRejectedValue(new Error('BUSYGROUP Consumer Group name already exists'));

      await server.listen(mockCallback);

      expect(mockRedis.xgroup).toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalled();
    });

    it('should map NestJS handlers to event handlers', async () => {
      const mockNestHandler = jest.fn();
      const mockGetHandlers = jest.fn().mockReturnValue(new Map([
        ['user.updated', mockNestHandler],
      ]));
      server.getHandlers = mockGetHandlers;

      const mockConsumerInstance = {
        pollAndHandle: jest.fn(),
        stop: jest.fn(),
      };
      MockRedisStreamConsumer.mockImplementation(() => mockConsumerInstance as any);

      await server.listen(mockCallback);

      // Get the wrapped handler that was passed to RedisStreamConsumer
      const wrappedHandler = MockRedisStreamConsumer.mock.calls[0][0].handlers['user.updated'];
      
      const testPayload = { userId: '1', changes: {} };
      const testHeader = { 
        id: '123', 
        type: 'user.updated', 
        origin: 'test', 
        timestamp: '2023-01-01T00:00:00Z',
        hash: 'abc123',
        version: '1.0.0'
      };

      await wrappedHandler(testPayload, testHeader);

      expect(mockNestHandler).toHaveBeenCalledWith(testPayload);
      expect(mockNestHandler).not.toHaveBeenCalledWith(testHeader);
    });

    it('should set up error logging with verbose option', async () => {
      const verboseServer = new RedisStreamsServer({
        host: 'localhost',
        port: 6379,
        stream: 'test-stream',
        group: 'test-group',
        verbose: true,
      });

      const mockGetHandlers = jest.fn().mockReturnValue(new Map([
        ['user.updated', mockHandler],
      ]));
      verboseServer.getHandlers = mockGetHandlers;

      const mockConsumerInstance = {
        pollAndHandle: jest.fn(),
        stop: jest.fn(),
      };
      MockRedisStreamConsumer.mockImplementation(() => mockConsumerInstance as any);

      await verboseServer.listen(mockCallback);

      // Get the error handler that was passed to RedisStreamConsumer
      const errorHandler = MockRedisStreamConsumer.mock.calls[0][0].onError;
      
      const testError = new Error('Test error');
      const testEnvelope = { 
        header: { 
          type: 'user.updated',
          id: '123',
          origin: 'test',
          timestamp: '2023-01-01T00:00:00Z',
          hash: 'abc123',
          version: '1.0.0'
        }, 
        body: {} 
      };

      // Mock console.error to verify it's called
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      if (errorHandler) {
        errorHandler(testError, 'user.updated', testEnvelope);
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        '[RedisStreamsServer] Error for event user.updated: Test error'
      );

      consoleSpy.mockRestore();
      
      // Clean up the verbose server
      await verboseServer.close();
    });
  });

  describe('close', () => {
    it('should stop the consumer and close Redis connection', async () => {
      const mockGetHandlers = jest.fn().mockReturnValue(new Map([
        ['user.updated', mockHandler],
      ]));
      server.getHandlers = mockGetHandlers;

      const mockConsumerInstance = {
        pollAndHandle: jest.fn(),
        stop: jest.fn(),
      };
      MockRedisStreamConsumer.mockImplementation(() => mockConsumerInstance as any);

      await server.listen(mockCallback);
      await server.close();

      expect(mockConsumerInstance.stop).toHaveBeenCalled();
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
}); 