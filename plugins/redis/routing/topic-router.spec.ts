import { TopicRouter, TopicRegistry, TopicRoute } from './topic-router';
import Redis from 'ioredis';

// Mock Redis for testing
jest.mock('ioredis');

describe('TopicRouter', () => {
  let router: TopicRouter;
  let registry: TopicRegistry;
  let mockRedis: jest.Mocked<Redis>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRedis = {
      hset: jest.fn().mockResolvedValue(1),
      hget: jest.fn().mockResolvedValue(null),
      hkeys: jest.fn().mockResolvedValue([]),
      hdel: jest.fn().mockResolvedValue(1),
      hexists: jest.fn().mockResolvedValue(0)
    } as any;
    
    registry = new TopicRegistry(mockRedis);
    router = new TopicRouter(mockRedis, registry);
  });
  
  describe('Pattern Registration', () => {
    it('should register routes with correct priority', () => {
      const handler = jest.fn();
      
      router.registerRoute('location.*.user.*', handler, 'consumer-1');
      router.registerRoute('location.us.user.registration.*', handler, 'consumer-2');
      router.registerRoute('location.*.user.registration.*', handler, 'consumer-3');
      
      const patterns = router.getRegisteredPatterns();
      expect(patterns).toContain('location.*.user.*');
      expect(patterns).toContain('location.us.user.registration.*');
      expect(patterns).toContain('location.*.user.registration.*');
    });
    
    it('should sort routes by priority (more specific first)', () => {
      const handler = jest.fn();
      
      router.registerRoute('location.*.user.*', handler, 'consumer-1');
      router.registerRoute('location.us.user.registration.*', handler, 'consumer-2');
      router.registerRoute('location.*.user.registration.*', handler, 'consumer-3');
      
      const patterns = router.getRegisteredPatterns();
      // More specific patterns should come first
      expect(patterns[0]).toBe('location.us.user.registration.*');
      expect(patterns[1]).toBe('location.*.user.registration.*');
      expect(patterns[2]).toBe('location.*.user.*');
    });
    
    it('should check if pattern is already registered', () => {
      const handler = jest.fn();
      
      expect(router.isPatternRegistered('test.*', 'consumer-1')).toBe(false);
      
      router.registerRoute('test.*', handler, 'consumer-1');
      
      expect(router.isPatternRegistered('test.*', 'consumer-1')).toBe(true);
      expect(router.isPatternRegistered('test.*', 'consumer-2')).toBe(false);
    });
  });
  
  describe('Pattern Matching', () => {
    beforeEach(() => {
      const handler = jest.fn();
      router.registerRoute('location.*.user.registration.*', handler, 'consumer-1');
      router.registerRoute('location.us.user.*', handler, 'consumer-2');
      router.registerRoute('location.*.user.*.completed', handler, 'consumer-3');
    });
    
    it('should match exact patterns', () => {
      const routes = router.matchRoutes('location.us.user.registration.created');
      expect(routes).toHaveLength(1); // Only matches one pattern
      expect(routes[0].pattern).toBe('location.*.user.registration.*');
    });
    
    it('should match wildcard patterns', () => {
      const routes = router.matchRoutes('location.eu.user.registration.created');
      expect(routes).toHaveLength(1); // Only matches the first pattern
      expect(routes[0].pattern).toBe('location.*.user.registration.*');
    });
    
    it('should not match patterns with different segment counts', () => {
      const routes = router.matchRoutes('location.us.user.registration');
      expect(routes).toHaveLength(1); // Matches location.us.user.*
      expect(routes[0].pattern).toBe('location.us.user.*');
    });
    
    it('should match completed events', () => {
      const routes = router.matchRoutes('location.us.user.registration.completed');
      expect(routes).toHaveLength(2); // Matches two patterns
      expect(routes[0].pattern).toBe('location.*.user.registration.*');
      expect(routes[1].pattern).toBe('location.*.user.*.completed');
    });
    
    it('should not match unrelated topics', () => {
      const routes = router.matchRoutes('order.payment.processed');
      expect(routes).toHaveLength(0);
    });
  });
  
  describe('Route Management', () => {
    it('should remove routes for specific consumer', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      router.registerRoute('test.*', handler1, 'consumer-1');
      router.registerRoute('test.*', handler2, 'consumer-2');
      
      expect(router.getRegisteredPatterns()).toHaveLength(2);
      
      router.removeRoutesForConsumer('consumer-1');
      
      expect(router.getRegisteredPatterns()).toHaveLength(1);
      expect(router.isPatternRegistered('test.*', 'consumer-1')).toBe(false);
      expect(router.isPatternRegistered('test.*', 'consumer-2')).toBe(true);
    });
    
    it('should get routes for specific topic', () => {
      const handler = jest.fn();
      router.registerRoute('location.*.user.*', handler, 'consumer-1');
      router.registerRoute('location.us.user.*', handler, 'consumer-2');
      
      const routes = router.getRoutesForTopic('location.us.user.registration');
      expect(routes).toHaveLength(2);
      // The routes should match the topic, but order might vary
      const patterns = routes.map(r => r.pattern);
      expect(patterns).toContain('location.us.user.*');
      expect(patterns).toContain('location.*.user.*');
    });
  });
  
  describe('Topic Registry', () => {
    it('should register topics', async () => {
      await registry.registerTopic('test-topic', {
        partitions: 2,
        retention: { maxAge: 3600000, maxSize: 1000 },
        ordering: 'per-partition'
      });
      
      expect(mockRedis.hset).toHaveBeenCalledWith(
        'topic:registry',
        'test-topic',
        expect.stringContaining('"createdAt"')
      );
    });
    
    it('should get all registered topics', async () => {
      mockRedis.hkeys.mockResolvedValue(['topic-1', 'topic-2', 'topic-3']);
      
      const topics = await registry.getAllTopics();
      expect(topics).toEqual(['topic-1', 'topic-2', 'topic-3']);
    });
    
    it('should find topics matching pattern', async () => {
      mockRedis.hkeys.mockResolvedValue([
        'location.us.user.registration.created',
        'location.eu.user.registration.created',
        'location.us.order.created',
        'order.payment.processed'
      ]);
      
      const matchingTopics = await registry.findTopicsMatchingPattern('location.*.user.registration.*');
      expect(matchingTopics).toEqual([
        'location.us.user.registration.created',
        'location.eu.user.registration.created'
      ]);
    });
    
    it('should ensure topic exists', async () => {
      mockRedis.hexists.mockResolvedValue(0); // Topic doesn't exist
      
      await registry.ensureTopicExists('new-topic');
      
      expect(mockRedis.hexists).toHaveBeenCalledWith('topic:registry', 'new-topic');
      expect(mockRedis.hset).toHaveBeenCalledWith('topic:registry', 'new-topic', expect.any(String));
    });
    
    it('should not register topic if it already exists', async () => {
      mockRedis.hexists.mockResolvedValue(1); // Topic exists
      
      await registry.ensureTopicExists('existing-topic');
      
      expect(mockRedis.hexists).toHaveBeenCalledWith('topic:registry', 'existing-topic');
      expect(mockRedis.hset).not.toHaveBeenCalled();
    });
    
    it('should get topic metadata', async () => {
      const metadata = {
        partitions: 2,
        retention: { maxAge: 3600000, maxSize: 1000 },
        ordering: 'per-partition',
        createdAt: Date.now()
      };
      
      mockRedis.hget.mockResolvedValue(JSON.stringify(metadata));
      
      const result = await registry.getTopicMetadata('test-topic');
      expect(result).toEqual(metadata);
    });
    
    it('should return null for non-existent topic', async () => {
      mockRedis.hget.mockResolvedValue(null);
      
      const result = await registry.getTopicMetadata('non-existent');
      expect(result).toBeNull();
    });
    
    it('should handle invalid metadata gracefully', async () => {
      mockRedis.hget.mockResolvedValue('invalid-json');
      
      const result = await registry.getTopicMetadata('test-topic');
      expect(result).toBeNull();
    });
    
    it('should delete topic from registry', async () => {
      await registry.deleteTopic('topic-to-delete');
      
      expect(mockRedis.hdel).toHaveBeenCalledWith('topic:registry', 'topic-to-delete');
    });
  });
  
  describe('Pattern Expansion', () => {
    beforeEach(async () => {
      mockRedis.hkeys.mockResolvedValue([
        'location.us.user.registration.created',
        'location.eu.user.registration.created',
        'location.asia.user.registration.completed',
        'location.us.order.created',
        'order.payment.processed'
      ]);
    });
    
    it('should expand patterns to concrete topics', async () => {
      const handler = jest.fn();
      router.registerRoute('location.*.user.registration.*', handler, 'consumer-1');
      
      const topics = await router.getSubscribedTopics();
      
      // Should return all topics that match any registered pattern
      expect(topics).toContain('location.us.user.registration.created');
      expect(topics).toContain('location.eu.user.registration.created');
      expect(topics).toContain('location.asia.user.registration.completed');
    });
    
    it('should handle patterns without wildcards', async () => {
      const handler = jest.fn();
      router.registerRoute('exact.topic', handler, 'consumer-1');
      
      const topics = await router.getSubscribedTopics();
      expect(topics).toContain('exact.topic');
    });
  });
  
  describe('Priority Calculation', () => {
    it('should calculate priority correctly for different patterns', () => {
      const handler = jest.fn();
      
      // More specific patterns should have higher priority
      router.registerRoute('a.b.c.d', handler, 'consumer-1');
      router.registerRoute('a.b.*.d', handler, 'consumer-2');
      router.registerRoute('a.*.c.d', handler, 'consumer-3');
      router.registerRoute('*.b.c.d', handler, 'consumer-4');
      
      const patterns = router.getRegisteredPatterns();
      
      // Should be sorted by priority (most specific first)
      expect(patterns[0]).toBe('a.b.c.d');      // Most specific
      expect(patterns[1]).toBe('a.b.*.d');      // Second most specific
      expect(patterns[2]).toBe('a.*.c.d');      // Third most specific
      expect(patterns[3]).toBe('*.b.c.d');      // Least specific
    });
  });
  
  describe('Error Handling', () => {
    it('should handle Redis errors gracefully', async () => {
      mockRedis.hkeys.mockRejectedValue(new Error('Connection failed'));
      
      // Should not throw error
      await expect(router.getSubscribedTopics()).resolves.not.toThrow();
    });
    
    it('should handle invalid pattern matching gracefully', () => {
      const handler = jest.fn();
      router.registerRoute('valid.*.pattern', handler, 'consumer-1');
      
      // Should not throw error for malformed patterns
      expect(() => router.matchRoutes('')).not.toThrow();
      expect(() => router.matchRoutes('invalid..pattern')).not.toThrow();
    });
  });
});
