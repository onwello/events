import { BenchmarkScenario, BenchmarkContext, ScenarioParameter, IterationResult } from '../types';

export class ThroughputScenario implements BenchmarkScenario {
  name = 'throughput';
  description = 'Measures maximum message throughput (messages per second)';
  category = 'throughput' as const;
  
  requiredCapabilities = {
    supportsPublishing: true,
    supportsSubscription: true
  };

  parameters: ScenarioParameter[] = [
    {
      name: 'messageCount',
      type: 'number',
      defaultValue: 1000,
      description: 'Number of messages to publish',
      min: 100,
      max: 100000
    },
    {
      name: 'messageSize',
      type: 'number',
      defaultValue: 1024,
      description: 'Size of message payload in bytes',
      min: 64,
      max: 102400
    },
    {
      name: 'batchSize',
      type: 'number',
      defaultValue: 10,
      description: 'Number of messages to publish in each batch',
      min: 1,
      max: 100
    },
    {
      name: 'flushInterval',
      type: 'number',
      defaultValue: 0,
      description: 'Flush interval in milliseconds (0 = immediate flush)',
      min: 0,
      max: 1000
    },
    {
      name: 'concurrentPublishers',
      type: 'number',
      defaultValue: 1,
      description: 'Number of concurrent publishers',
      min: 1,
      max: 20
    },
    {
      name: 'useMultipleTransports',
      type: 'boolean',
      defaultValue: false,
      description: 'Use separate transport instances for each publisher'
    },
    {
      name: 'concurrentConsumers',
      type: 'number',
      defaultValue: 1,
      description: 'Number of concurrent consumers',
      min: 1,
      max: 10
    }
  ];

  private parameterValues: Record<string, any> = {};

  getParameter<T>(name: string, defaultValue: T): T {
    return (this.parameterValues[name] !== undefined ? this.parameterValues[name] : defaultValue) as T;
  }

  async execute(context: BenchmarkContext): Promise<IterationResult> {
    const { transport, logger, iteration, iterationId, configuration } = context;
    
    // Get parameters from configuration
    const messageCount = configuration.parameters.messageCount || 1000;
    const messageSize = configuration.parameters.messageSize || 1024;
    const batchSize = configuration.parameters.batchSize || 10;
    const flushInterval = configuration.parameters.flushInterval || 0;
    const concurrentPublishers = configuration.parameters.concurrentPublishers || 1;
    const concurrentConsumers = configuration.parameters.concurrentConsumers || 1;
    const useMultipleTransports = configuration.parameters.useMultipleTransports || false;

    logger.info(`Starting throughput benchmark: ${messageCount} messages, ${messageSize} bytes, batch size ${batchSize}, ${concurrentPublishers} publishers, ${concurrentConsumers} consumers`);

    // Generate test data
    const testData = this.generateTestData(messageCount, messageSize, iterationId);
    const topics = this.generateTopics(messageCount, false, 1);
    
    // Track messages
    const publishedMessages = new Map<string, { messageId: string, publishTime: number }>();
    const receivedMessages = new Map<string, { messageId: string, receiveTime: number }>();
    const errors: string[] = [];
    
    // Set up consumer
    const cleanup = await this.setupConsumer(transport, publishedMessages, receivedMessages, errors, logger);
    
    try {
      // Minimal wait for consumer
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Start publishing in batches
      const startTime = process.hrtime.bigint();
      logger.info('Starting batch publishing...');
      
      const batches = Math.ceil(messageCount / batchSize);
      const publishersPerBatch = Math.ceil(batches / concurrentPublishers);
      
      const publishPromises: Promise<void>[] = [];
      
      for (let publisherId = 0; publisherId < concurrentPublishers; publisherId++) {
        const startBatch = publisherId * publishersPerBatch;
        const endBatch = Math.min((publisherId + 1) * publishersPerBatch, batches);
        
        publishPromises.push(this.publishBatches(
          transport, testData, topics, publishedMessages, 
          startBatch, endBatch, batchSize, flushInterval, logger
        ));
      }
      
      await Promise.all(publishPromises);
      
      const publishEndTime = process.hrtime.bigint();
      const publishDuration = Number(publishEndTime - startTime);
      
      logger.info(`Published ${publishedMessages.size} messages in ${(publishDuration / 1e6).toFixed(2)}ms`);
      
      // Wait for consumption
      const consumeStartTime = Date.now();
      const timeout = 10000;
      
      while (receivedMessages.size < publishedMessages.size && (Date.now() - consumeStartTime) < timeout) {
        await new Promise(resolve => setTimeout(resolve, 1));
        if (receivedMessages.size % 100 === 0) {
          logger.progress(`Received ${receivedMessages.size}/${publishedMessages.size} messages`);
        }
      }
      
      const consumeEndTime = Date.now();
      const consumeDuration = consumeEndTime - consumeStartTime;
      
      if (receivedMessages.size < publishedMessages.size) {
        const errorMsg = `Timeout: Only received ${receivedMessages.size}/${publishedMessages.size} messages`;
        errors.push(errorMsg);
        logger.warn(errorMsg);
      }
      
      // Calculate latencies
      const messageLatencies = this.calculateMessageLatencies(publishedMessages, receivedMessages);
      const totalDuration = Number(process.hrtime.bigint() - startTime);
      
      logger.info(`Throughput test completed: ${receivedMessages.size} messages, ${(publishedMessages.size / (publishDuration / 1e6)).toFixed(2)} msg/s`);
      
      return {
        iteration,
        iterationId,
        duration: totalDuration,
        publishedCount: publishedMessages.size,
        receivedCount: receivedMessages.size,
        messageLatencies,
        errors,
        metadata: {
          messageSize,
          batchSize,
          concurrentPublishers,
          publishDuration,
          consumeDuration,
          throughput: publishedMessages.size / (publishDuration / 1e6)
        }
      };
    } finally {
      await cleanup();
    }
  }

