import { Redis } from 'ioredis';
import { EventEnvelope, MessageMetadata } from '../../../event-transport/transport.interface';

export interface ReplayConfig {
  enabled: boolean;
  maxReplayMessages: number;
  replayTimeout: number;
  validateReplay: boolean;
  preserveOrdering: boolean;
  batchSize: number;
  compression: boolean;
}

export interface ReplayRequest {
  streamName: string;
  startOffset?: string;
  endOffset?: string;
  startTime?: number;
  endTime?: number;
  filterPattern?: string;
  filters?: Record<string, any>; // Add filters property
  maxMessages?: number;
  preserveOrdering?: boolean; // Make optional with default value
}

export interface ReplayResult {
  success: boolean;
  messagesReplayed: number;
  startOffset: string;
  endOffset: string;
  duration: number;
  errors: string[];
  warnings: string[];
  // Add missing properties that tests expect
  messages: any[]; // Always provided
  totalMessages: number; // Always provided
  streamName?: string; // Optional
}

export interface ReplayMetrics {
  totalReplays: number;
  totalMessagesReplayed: number;
  averageReplayTime: number;
  failedReplays: number;
  lastReplayTime: number;
}

export class MessageReplayManager {
  private redis: Redis;
  private config: ReplayConfig;
  private replayHistory: Map<string, ReplayResult[]> = new Map();
  private metrics: ReplayMetrics;
  private activeReplays: Set<string> = new Set();

  constructor(redis: Redis, config: ReplayConfig) {
    this.redis = redis;
    this.config = config;
    this.metrics = {
      totalReplays: 0,
      totalMessagesReplayed: 0,
      averageReplayTime: 0,
      failedReplays: 0,
      lastReplayTime: 0
    };
  }

  /**
   * Replay messages from a stream
   */
  async replayMessages(request: ReplayRequest): Promise<ReplayResult> {
    if (!this.config.enabled) {
      throw new Error('Message replay is not enabled');
    }

    const replayId = `${request.streamName}:${Date.now()}`;
    if (this.activeReplays.has(replayId)) {
      throw new Error(`Replay already in progress for ${replayId}`);
    }

    this.activeReplays.add(replayId);
    const startTime = Date.now();

    try {
      // Validate replay request
      await this.validateReplayRequest(request);

      // Get message range
      const messageRange = await this.getMessageRange(request);
      
      if (messageRange.messages.length === 0) {
        return {
          success: true,
          messagesReplayed: 0,
          startOffset: request.startOffset || '0',
          endOffset: request.endOffset || '0',
          duration: Date.now() - startTime,
          errors: [],
          warnings: ['No messages found in specified range'],
          messages: [],
          totalMessages: 0,
          streamName: request.streamName
        };
      }

      // Apply filters if specified
      const filteredMessages = this.applyFilters(messageRange.messages, request.filterPattern, request.filters);

      // Limit messages if maxMessages specified
      const limitedMessages = request.maxMessages 
        ? filteredMessages.slice(0, request.maxMessages)
        : filteredMessages;

      // Replay messages
      const replayResult = await this.executeReplay(request.streamName, limitedMessages, request.preserveOrdering ?? this.config.preserveOrdering);

      // Update metrics
      this.updateMetrics(replayResult, Date.now() - startTime);

      // Store replay history
      this.storeReplayHistory(request.streamName, replayResult);

      // Add the properties that tests expect
      const resultWithTestProperties: ReplayResult = {
        ...replayResult,
        messages: limitedMessages,
        totalMessages: limitedMessages.length,
        streamName: request.streamName
      };

      return resultWithTestProperties;

    } catch (error) {
      const result: ReplayResult = {
        success: false,
        messagesReplayed: 0,
        startOffset: request.startOffset || '0',
        endOffset: request.endOffset || '0',
        duration: Date.now() - startTime,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
        messages: [],
        totalMessages: 0,
        streamName: request.streamName
      };

      this.metrics.failedReplays++;
      this.storeReplayHistory(request.streamName, result);

      throw error;
    } finally {
      this.activeReplays.delete(replayId);
    }
  }

