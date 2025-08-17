import { Redis } from 'ioredis';

export interface OrderingConfig {
  enabled: boolean;
  strategy: 'global' | 'partition' | 'causal' | 'none';
  partitionKey?: string;
  maxConcurrency: number;
  timeoutMs: number;
  retryAttempts: number;
}

export interface MessageSequence {
  streamId: string;
  sequenceNumber: number;
  timestamp: number;
  partition: number;
  causalDependencies: string[];
}

export interface OrderingGuarantees {
  globalOrdering: boolean;
  partitionOrdering: boolean;
  causalOrdering: boolean;
  exactlyOnceDelivery: boolean;
}

export class MessageOrderingManager {
  private redis: Redis;
  private config: OrderingConfig;
  private sequenceCounters: Map<string, number> = new Map();
  private processingLocks: Map<string, Promise<void>> = new Map();
  private causalGraph: Map<string, Set<string>> = new Map();

  constructor(redis: Redis, config: OrderingConfig) {
    this.redis = redis;
    this.config = config;
  }

  /**
   * Generate globally unique sequence number for message ordering
   */
  async generateSequenceNumber(streamId: string, partitionKey?: string): Promise<MessageSequence> {
    const partition = partitionKey ? this.hashPartition(partitionKey) : 0;
    const key = `${streamId}:${partition}`;
    
    // Use Redis INCR for atomic sequence generation
    const sequenceNumber = await this.redis.incr(key);
    const timestamp = Date.now();
    
    // Get causal dependencies for this message
    const causalDependencies = await this.getCausalDependencies(streamId, partitionKey);
    
    return {
      streamId,
      sequenceNumber,
      timestamp,
      partition,
      causalDependencies
    };
  }

  /**
   * Ensure message ordering before processing
   */
  async ensureOrdering(sequence: MessageSequence): Promise<void> {
    if (!this.config.enabled) return;

    const lockKey = `${sequence.streamId}:${sequence.partition}`;
    
    // Check if we're already processing this partition
    if (this.processingLocks.has(lockKey)) {
      await this.processingLocks.get(lockKey);
    }

    // Create processing lock for this partition
    const processingPromise = this.processWithOrdering(sequence);
    this.processingLocks.set(lockKey, processingPromise);
    
    try {
      await processingPromise;
    } finally {
      this.processingLocks.delete(lockKey);
    }
  }

  /**
   * Process message with ordering guarantees
   */
  private async processWithOrdering(sequence: MessageSequence): Promise<void> {
    const { streamId, partition, sequenceNumber } = sequence;
    
    // Wait for previous sequence numbers to be processed
    await this.waitForPreviousSequences(streamId, partition, sequenceNumber);
    
    // Update causal graph
    await this.updateCausalGraph(sequence);
    
    // Mark sequence as processed
    await this.markSequenceProcessed(sequence);
  }

  /**
   * Wait for previous sequence numbers to be processed
   */
  private async waitForPreviousSequences(
    streamId: string, 
    partition: number, 
    currentSequence: number
  ): Promise<void> {
    const key = `${streamId}:${partition}:processed`;
    const timeout = Date.now() + this.config.timeoutMs;
    
    while (Date.now() < timeout) {
      const processedSequences = await this.redis.zrangebyscore(
        key, 
        0, 
        currentSequence - 1
      );
      
      if (processedSequences.length === currentSequence - 1) {
        return; // All previous sequences processed
      }
      
      // Wait for a short interval before checking again
      await this.sleep(10);
    }
    
    throw new Error(`Timeout waiting for sequence ordering: ${streamId}:${partition}:${currentSequence}`);
  }

  /**
   * Update causal dependency graph
   */
  private async updateCausalGraph(sequence: MessageSequence): Promise<void> {
    const { streamId, sequenceNumber, causalDependencies } = sequence;
    const key = `${streamId}:causal`;
    
    // Add current message to causal graph
    await this.redis.sadd(key, sequenceNumber.toString());
    
    // Record dependencies
    for (const dependency of causalDependencies) {
      await this.redis.sadd(`${key}:${sequenceNumber}`, dependency);
    }
  }

  /**
   * Mark sequence as processed
   */
  private async markSequenceProcessed(sequence: MessageSequence): Promise<void> {
    const { streamId, partition, sequenceNumber, timestamp } = sequence;
    const key = `${streamId}:${partition}:processed`;
    
    // Add to sorted set with timestamp for ordering
    await this.redis.zadd(key, timestamp, sequenceNumber.toString());
    
    // Clean up old processed sequences (keep last 1000)
    await this.redis.zremrangebyrank(key, 0, -1001);
  }

  /**
   * Get causal dependencies for a message
   */
  private async getCausalDependencies(streamId: string, partitionKey?: string): Promise<string[]> {
    if (!this.config.strategy.includes('causal')) return [];
    
    const key = `${streamId}:causal`;
    const recentMessages = await this.redis.zrevrange(key, 0, 9); // Last 10 messages
    
    return recentMessages.map(msg => `${streamId}:${msg}`);
  }

  /**
   * Hash partition key to determine partition
   */
  private hashPartition(partitionKey: string): number {
    let hash = 0;
    for (let i = 0; i < partitionKey.length; i++) {
      const char = partitionKey.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % 1000; // 1000 partitions max
  }

  /**
   * Get ordering guarantees for this configuration
   */
  getOrderingGuarantees(): OrderingGuarantees {
    return {
      globalOrdering: this.config.strategy === 'global',
      partitionOrdering: this.config.strategy === 'partition' || this.config.strategy === 'global',
      causalOrdering: this.config.strategy === 'causal',
      exactlyOnceDelivery: this.config.enabled && this.config.strategy !== 'none'
    };
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    // Clear all processing locks
    this.processingLocks.clear();
    
    // Clear sequence counters
    this.sequenceCounters.clear();
    
    // Clear causal graph
    this.causalGraph.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
