// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="jest" />

import { RedisStreamConsumer } from './redis-streams-consumer';
import { EventConsumer } from './consumer';
import Redis from 'ioredis';

// Mock the EventConsumer
jest.mock('./consumer');
const MockEventConsumer = EventConsumer as jest.MockedClass<typeof EventConsumer>;

// Mock Redis with proper typing
const mockRedis = {
  xreadgroup: jest.fn(),
  xack: jest.fn(),
  xadd: jest.fn(),
} as unknown as jest.Mocked<Redis>;

describe('RedisStreamConsumer', () => {
  let consumer: RedisStreamConsumer;
  let mockRedis: any;
  let mockHandler: jest.Mock;
  let mockErrorHandler: jest.MockedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = {
      xreadgroup: jest.fn(),
      xack: jest.fn(),
      quit: jest.fn(),
      xadd: jest.fn(),
    };
    mockHandler = jest.fn();
    consumer = new RedisStreamConsumer({
      redis: mockRedis,
      stream: 'test-stream',
      group: 'test-group',
      consumer: 'test-consumer',
      handlers: { 'user.updated': mockHandler },
      blockMs: 1,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    jest.clearAllMocks();
    // Ensure consumer is stopped and Redis connection is closed
    if (consumer) {
      await consumer.stop();
    }
  });

  describe('constructor', () => {
    it('should create consumer with default options', () => {
      expect(MockEventConsumer).toHaveBeenCalledWith({
        handlers: { 'user.updated': mockHandler },
        onError: mockErrorHandler,
        validator: expect.any(Object), // Now includes validator
      });
      expect(consumer).toBeDefined();
    });

    it('should create consumer with custom options', () => {
      const customConsumer = new RedisStreamConsumer({
        redis: mockRedis,
        stream: 'custom-stream',
        group: 'custom-group',
        consumer: 'custom-consumer',
        handlers: { 'user.updated': mockHandler },
        blockMs: 1000,
        count: 5,
        deadLetterStream: 'dead-letter',
      });

      expect(customConsumer).toBeDefined();
    });
  });

  describe('stop method', () => {
    it('should stop the consumer', () => {
      expect(consumer.stop).toBeDefined();
      expect(typeof consumer.stop).toBe('function');
      
      // Test that stop method can be called
      expect(() => consumer.stop()).not.toThrow();
    });
  });

  describe('pollAndHandle method', () => {
    it('should be defined', () => {
      expect(consumer.pollAndHandle).toBeDefined();
      expect(typeof consumer.pollAndHandle).toBe('function');
    });
  });
}); 