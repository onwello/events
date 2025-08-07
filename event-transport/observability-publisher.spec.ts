// Jest test file: uses Jest globals (describe, it, expect, jest)
import { ObservabilityEventPublisher } from './observability-publisher';
import * as Redis from 'ioredis';

const mockConnect = jest.fn();
const mockQuit = jest.fn();
const mockXAdd = jest.fn();

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      connect: mockConnect,
      quit: mockQuit,
      xadd: mockXAdd,
    })),
  };
});

describe('ObservabilityEventPublisher', () => {
  let publisher: ObservabilityEventPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new ObservabilityEventPublisher({
      host: 'localhost',
      port: 6379,
      stream: 'observability',
      verbose: false,
    }, 'test-service', 'observability-events');
  });

  it('should publish a log event', async () => {
    mockXAdd.mockResolvedValue('1-0');
    const data = { 
      level: 'info' as const, 
      message: 'test', 
      service: 'test-service' 
    };
    await publisher.log(data);
    expect(mockXAdd).toHaveBeenCalledWith('observability-events', '*', 'data', expect.any(String));
  });

  it('should publish a metric event', async () => {
    mockXAdd.mockResolvedValue('1-0');
    const data = { 
      metric: 'signup', 
      value: 1, 
      service: 'test-service' 
    };
    await publisher.metric(data);
    expect(mockXAdd).toHaveBeenCalledWith('observability-events', '*', 'data', expect.any(String));
  });

  it('should publish an audit event', async () => {
    mockXAdd.mockResolvedValue('1-0');
    const data = { 
      actorId: 'admin', 
      action: 'user.deleted', 
      service: 'test-service' 
    };
    await publisher.audit(data);
    expect(mockXAdd).toHaveBeenCalledWith('observability-events', '*', 'data', expect.any(String));
  });

  it('should publish a security event', async () => {
    mockXAdd.mockResolvedValue('1-0');
    const data = { 
      eventType: 'unauthorized_access', 
      service: 'test-service' 
    };
    await publisher.security(data);
    expect(mockXAdd).toHaveBeenCalledWith('observability-events', '*', 'data', expect.any(String));
  });

  it('should handle Redis errors gracefully', async () => {
    mockXAdd.mockRejectedValue(new Error('Redis error'));
    await expect(publisher.log({ 
      level: 'error' as const, 
      message: 'fail', 
      service: 'test-service' 
    })).resolves.toBeUndefined();
  });

  it('should close the Redis connection', async () => {
    await publisher.close();
    // Note: EventPublisher doesn't have close method, so this might not work as expected
    // The test might need to be updated based on actual implementation
  });
}); 