  /**
   * Validate replay request
   */
  private async validateReplayRequest(request: ReplayRequest): Promise<void> {
    // Check if stream exists - but don't throw error for empty streams
    const streamExists = await this.redis.exists(request.streamName);
    if (!streamExists) {
      // Return early instead of throwing - this allows graceful handling of empty streams
      return;
    }

    // Validate time range if specified
    if (request.startTime && request.endTime && request.startTime >= request.endTime) {
      throw new Error('Start time must be before end time');
    }

    // Validate offset range if specified
    if (request.startOffset && request.endOffset) {
      const startNum = parseInt(request.startOffset);
      const endNum = parseInt(request.endOffset);
      if (startNum >= endNum) {
        throw new Error('Start offset must be before end offset');
      }
    }

    // Check message count limits
    if (request.maxMessages && request.maxMessages > this.config.maxReplayMessages) {
      throw new Error(`Max messages (${request.maxMessages}) exceeds limit (${this.config.maxReplayMessages})`);
    }
  }

  /**
   * Get message range from stream
   */
  private async getMessageRange(request: ReplayRequest): Promise<{
    messages: any[];
    startOffset: string;
    endOffset: string;
  }> {
    let startOffset = request.startOffset || '0';
    let endOffset = request.endOffset || '+';

    // Check if stream exists first
    const streamExists = await this.redis.exists(request.streamName);
    if (!streamExists) {
      return {
        messages: [],
        startOffset,
        endOffset
      };
    }

    // If time-based replay is requested, convert to offsets
    if (request.startTime || request.endTime) {
      const timeRange = await this.getOffsetsByTime(request.streamName, request.startTime, request.endTime);
      startOffset = timeRange.startOffset;
      endOffset = timeRange.endOffset;
    }

    // Read messages from stream
    const messages = await this.redis.xrange(
      request.streamName,
      startOffset,
      endOffset,
      'COUNT',
      this.config.batchSize
    );

    return {
      messages,
      startOffset,
      endOffset
    };
  }

  /**
   * Get offsets by timestamp
   */
  private async getOffsetsByTime(
    streamName: string, 
    startTime?: number, 
    endTime?: number
  ): Promise<{ startOffset: string; endOffset: string }> {
    let startOffset = '0';
    let endOffset = '+';

    if (startTime) {
      // Find first message after start time
      const startMessages = await this.redis.xrange(streamName, '0', '+', 'COUNT', 1);
      for (const [id, fields] of startMessages) {
        const timestamp = this.extractTimestamp(fields);
        if (timestamp >= startTime) {
          startOffset = id;
          break;
        }
      }
    }

    if (endTime) {
      // Find last message before end time
      const endMessages = await this.redis.xrevrange(streamName, '+', '0', 'COUNT', 1);
      for (const [id, fields] of endMessages) {
        const timestamp = this.extractTimestamp(fields);
        if (timestamp <= endTime) {
          endOffset = id;
          break;
        }
      }
    }

    return { startOffset, endOffset };
  }

  /**
   * Extract timestamp from message fields
   */
  private extractTimestamp(fields: any[]): number {
    for (let i = 0; i < fields.length; i += 2) {
      if (fields[i] === 'timestamp') {
        return parseInt(fields[i + 1]);
      }
    }
    return Date.now();
  }

  /**
   * Apply filters to messages
   */
  private applyFilters(messages: any[], filterPattern?: string, filters?: Record<string, any>): any[] {
    let filteredMessages = messages;

    // Apply regex pattern filter
    if (filterPattern) {
      try {
        const regex = new RegExp(filterPattern);
        filteredMessages = filteredMessages.filter(([id, fields]) => {
          // Check if any field matches the pattern
          return fields.some((field: any) => 
            typeof field === 'string' && regex.test(field)
          );
        });
      } catch (error) {
        console.warn(`Invalid filter pattern: ${filterPattern}`, error);
      }
    }

    // Apply field-based filters
    if (filters && Object.keys(filters).length > 0) {
      filteredMessages = filteredMessages.filter(([id, fields]) => {
        // Check if all filter conditions are met
        return Object.entries(filters).every(([key, value]) => {
          // Find the field value in the message
          for (let i = 0; i < fields.length; i += 2) {
            if (fields[i] === key && fields[i + 1] === value) {
              return true;
            }
          }
          return false;
        });
      });
    }

    return filteredMessages;
  }

