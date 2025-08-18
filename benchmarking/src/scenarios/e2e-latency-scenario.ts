import { BenchmarkScenario, BenchmarkContext, IterationResult } from '../types';

export class E2ELatencyScenario implements BenchmarkScenario {
  name = 'e2e-latency';
  description = 'Measures end-to-end latency from publish to consume';
  category = 'latency' as const;
  
  // Static traffic record that persists across all iterations
  private static trafficRecord = {
    published: new Map<string, { messageId: string, publishTime: number, iteration: string }>(),
    received: new Map<string, { messageId: string, receiveTime: number, iteration: string }>(),
    errors: [] as string[]
  };

  /**
   * Calculate the approximate memory usage of the traffic record
   * This helps isolate actual event system memory usage from framework overhead
   */
  private static calculateTrafficRecordMemoryUsage(): number {
    // The entire traffic record is framework overhead - get its total size
    const publishedSize = E2ELatencyScenario.trafficRecord.published.size;
    const receivedSize = E2ELatencyScenario.trafficRecord.received.size;
    const errorsSize = E2ELatencyScenario.trafficRecord.errors.length;
    
    // Estimate memory usage based on object counts
    // Each Map entry: ~200 bytes (key + value object + Map overhead)
    // Each error string: ~100 bytes
    const estimatedBytes = (publishedSize + receivedSize) * 200 + errorsSize * 100;
    
    // Convert to MB
    return estimatedBytes / (1024 * 1024);
  }

  /**
   * Get the current traffic record memory usage
   * Used by the benchmark runner to calculate actual event system memory usage
   */
  public static getTrafficRecordMemoryUsage(): number {
    return this.calculateTrafficRecordMemoryUsage();
  }
  
  requiredCapabilities = {
    supportsPublishing: true,
    supportsSubscription: true
  };

  parameters: any[] = [
    {
      name: 'messageCount',
      type: 'number',
      defaultValue: 10,
      description: 'Number of messages to publish and consume',
      min: 10,
      max: 100000
    },
    {
      name: 'messageSize',
      type: 'number',
      defaultValue: 1024,
      description: 'Size of message payload in bytes',
      min: 64,
      max: 1048576
    },
    {
      name: 'concurrentConsumers',
      type: 'number',
      defaultValue: 1,
      description: 'Number of concurrent consumers',
      min: 1,
      max: 10
    },
    {
      name: 'enablePartitioning',
      type: 'boolean',
      defaultValue: false,
      description: 'Enable message partitioning'
    },
    {
      name: 'partitionCount',
      type: 'number',
      defaultValue: 4,
      description: 'Number of partitions when partitioning is enabled',
      min: 2,
      max: 16
    }
  ];

