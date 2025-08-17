import { EnhancedRedisStreamsTransport } from './enhanced-redis-streams-transport';
import { Redis } from 'ioredis';

// Mock Redis
jest.mock('ioredis');

describe('EnhancedRedisStreamsTransport - Simple Tests', () => {
  let mockRedis: any;
  let transport: EnhancedRedisStreamsTransport;

  beforeEach(() => {
    mockRedis = {
      ping: jest.fn().mockResolvedValue('PONG'),
      xadd: jest.fn().mockResolvedValue('1234567890-0'),
      xgroup: jest.fn().mockResolvedValue('OK'),
      status: 'ready'
    };

    transport = new EnhancedRedisStreamsTransport(mockRedis);
  });

  describe('Basic Functionality', () => {
    it('should have correct name', () => {
      expect(transport.name).toBe('redis-streams');
    });

    it('should have capabilities', () => {
      expect(transport.capabilities).toBeDefined();
      expect(transport.capabilities.supportsPublishing).toBe(true);
    });

    it('should connect successfully', async () => {
      expect(transport.isConnected()).toBe(false);
      
      await transport.connect();
      expect(transport.isConnected()).toBe(true);
    });

    it('should disconnect successfully', async () => {
      await transport.connect();
      expect(transport.isConnected()).toBe(true);
      
      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('Enterprise Features', () => {
    it('should return undefined managers when not configured', () => {
      expect(transport.getOrderingManager()).toBeUndefined();
      expect(transport.getPartitioningManager()).toBeUndefined();
      expect(transport.getSchemaManager()).toBeUndefined();
      expect(transport.getReplayManager()).toBeUndefined();
    });
  });
});
