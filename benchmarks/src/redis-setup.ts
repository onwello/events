import Redis from 'ioredis';
import { RedisStreamsClientProxy } from '@logistically/events';
import { z } from 'zod';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

export const defaultRedisConfig: RedisConfig = {
  host: 'localhost',
  port: 6379,
  db: 0
};

export async function createRedisClient(config: RedisConfig = defaultRedisConfig): Promise<Redis> {
  const redis = new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    maxRetriesPerRequest: 3,
    lazyConnect: true
  });

  await redis.connect();
  return redis;
}

export function createRedisTransport(config: RedisConfig = defaultRedisConfig): RedisStreamsClientProxy {
  return new RedisStreamsClientProxy({
    host: config.host,
    port: config.port,
    password: config.password,
    stream: 'test-events-stream'
  });
}

export async function setupRedisForBenchmarks(config: RedisConfig = defaultRedisConfig): Promise<{
  redis: Redis;
  transport: RedisStreamsClientProxy;
}> {
  console.log('🔧 Setting up Redis connection...');
  
  const redis = await createRedisClient(config);
  const transport = createRedisTransport(config);
  
  // Test connection
  await redis.ping();
  console.log('✅ Redis connection established');
  
  return { redis, transport };
}

export async function cleanupRedis(redis: Redis): Promise<void> {
  try {
    // Clean up test streams
    const keys = await redis.keys('*-events');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    // Clean up any test data
    const testKeys = await redis.keys('test:*');
    if (testKeys.length > 0) {
      await redis.del(...testKeys);
    }
    
    await redis.quit();
    console.log('🧹 Redis cleanup completed');
  } catch (error) {
    console.warn('Warning: Redis cleanup failed:', error);
  }
}

// Event schemas for testing
export const UserCreatedSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  createdAt: z.string().datetime()
});

export const OrderCreatedSchema = z.object({
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
    price: z.number().positive()
  })),
  total: z.number().positive(),
  createdAt: z.string().datetime()
});

export const PaymentProcessedSchema = z.object({
  paymentId: z.string().uuid(),
  orderId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  status: z.enum(['pending', 'completed', 'failed']),
  processedAt: z.string().datetime()
});

export function generateTestEvent(type: 'TEST.user.created' | 'TEST.order.created' | 'TEST.payment.processed'): any {
  const now = new Date().toISOString();
  
  switch (type) {
    case 'TEST.user.created':
      return {
        userId: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: `User ${Math.floor(Math.random() * 10000)}`,
        email: `user${Math.floor(Math.random() * 10000)}@example.com`,
        createdAt: now
      };
    
    case 'TEST.order.created':
      return {
        orderId: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: `user-${Math.floor(Math.random() * 1000)}`,
        items: Array.from({ length: Math.floor(Math.random() * 5) + 1 }, (_, i) => ({
          productId: `product-${i + 1}`,
          quantity: Math.floor(Math.random() * 10) + 1,
          price: Math.random() * 100 + 10
        })),
        total: Math.random() * 1000 + 100,
        createdAt: now
      };
    
    case 'TEST.payment.processed':
      return {
        paymentId: `payment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        orderId: `order-${Math.floor(Math.random() * 1000)}`,
        amount: Math.random() * 1000 + 50,
        currency: 'USD',
        status: ['pending', 'completed', 'failed'][Math.floor(Math.random() * 3)] as any,
        processedAt: now
      };
    
    default:
      throw new Error(`Unknown event type: ${type}`);
  }
}

export function generateBatchEvents(
  type: 'TEST.user.created' | 'TEST.order.created' | 'TEST.payment.processed',
  count: number
): any[] {
  return Array.from({ length: count }, () => generateTestEvent(type));
}
