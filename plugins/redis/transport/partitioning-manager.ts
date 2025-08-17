import { Redis } from 'ioredis';

export interface PartitioningConfig {
  enabled: boolean;
  strategy: 'hash' | 'roundRobin' | 'keyBased' | 'dynamic';
  partitionCount: number;
  rebalanceThreshold: number;
  rebalanceInterval: number;
  partitionKeyExtractor?: (message: any) => string;
  loadBalancing: boolean;
  autoScaling: boolean;
  partitionRebalancing: boolean;
  minPartitions: number;
  maxPartitions: number;
}

export interface PartitionInfo {
  id: number;
  streamName: string;
  messageCount: number;
  consumerCount: number;
  lastMessageTime: number;
  throughput: number;
  health: 'healthy' | 'degraded' | 'unhealthy';
}

export interface PartitioningStrategy {
  hashBased: boolean;
  roundRobin: boolean;
  keyBased: boolean;
  dynamicPartitioning: boolean;
  partitionRebalancing: boolean;
}

export class PartitioningManager {
  private redis: Redis;
  private config: PartitioningConfig;
  private partitions: Map<number, PartitionInfo> = new Map();
  private currentPartitionIndex = 0;
  private partitionLoads: Map<number, number> = new Map();
  private rebalanceTimer?: NodeJS.Timeout;

  constructor(redis: Redis, config: PartitioningConfig) {
    this.redis = redis;
    this.config = config;
    this.initializePartitions();
    
    if (this.config.autoScaling) {
      this.startAutoScaling();
    }
  }

  /**
   * Initialize partitions
   */
  private async initializePartitions(): Promise<void> {
    for (let i = 0; i < this.config.partitionCount; i++) {
      const partitionInfo: PartitionInfo = {
        id: i,
        streamName: `partition-${i}`,
        messageCount: 0,
        consumerCount: 0,
        lastMessageTime: Date.now(),
        throughput: 0,
        health: 'healthy'
      };
      
      this.partitions.set(i, partitionInfo);
      this.partitionLoads.set(i, 0);
    }
  }

  /**
   * Get partition for message based on strategy
   */
  async getPartition(message: any, messageKey?: string): Promise<number> {
    if (!this.config.enabled) return 0;

    switch (this.config.strategy) {
      case 'hash':
        return this.getHashBasedPartition(messageKey || JSON.stringify(message));
      
      case 'roundRobin':
        return this.getRoundRobinPartition();
      
      case 'keyBased':
        return this.getKeyBasedPartition(message);
      
      case 'dynamic':
        return this.getDynamicPartition(message);
      
      default:
        return 0;
    }
  }

  /**
   * Hash-based partitioning using consistent hashing
   */
  private getHashBasedPartition(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % this.config.partitionCount;
  }

  /**
   * Round-robin partitioning
   */
  private getRoundRobinPartition(): number {
    const partition = this.currentPartitionIndex;
    this.currentPartitionIndex = (this.currentPartitionIndex + 1) % this.config.partitionCount;
    return partition;
  }

  /**
   * Key-based partitioning using message properties
   */
  private getKeyBasedPartition(message: any): number {
    if (!this.config.partitionKeyExtractor) {
      return this.getHashBasedPartition(JSON.stringify(message));
    }
    
    const key = this.config.partitionKeyExtractor(message);
    return this.getHashBasedPartition(key);
  }

  /**
   * Dynamic partitioning based on load
   */
  private async getDynamicPartition(message: any): Promise<number> {
    // Find partition with lowest load
    let minLoad = Infinity;
    let selectedPartition = 0;
    
    for (const [partitionId, load] of this.partitionLoads) {
      if (load < minLoad) {
        minLoad = load;
        selectedPartition = partitionId;
      }
    }
    
    // Update load for selected partition
    const currentLoad = this.partitionLoads.get(selectedPartition) || 0;
    this.partitionLoads.set(selectedPartition, currentLoad + 1);
    
    return selectedPartition;
  }

  /**
   * Create new partition
   */
  async createPartition(partitionId: number): Promise<void> {
    if (this.partitions.has(partitionId)) {
      throw new Error(`Partition ${partitionId} already exists`);
    }
    
    if (this.partitions.size >= this.config.maxPartitions) {
      throw new Error(`Maximum partition count (${this.config.maxPartitions}) reached`);
    }
    
    const partitionInfo: PartitionInfo = {
      id: partitionId,
      streamName: `partition-${partitionId}`,
      messageCount: 0,
      consumerCount: 0,
      lastMessageTime: Date.now(),
      throughput: 0,
      health: 'healthy'
    };
    
    this.partitions.set(partitionId, partitionInfo);
    this.partitionLoads.set(partitionId, 0);
    
    // Create Redis stream for new partition
    await this.redis.xadd(`partition-${partitionId}`, '*', 'init', 'true');
    
    console.log(`Created partition ${partitionId}`);
  }

  /**
   * Delete partition
   */
  async deletePartition(partitionId: number): Promise<void> {
    if (!this.partitions.has(partitionId)) {
      throw new Error(`Partition ${partitionId} does not exist`);
    }
    
    if (this.partitions.size <= this.config.minPartitions) {
      throw new Error(`Cannot delete partition: minimum count (${this.config.minPartitions}) reached`);
    }
    
    // Check if partition is empty
    const partitionInfo = this.partitions.get(partitionId)!;
    if (partitionInfo.messageCount > 0) {
      throw new Error(`Cannot delete non-empty partition ${partitionId}`);
    }
    
    this.partitions.delete(partitionId);
    this.partitionLoads.delete(partitionId);
    
    // Delete Redis stream
    await this.redis.del(`partition-${partitionId}`);
    
    console.log(`Deleted partition ${partitionId}`);
  }

