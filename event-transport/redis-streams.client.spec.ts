// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="jest" />

import { RedisStreamsClientProxy } from './redis-streams.client';
import Redis from 'ioredis';

// Mock Redis constructor
const mockRedis = {
  connect: jest.fn(),
  quit: jest.fn(),
  xadd: jest.fn() as jest.Mock,
} as any;

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockRedis),
  };
});

describe('RedisStreamsClientProxy', () => {
  let client: RedisStreamsClientProxy;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new RedisStreamsClientProxy({
      host: 'localhost',
      port: 6379,
      stream: 'test-stream',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    jest.clearAllMocks();
    // Ensure any remaining connections are closed
    if (client) {
      await client.close();
    }
  });

  it('should close the Redis connection', async () => {
    await client.close();
    expect(mockRedis.quit).toHaveBeenCalled();
  });

  it('should dispatch an event to the stream', async () => {
    mockRedis.xadd.mockResolvedValue('123-0');
    await client.connect();
    const pattern = 'user.otp_issued';
    const data = { userId: '1', otp: '123456' };
    const result = await (client as any).dispatchEvent({ pattern, data });
    expect(mockRedis.xadd).toHaveBeenCalledWith('test-stream', '*', 'data', JSON.stringify({ pattern, data }));
    expect(result).toBeUndefined();
  });

  it('should not throw if dispatchEvent is called before connect', async () => {
    await expect((client as any).dispatchEvent({ pattern: 'user.otp_issued', data: {} })).resolves.not.toThrow();
  });

  it('should handle Redis errors gracefully', async () => {
    mockRedis.xadd.mockRejectedValue(new Error('Redis error'));
    await client.connect();
    await expect((client as any).dispatchEvent({ pattern: 'user.otp_issued', data: {} })).resolves.toBeUndefined();
  });
}); 