  async execute(context: BenchmarkContext): Promise<IterationResult> {
    const { transport, logger, iteration, iterationId, configuration } = context;
    
    logger.info(`Starting E2E latency benchmark iteration ${iteration} (${iterationId})`);
    
    // Get parameters from configuration
    const messageCount = configuration.parameters.messageCount || 10;
    const messageSize = configuration.parameters.messageSize || 1024;
    const concurrentConsumers = configuration.parameters.concurrentConsumers || 1;
    const enablePartitioning = configuration.parameters.enablePartitioning || false;
    const partitionCount = configuration.parameters.partitionCount || 1;

    logger.info(`Configuration: ${messageCount} messages, ${messageSize} bytes, ${concurrentConsumers} consumers`);

    // Generate test data for this iteration
    const testData = this.generateTestData(messageCount, messageSize, iterationId);
    const topics = this.generateTopics(messageCount, enablePartitioning, partitionCount);
    
    // Set up consumer subscription
    const cleanup = await this.setupConsumer(transport, E2ELatencyScenario.trafficRecord, logger, concurrentConsumers);
    
    try {
      // Wait longer for multiple consumers to be ready
      const consumerReadyWait = concurrentConsumers > 1 ? 100 : 10;
      await new Promise(resolve => setTimeout(resolve, consumerReadyWait));
      
      // Start publishing messages
      const startTime = process.hrtime.bigint();
      logger.info('Starting message publishing...');
      
      for (let i = 0; i < testData.length; i++) {
        const message = testData[i];
        const topic = topics[i];
        const messageId = `${iterationId}-${i}`;
        
        try {
          const publishTime = process.hrtime.bigint();
          await transport.publisher.publish(topic, message);
          
          E2ELatencyScenario.trafficRecord.published.set(messageId, {
            messageId,
            publishTime: Number(publishTime),
            iteration: iterationId
          });
          
        } catch (error) {
          const errorMsg = `Failed to publish message ${messageId}: ${error}`;
          E2ELatencyScenario.trafficRecord.errors.push(errorMsg);
          logger.error(errorMsg);
        }
      }
      
      const publishEndTime = process.hrtime.bigint();
      const publishDuration = Number(publishEndTime - startTime);
      
      logger.info(`Published ${E2ELatencyScenario.trafficRecord.published.size} messages in ${(publishDuration / 1e6).toFixed(2)}ms`);
      
      // Wait for all messages to be consumed
      const consumeStartTime = Date.now();
      const timeout = 10000; // 10 second timeout
      
      try {
        // Wait for all messages to be received with timeout
        await Promise.race([
          this.waitForAllMessages(E2ELatencyScenario.trafficRecord.published.size, E2ELatencyScenario.trafficRecord, logger),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
        ]);
        
        logger.info(`All ${messageCount} messages received successfully`);
      } catch (error) {
        const receivedCount = this.getReceivedCount(E2ELatencyScenario.trafficRecord);
        const errorMsg = `Timeout: Only received ${receivedCount}/${messageCount} messages (missing ${messageCount - receivedCount})`;
        E2ELatencyScenario.trafficRecord.errors.push(errorMsg);
        logger.warn(errorMsg);
      }
      
      const consumeEndTime = Date.now();
      const consumeDuration = consumeEndTime - consumeStartTime;
      
      // Log the actual counts for debugging
      const receivedCount = this.getReceivedCount(E2ELatencyScenario.trafficRecord);
      logger.info(`Final counts - Published: ${E2ELatencyScenario.trafficRecord.published.size}, Received: ${receivedCount}`);
      
      // Calculate message latencies
      const messageLatencies = this.calculateMessageLatencies(E2ELatencyScenario.trafficRecord.published, E2ELatencyScenario.trafficRecord.received);
      
      const totalDuration = Number(process.hrtime.bigint() - startTime);
      
      logger.info(`Iteration completed: ${receivedCount} messages received, ${messageLatencies.length} latencies calculated`);
      
      return {
        iteration,
        iterationId,
        duration: totalDuration,
        publishedCount: E2ELatencyScenario.trafficRecord.published.size,
        receivedCount: receivedCount,
        messageLatencies,
        errors: E2ELatencyScenario.trafficRecord.errors,
        metadata: {
          messageSize,
          concurrentConsumers,
          enablePartitioning,
          partitionCount,
          publishDuration,
          consumeDuration
        }
      };
    } finally {
      // Clean up consumer subscription
      await cleanup();
    }
  }

  private async setupConsumer(
    transport: any,
    trafficRecord: any,
    logger: any,
    concurrentConsumers: number = 1
  ): Promise<() => Promise<void>> {
    const cleanupFunctions: Array<() => Promise<void>> = [];
    
    // Use a single consumer group for all iterations
    const sharedGroupId = 'benchmark-group';
    const topic = 'topic.default';
    
    // Track individual consumer counts
    const consumerCounts = new Map<string, number>();
    
    // Set up multiple consumers if specified
    for (let consumerIndex = 0; consumerIndex < concurrentConsumers; consumerIndex++) {
      const consumerId = `benchmark-consumer-${consumerIndex}`;
      consumerCounts.set(consumerId, 0);
      
      await transport.consumer.subscribe(topic, (message: any, metadata: any) => {
        try {
          // Extract message ID from the message
          const messageId = this.extractMessageId(message);
          if (!messageId) {
            logger.warn(`Consumer ${consumerId}: Received message without messageId`);
            return;
          }
          
          const receiveTime = process.hrtime.bigint();
          trafficRecord.received.set(messageId, {
            messageId,
            receiveTime: Number(receiveTime),
            iteration: messageId.split('-')[0] // Extract iteration from messageId
          });
          
          const currentCount = consumerCounts.get(consumerId) || 0;
          consumerCounts.set(consumerId, currentCount + 1);
        } catch (error) {
          const errorMsg = `Consumer ${consumerId}: Error processing received message: ${error}`;
          trafficRecord.errors.push(errorMsg);
          logger.error(errorMsg);
        }
      }, {
        groupId: sharedGroupId,
        consumerId
      });

      // Store cleanup function for this consumer
      cleanupFunctions.push(async () => {
        try {
          await transport.consumer.unsubscribe(topic);
          logger.debug(`Consumer ${consumerId}: Unsubscribed (final count: ${consumerCounts.get(consumerId)})`);
        } catch (error) {
          logger.warn(`Consumer ${consumerId}: Failed to unsubscribe: ${error}`);
        }
      });
    }
    
    logger.info(`Set up ${concurrentConsumers} concurrent consumers in group: ${sharedGroupId} for topic: ${topic}`);

    // Return combined cleanup function
    return async () => {
      await Promise.all(cleanupFunctions.map(cleanup => cleanup()));
    };
  }