  private async publishBatches(
    transport: any,
    testData: any[],
    topics: string[],
    publishedMessages: Map<string, { messageId: string, publishTime: number }>,
    startBatch: number,
    endBatch: number,
    batchSize: number,
    flushInterval: number,
    logger: any
  ): Promise<void> {
    for (let batch = startBatch; batch < endBatch; batch++) {
      const batchPromises: Promise<void>[] = [];
      
      for (let i = 0; i < batchSize; i++) {
        const messageIndex = batch * batchSize + i;
        if (messageIndex >= testData.length) break;
        
        const message = testData[messageIndex];
        const topic = topics[messageIndex];
        const messageId = message.messageId; // Use original messageId
        
        // Record publish time BEFORE publishing to avoid negative latencies
        const publishTime = process.hrtime.bigint();
        publishedMessages.set(messageId, {
          messageId,
          publishTime: Number(publishTime)
        });
        
        batchPromises.push(
          transport.publisher.publish(topic, message).catch((error: any) => {
            const errorMsg = `Failed to publish message ${messageId}: ${error}`;
            logger.error(errorMsg);
          })
        );
      }
      
      await Promise.all(batchPromises);
      
      if (flushInterval > 0) {
        await new Promise(resolve => setTimeout(resolve, flushInterval));
      }
      
      if (batch % 10 === 0) {
        logger.progress(`Published batch ${batch}/${endBatch}`);
      }
    }
  }

  private generateTestData(messageCount: number, messageSize: number, iterationId: string): any[] {
    const data: any[] = [];
    for (let i = 0; i < messageCount; i++) {
      const payload = 'x'.repeat(messageSize);
      data.push({
        messageId: `${iterationId}-${i}`,
        data: payload,
        timestamp: Date.now(),
        sequence: i
      });
    }
    return data;
  }

  private generateTopics(messageCount: number, enablePartitioning: boolean, partitionCount: number): string[] {
    const topics: string[] = [];
    for (let i = 0; i < messageCount; i++) {
      if (enablePartitioning) {
        const partition = i % partitionCount;
        topics.push(`topic.partition.${partition}`);
      } else {
        topics.push('topic.default');
      }
    }
    return topics;
  }

  private async setupConsumer(
    transport: any,
    publishedMessages: Map<string, { messageId: string, publishTime: number }>,
    receivedMessages: Map<string, { messageId: string, receiveTime: number }>,
    errors: string[],
    logger: any
  ): Promise<() => Promise<void>> {
    await transport.consumer.subscribe('topic.default', (message: any, metadata: any) => {
      try {
        const messageId = this.extractMessageId(message);
        if (!messageId) {
          logger.warn('Received message without messageId');
          return;
        }
        
        const receiveTime = process.hrtime.bigint();
        receivedMessages.set(messageId, {
          messageId,
          receiveTime: Number(receiveTime)
        });
      } catch (error) {
        const errorMsg = `Error processing received message: ${error}`;
        errors.push(errorMsg);
        logger.error(errorMsg);
      }
    });

    return async () => {
      try {
        await transport.consumer.unsubscribe('topic.default');
      } catch (error) {
        logger.warn(`Failed to unsubscribe: ${error}`);
      }
    };
  }

  private extractMessageId(message: any): string | null {
    if (message?.body?.messageId) return message.body.messageId;
    if (message?.body?.id) return message.body.id;
    if (message?.header?.messageId) return message.header.messageId;
    if (message?.id) return message.id;
    if (message?.messageId) return message.messageId;
    if (message?.metadata?.messageId) return message.metadata.messageId;
    if (message?.header?.hash) return message.header.hash;
    return null;
  }

  private calculateMessageLatencies(
    publishedMessages: Map<string, { messageId: string, publishTime: number }>,
    receivedMessages: Map<string, { messageId: string, receiveTime: number }>
  ): Array<{ messageId: string; publishTime: number; receiveTime: number; latency: number }> {
    const latencies: Array<{ messageId: string; publishTime: number; receiveTime: number; latency: number }> = [];
    
    for (const [messageId, published] of publishedMessages) {
      const received = receivedMessages.get(messageId);
      if (received) {
        latencies.push({
          messageId,
          publishTime: published.publishTime,
          receiveTime: received.receiveTime,
          latency: received.receiveTime - published.publishTime
        });
      }
    }
    
    return latencies;
  }
}