  /**
   * Rebalance partitions based on load
   */
  async rebalancePartitions(): Promise<void> {
    if (!this.config.partitionRebalancing) return;
    
    const partitions = Array.from(this.partitions.values());
    const avgLoad = partitions.reduce((sum, p) => sum + p.messageCount, 0) / partitions.length;
    
    for (const partition of partitions) {
      const loadDiff = Math.abs(partition.messageCount - avgLoad);
      
      if (loadDiff > this.config.rebalanceThreshold) {
        await this.rebalancePartition(partition.id, avgLoad);
      }
    }
  }

  /**
   * Rebalance specific partition
   */
  private async rebalancePartition(partitionId: number, targetLoad: number): Promise<void> {
    const partition = this.partitions.get(partitionId);
    if (!partition) return;
    
    const currentLoad = partition.messageCount;
    const loadDiff = currentLoad - targetLoad;
    
    if (loadDiff > 0) {
      // Partition has too many messages, move some to other partitions
      await this.moveMessages(partitionId, Math.floor(loadDiff / 2));
    } else if (loadDiff < 0) {
      // Partition has too few messages, receive from others
      await this.receiveMessages(partitionId, Math.floor(Math.abs(loadDiff) / 2));
    }
  }

  /**
   * Move messages from one partition to another
   */
  private async moveMessages(fromPartition: number, count: number): Promise<void> {
    const streamName = `partition-${fromPartition}`;
    const messages = await this.redis.xread('COUNT', count, 'STREAMS', streamName, '0');
    
    if (!messages || messages.length === 0) return;
    
    for (const [stream, streamMessages] of messages as any[]) {
      for (const [id, fields] of streamMessages as any[]) {
        // Find target partition with lowest load
        const targetPartition = await this.getPartition({}, 'rebalance');
        
        // Move message to target partition
        await this.redis.xadd(`partition-${targetPartition}`, '*', ...fields.flat());
        await this.redis.xdel(streamName, id);
        
        // Update partition info
        const fromInfo = this.partitions.get(fromPartition)!;
        const toInfo = this.partitions.get(targetPartition)!;
        
        fromInfo.messageCount--;
        toInfo.messageCount++;
      }
    }
  }

  /**
   * Receive messages from other partitions
   */
  private async receiveMessages(toPartition: number, count: number): Promise<void> {
    // Find partition with highest load
    let maxLoad = 0;
    let sourcePartition = 0;
    
    for (const [partitionId, load] of this.partitionLoads) {
      if (partitionId !== toPartition && load > maxLoad) {
        maxLoad = load;
        sourcePartition = partitionId;
      }
    }
    
    if (maxLoad > 0) {
      await this.moveMessages(sourcePartition, Math.min(count, maxLoad));
    }
  }

  /**
   * Start auto-scaling
   */
  private startAutoScaling(): void {
    this.rebalanceTimer = setInterval(() => {
      this.rebalancePartitions();
    }, this.config.rebalanceInterval);
  }

  /**
   * Stop auto-scaling
   */
  stopAutoScaling(): void {
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
      this.rebalanceTimer = undefined;
    }
  }

  /**
   * Get partition information
   */
  getPartitionInfo(partitionId: number): PartitionInfo | undefined {
    return this.partitions.get(partitionId);
  }

  /**
   * Get all partition information
   */
  getAllPartitionInfo(): PartitionInfo[] {
    return Array.from(this.partitions.values());
  }

  /**
   * Get partitioning strategy capabilities
   */
  getPartitioningStrategy(): PartitioningStrategy {
    return {
      hashBased: this.config.strategy === 'hash',
      roundRobin: this.config.strategy === 'roundRobin',
      keyBased: this.config.strategy === 'keyBased',
      dynamicPartitioning: this.config.strategy === 'dynamic',
      partitionRebalancing: this.config.partitionRebalancing
    };
  }

  /**
   * Update partition metrics
   */
  async updatePartitionMetrics(partitionId: number, messageCount: number, consumerCount: number): Promise<void> {
    const partition = this.partitions.get(partitionId);
    if (!partition) return;
    
    partition.messageCount = messageCount;
    partition.consumerCount = consumerCount;
    partition.lastMessageTime = Date.now();
    
    // Calculate throughput (messages per second)
    const timeDiff = Date.now() - partition.lastMessageTime;
    if (timeDiff > 0) {
      partition.throughput = messageCount / (timeDiff / 1000);
    }
    
    // Update health status
    partition.health = this.calculatePartitionHealth(partition);
  }

  /**
   * Calculate partition health
   */
  private calculatePartitionHealth(partition: PartitionInfo): 'healthy' | 'degraded' | 'unhealthy' {
    if (partition.consumerCount === 0) return 'unhealthy';
    if (partition.throughput > 1000) return 'degraded';
    return 'healthy';
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.stopAutoScaling();
    this.partitions.clear();
    this.partitionLoads.clear();
  }
}