  private async waitForAllMessages(expectedCount: number, trafficRecord: { published: Map<string, { messageId: string, publishTime: number, iteration: string }>, received: Map<string, { messageId: string, receiveTime: number, iteration: string }> }, logger: any): Promise<void> {
    const startTime = Date.now();
    const timeout = 10000; // 10 second timeout

    while (Date.now() - startTime < timeout) {
      if (this.allMessagesReceived(expectedCount, trafficRecord)) {
        logger.debug(`All messages received!`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
    }
    throw new Error(`Timeout: Only received ${this.allMessagesReceived(expectedCount, trafficRecord)} messages (missing ${expectedCount - this.allMessagesReceived(expectedCount, trafficRecord)})`);
  }

  private allMessagesReceived(expectedCount: number, trafficRecord: { published: Map<string, { messageId: string, publishTime: number, iteration: string }>, received: Map<string, { messageId: string, receiveTime: number, iteration: string }> }): number {
    let receivedCount = 0;
    for (const [messageId, published] of trafficRecord.published) {
      if (trafficRecord.received.has(messageId)) {
        receivedCount++;
      }
    }
    return receivedCount;
  }

  private getReceivedCount(trafficRecord: { published: Map<string, { messageId: string, publishTime: number, iteration: string }>, received: Map<string, { messageId: string, receiveTime: number, iteration: string }> }): number {
    // Simply return the size of the received Map - this is the actual count
    return trafficRecord.received.size;
  }

  private extractMessageId(message: any): string | null {
    // Try to extract message ID from various possible locations
    if (message?.body?.messageId) return message.body.messageId;
    if (message?.body?.id) return message.body.id;
    if (message?.header?.messageId) return message.header.messageId;
    if (message?.id) return message.id;
    if (message?.messageId) return message.messageId;
    if (message?.metadata?.messageId) return message.metadata.messageId;
    
    // If no explicit messageId, try to use hash as fallback
    if (message?.header?.hash) return message.header.hash;
    
    return null;
  }

  private calculateMessageLatencies(
    publishedMessages: Map<string, { messageId: string, publishTime: number, iteration: string }>,
    receivedMessages: Map<string, { messageId: string, receiveTime: number, iteration: string }>
  ): Array<{ messageId: string, publishTime: number, receiveTime: number, latency: number }> {
    const latencies: Array<{ messageId: string, publishTime: number, receiveTime: number, latency: number }> = [];
    
    for (const [messageId, published] of publishedMessages) {
      const received = receivedMessages.get(messageId);
      if (received) {
        const latency = received.receiveTime - published.publishTime;
        if (latency > 0) {
          latencies.push({
            messageId,
            publishTime: published.publishTime,
            receiveTime: received.receiveTime,
            latency
          });
        }
      }
    }
    
    return latencies;
  }

  private generateTestData(messageCount: number, messageSize: number, iterationId: string): any[] {
    const data: any[] = [];
    
    for (let i = 0; i < messageCount; i++) {
      const messageId = `${iterationId}-${i}`;
      const message = {
        id: messageId,
        messageId: messageId, // Ensure messageId is available for correlation
        sequence: i,
        payload: this.generatePayload(messageSize),
        metadata: {
          source: 'benchmark',
          iteration: iterationId,
          size: messageSize,
          timestamp: Date.now()
        }
      };
      data.push(message);
    }
    
    return data;
  }

  private generatePayload(size: number): string {
    const basePayload = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let payload = '';
    
    while (payload.length < size) {
      payload += basePayload;
    }
    
    return payload.substring(0, size);
  }

  private generateTopics(messageCount: number, enablePartitioning: boolean, partitionCount: number): string[] {
    const topics: string[] = [];
    
    if (enablePartitioning) {
      for (let i = 0; i < messageCount; i++) {
        const partition = i % partitionCount;
        topics.push(`topic.${partition}`);
      }
    } else {
      for (let i = 0; i < messageCount; i++) {
        topics.push('topic.default');
      }
    }
    
    return topics;
  }

  private getParameter(name: string, defaultValue: any): any {
    const param = this.parameters.find(p => p.name === name);
    if (param) {
      return param.defaultValue;
    }
    return defaultValue;
  }
}
