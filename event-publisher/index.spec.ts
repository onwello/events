// Jest test file: uses Jest globals (describe, it, expect, jest)
import { EventPublisher } from './index';
import { ClientProxy, ReadPacket, WritePacket } from '@nestjs/microservices';
import { of } from 'rxjs';
import { EventValidator } from '../event-types';

// Mock validator for testing
const mockValidator: EventValidator = {
  validate: jest.fn().mockReturnValue({ valid: true }),
  getSchema: jest.fn().mockReturnValue({
    parse: jest.fn(),
  }),
} as any;

// Mock ClientProxy
class MockClientProxy extends ClientProxy {
  emit<TResult = any, TInput = any>(pattern: any, data: TInput) {
    return of(undefined as TResult);
  }
  
  dispatchEvent<T = any>(packet: ReadPacket<any>): Promise<T> {
    return Promise.resolve(undefined as T);
  }
  
  // Required abstract methods
  connect(): Promise<any> {
    return Promise.resolve(undefined);
  }
  
  close(): Promise<any> {
    return Promise.resolve(undefined);
  }
  
  send<TResult = any, TInput = any>(pattern: any, data: TInput) {
    return of(undefined as TResult);
  }
  
  publish(packet: ReadPacket<any>, callback: (packet: WritePacket<any>) => void): () => void {
    return () => {};
  }
}

describe('EventPublisher', () => {
  let publisher: EventPublisher;
  let redis: MockClientProxy;
  let consoleTransport: MockClientProxy;
  let mockEmit: jest.SpyInstance;
  let mockDispatchEvent: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = new MockClientProxy();
    consoleTransport = new MockClientProxy();
    mockEmit = jest.spyOn(redis, 'emit');
    mockDispatchEvent = jest.spyOn(redis, 'dispatchEvent');
    
    // Default routing config for most tests
    publisher = new EventPublisher({
      redis,
      console: consoleTransport,
    }, {
      originServiceName: 'test-service',
      validator: mockValidator,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.clearAllMocks();
  });

  it('should use the correct transport based on routing config', async () => {
    await publisher.publish('user.updated', {
      userId: '1',
      changes: { email: 'new@example.com' },
      actorId: 'admin',
      timestamp: new Date().toISOString(),
    });
    expect(mockDispatchEvent).toHaveBeenCalledWith(
      { 
        pattern: 'user-events:user.updated', 
        data: expect.objectContaining({
          header: expect.objectContaining({
            type: 'test-service.user.updated',
            origin: 'test-service',
          }),
          body: expect.any(Object)
        })
      },
      { stream: 'user-events' }
    );
  });

  it('should use the default transport if no route matches', async () => {
    // Use a valid event type that's not in routing config
    await publisher.publish('user.registered', {
      userId: '1',
      provider: 'email',
      timestamp: new Date().toISOString(),
    });
    expect(mockDispatchEvent).toHaveBeenCalledWith(
      { 
        pattern: 'user-events:user.registered', 
        data: expect.objectContaining({
          header: expect.objectContaining({
            type: 'test-service.user.registered',
            origin: 'test-service',
          }),
          body: expect.any(Object)
        })
      },
      { stream: 'user-events' }
    );
  });

  it('should apply prefix if specified in the route', async () => {
    const mockConsoleDispatch = jest.spyOn(consoleTransport, 'dispatchEvent');
    // Custom routing config with prefix for observability.*
    const customRoutingConfig = {
      default: 'console',
      routes: [
        { pattern: /^observability\./, transport: 'console', prefix: 'observability:' },
      ]
    };
    const publisherWithPrefix = new EventPublisher({
      redis,
      console: consoleTransport,
    }, {
      originServiceName: 'test-service',
      validator: mockValidator,
    }, customRoutingConfig);
    await publisherWithPrefix.publish('observability.audit', {
      actorId: 'admin',
      action: 'login',
      service: 'test',
      timestamp: new Date().toISOString(),
    });
    expect(mockConsoleDispatch).toHaveBeenCalledWith(
      { pattern: 'observability:observability.audit', data: expect.any(Object) },
      { stream: 'observability-events' }
    );
  });

  it('should not apply prefix if not specified', async () => {
    const mockConsoleDispatch = jest.spyOn(consoleTransport, 'dispatchEvent');
    // Custom routing config without prefix for observability.*
    const customRoutingConfig = {
      default: 'console',
      routes: [
        { pattern: /^observability\./, transport: 'console' },
      ]
    };
    const publisherNoPrefix = new EventPublisher({
      redis,
      console: consoleTransport,
    }, {
      originServiceName: 'test-service',
      validator: mockValidator,
    }, customRoutingConfig);
    await publisherNoPrefix.publish('observability.security', {
      eventType: 'auth.failed',
      service: 'test',
      timestamp: new Date().toISOString(),
    });
    expect(mockConsoleDispatch).toHaveBeenCalledWith(
      { pattern: 'observability.security', data: expect.any(Object) },
      { stream: 'observability-events' }
    );
  });

  it('should handle errors from emit', async () => {
    mockDispatchEvent.mockImplementationOnce(() => { throw new Error('emit error'); });
    await expect(publisher.publish('user.updated', {
      userId: '1',
      changes: { email: 'new@example.com' },
      actorId: 'admin',
      timestamp: new Date().toISOString(),
    })).rejects.toThrow('emit error');
  });
}); 