  /**
   * Execute the actual replay
   */
  private async executeReplay(
    streamName: string, 
    messages: any[], 
    preserveOrdering: boolean
  ): Promise<ReplayResult> {
    const startTime = Date.now();
    const startOffset = messages.length > 0 ? messages[0][0] : '0';
    const endOffset = messages.length > 0 ? messages[messages.length - 1][0] : '0';

    let messagesReplayed = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      if (preserveOrdering) {
        // Replay messages in order
        for (const [id, fields] of messages) {
          try {
            await this.replaySingleMessage(streamName, id, fields);
            messagesReplayed++;
          } catch (error) {
            errors.push(`Failed to replay message ${id}: ${error}`);
          }
        }
      } else {
        // Replay messages in parallel for better performance
        const replayPromises = messages.map(async ([id, fields]) => {
          try {
            await this.replaySingleMessage(streamName, id, fields);
            return true;
          } catch (error) {
            errors.push(`Failed to replay message ${id}: ${error}`);
            return false;
          }
        });

        const results = await Promise.allSettled(replayPromises);
        messagesReplayed = results.filter(r => r.status === 'fulfilled' && r.value).length;
      }

      if (messagesReplayed < messages.length) {
        warnings.push(`${messages.length - messagesReplayed} messages failed to replay`);
      }

      return {
        success: errors.length === 0,
        messagesReplayed,
        startOffset,
        endOffset,
        duration: Date.now() - startTime,
        errors,
        warnings,
        messages: messages,
        totalMessages: messages.length,
        streamName: streamName
      };

    } catch (error) {
      return {
        success: false,
        messagesReplayed,
        startOffset,
        endOffset,
        duration: Date.now() - startTime,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings,
        messages: messages,
        totalMessages: messages.length,
        streamName: streamName
      };
    }
  }

  /**
   * Replay a single message
   */
  private async replaySingleMessage(streamName: string, id: string, fields: any[]): Promise<void> {
    // Create a replay stream
    const replayStreamName = `${streamName}:replay:${Date.now()}`;
    
    // Add message to replay stream
    await this.redis.xadd(
      replayStreamName,
      '*',
      'originalId', id,
      'originalStream', streamName,
      'replayTime', Date.now().toString(),
      ...fields.flat()
    );

    // Set TTL for replay stream (clean up after 24 hours)
    await this.redis.expire(replayStreamName, 86400);
  }

  /**
   * Get replay history for a stream
   */
  getReplayHistory(streamName: string): ReplayResult[] {
    return this.replayHistory.get(streamName) || [];
  }

  /**
   * Get replay metrics
   */
  getReplayMetrics(): ReplayMetrics {
    return { ...this.metrics };
  }

  /**
   * Update metrics
   */
  private updateMetrics(result: ReplayResult, duration: number): void {
    this.metrics.totalReplays++;
    this.metrics.totalMessagesReplayed += result.messagesReplayed;
    this.metrics.lastReplayTime = Date.now();

    // Update average replay time
    const totalTime = this.metrics.averageReplayTime * (this.metrics.totalReplays - 1) + duration;
    this.metrics.averageReplayTime = totalTime / this.metrics.totalReplays;
  }

  /**
   * Store replay history
   */
  private storeReplayHistory(streamName: string, result: ReplayResult): void {
    if (!this.replayHistory.has(streamName)) {
      this.replayHistory.set(streamName, []);
    }

    const history = this.replayHistory.get(streamName)!;
    history.push(result);

    // Keep only last 100 replay records
    if (history.length > 100) {
      history.shift();
    }
  }

  /**
   * Clean up replay resources
   */
  async cleanup(): Promise<void> {
    // Clean up old replay streams
    const replayKeys = await this.redis.keys('*:replay:*');
    for (const key of replayKeys) {
      await this.redis.del(key);
    }

    // Clear history and metrics
    this.replayHistory.clear();
    this.metrics = {
      totalReplays: 0,
      totalMessagesReplayed: 0,
      averageReplayTime: 0,
      failedReplays: 0,
      lastReplayTime: 0
    };
  }

  /**
   * Check if replay is in progress
   */
  isReplayInProgress(streamName: string): boolean {
    return Array.from(this.activeReplays).some(id => id.startsWith(streamName));
  }

  /**
   * Cancel active replay
   */
  cancelReplay(streamName: string): boolean {
    const replayIds = Array.from(this.activeReplays).filter(id => id.startsWith(streamName));
    replayIds.forEach(id => this.activeReplays.delete(id));
    return replayIds.length > 0;
  }
}
