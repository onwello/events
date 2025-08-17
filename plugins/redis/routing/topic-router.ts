import { Redis } from 'ioredis';
import { MessageHandler, MessageMetadata } from '../../../event-transport/transport.interface';

export interface TopicRoute {
  pattern: string; // e.g., 'location.*.user.registration.*'
  handler: MessageHandler;
  consumerId: string;
  priority?: number; // For route precedence
}

export class TopicRouter {
  private routes: TopicRoute[] = [];
  private redis: Redis;
  private topicRegistry: TopicRegistry;
  
  constructor(redis: Redis, topicRegistry: TopicRegistry) {
    this.redis = redis;
    this.topicRegistry = topicRegistry;
  }
  
  // Register a route with wildcard support
  registerRoute(pattern: string, handler: MessageHandler, consumerId: string): void {
    this.routes.push({
      pattern,
      handler,
      consumerId,
      priority: this.calculatePriority(pattern)
    });
    
    // Sort routes by priority (more specific patterns first)
    this.routes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }
  
  // Calculate route priority (more specific = higher priority)
  private calculatePriority(pattern: string): number {
    const parts = pattern.split('.');
    let priority = 0;
    
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '*') {
        priority += Math.pow(10, parts.length - i - 1);
      } else {
        priority += Math.pow(10, parts.length - i) * 2; // Exact match gets higher priority
      }
    }
    
    return priority;
  }
  
  // Match a routing key against registered patterns
  matchRoutes(routingKey: string): TopicRoute[] {
    return this.routes.filter(route => this.matchesPattern(routingKey, route.pattern));
  }
  
  // Check if routing key matches pattern
  private matchesPattern(routingKey: string, pattern: string): boolean {
    const keyParts = routingKey.split('.');
    const patternParts = pattern.split('.');
    
    if (keyParts.length !== patternParts.length) {
      return false;
    }
    
    for (let i = 0; i < keyParts.length; i++) {
      if (patternParts[i] !== '*' && patternParts[i] !== keyParts[i]) {
        return false;
      }
    }
    
    return true;
  }
  
  // Get all unique topics from registered patterns
  async getSubscribedTopics(): Promise<string[]> {
    const topics = new Set<string>();
    
    for (const route of this.routes) {
      const routeTopics = await this.expandPatternToTopics(route.pattern);
      routeTopics.forEach(topic => topics.add(topic));
    }
    
    return Array.from(topics);
  }
  
  // Expand wildcard pattern to concrete topics
  private async expandPatternToTopics(pattern: string): Promise<string[]> {
    const parts = pattern.split('.');
    const wildcardIndices: number[] = [];
    
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '*') {
        wildcardIndices.push(i);
      }
    }
    
    if (wildcardIndices.length === 0) {
      return [pattern]; // No wildcards, return as-is
    }
    
    // Get all registered topics and filter by pattern
    const allTopics = await this.topicRegistry.getAllTopics();
    return allTopics.filter(topic => this.matchesPattern(topic, pattern));
  }
  
  // Get routes for a specific topic
  getRoutesForTopic(topic: string): TopicRoute[] {
    return this.routes.filter(route => this.matchesPattern(topic, route.pattern));
  }
  
  // Remove routes for a specific consumer
  removeRoutesForConsumer(consumerId: string): void {
    this.routes = this.routes.filter(route => route.consumerId !== consumerId);
  }
  
  // Get all registered patterns
  getRegisteredPatterns(): string[] {
    return this.routes.map(route => route.pattern);
  }
  
  // Check if a pattern is already registered
  isPatternRegistered(pattern: string, consumerId: string): boolean {
    return this.routes.some(route => 
      route.pattern === pattern && route.consumerId === consumerId
    );
  }
}

// Topic registry for dynamic discovery
export class TopicRegistry {
  private redis: Redis;
  private registryKey = 'topic:registry';
  
  constructor(redis: Redis) {
    this.redis = redis;
  }
  
  // Register a topic
  async registerTopic(topic: string, metadata?: TopicMetadata): Promise<void> {
    await this.redis.hset(this.registryKey, topic, JSON.stringify({
      createdAt: Date.now(),
      metadata: metadata || {}
    }));
  }
  
  // Get all registered topics
  async getAllTopics(): Promise<string[]> {
    const topics = await this.redis.hkeys(this.registryKey);
    return topics;
  }
  
  // Find topics matching a pattern
  async findTopicsMatchingPattern(pattern: string): Promise<string[]> {
    const allTopics = await this.getAllTopics();
    const patternParts = pattern.split('.');
    
    return allTopics.filter(topic => {
      const topicParts = topic.split('.');
      
      if (topicParts.length !== patternParts.length) {
        return false;
      }
      
      for (let i = 0; i < topicParts.length; i++) {
        if (patternParts[i] !== '*' && patternParts[i] !== topicParts[i]) {
          return false;
        }
      }
      
      return true;
    });
  }
  
  // Auto-register topics when publishing
  async ensureTopicExists(topic: string): Promise<void> {
    const exists = await this.redis.hexists(this.registryKey, topic);
    if (!exists) {
      await this.registerTopic(topic);
    }
  }
  
  // Get topic metadata
  async getTopicMetadata(topic: string): Promise<TopicMetadata | null> {
    const metadataStr = await this.redis.hget(this.registryKey, topic);
    if (!metadataStr) return null;
    
    try {
      return JSON.parse(metadataStr);
    } catch (error) {
      console.error(`Failed to parse metadata for topic ${topic}:`, error);
      return null;
    }
  }
  
  // Delete topic from registry
  async deleteTopic(topic: string): Promise<void> {
    await this.redis.hdel(this.registryKey, topic);
  }
}

export interface TopicMetadata {
  partitions?: number;
  retention?: RetentionConfig;
  ordering?: 'strict' | 'per-partition' | 'none';
  createdAt?: number;
}

export interface RetentionConfig {
  maxAge: number; // milliseconds
  maxSize: number; // messages
}
