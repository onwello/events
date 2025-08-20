import { BenchmarkScenario, BenchmarkContext, IterationResult } from '../types';

export class PublishingThroughputScenario implements BenchmarkScenario {
  name = 'publishing-throughput';
  description = 'Benchmarks publishing throughput with various configurations';
  category = 'throughput' as const;
  requiredCapabilities = {
    supportsPublishing: true,
    supportsBatching: true
  };

  parameters = [
    {
      name: 'messageCount',
      type: 'number' as const,
      defaultValue: 10000,
      description: 'Number of messages to publish',
      min: 1,
      max: 1000000
    },
    {
      name: 'messageSize',
      type: 'number' as const,
      defaultValue: 1024,
      description: 'Size of each message in bytes',
      min: 1,
      max: 1024000
    },
    {
      name: 'batchSize',
      type: 'number' as const,
      defaultValue: 100,
      description: 'Batch size for publishing',
      min: 1,
      max: 1000
    },
    {
      name: 'flushInterval',
      type: 'number' as const,
      defaultValue: 50,
      description: 'Flush interval in milliseconds',
      min: 0,
      max: 1000
    },
    {
      name: 'concurrentPublishers',
      type: 'number' as const,
      defaultValue: 1,
      description: 'Number of concurrent publishers',
      min: 1,
      max: 10
    }
  ];

  async execute(context: BenchmarkContext): Promise<IterationResult> {
    const { transport, logger, iteration, iterationId, configuration } = context;
    
    logger.info(`Starting publishing throughput benchmark iteration ${iteration} (${iterationId})`);
    
    // Get parameters from configuration
    const messageCount = configuration.parameters.messageCount ?? 10000;
    const messageSize = configuration.parameters.messageSize ?? 1024;
    const batchSize = configuration.parameters.batchSize ?? 100;
    const flushInterval = configuration.parameters.flushInterval ?? 50;
    const concurrentPublishers = configuration.parameters.concurrentPublishers ?? 1;

    logger.info(`Configuration: ${messageCount} messages, ${messageSize} bytes, batch size ${batchSize}, flush interval ${flushInterval}ms, ${concurrentPublishers} publishers`);

    try {
      const startTime = process.hrtime.bigint();
      logger.info('Starting message publishing...');
      
      // Generate all test messages
      const allMessages = this.generateTestData(messageCount, messageSize, iterationId);
      let publishedCount = 0;
      
      // Publish messages - use batching if batchSize > 1, otherwise publish individually
      if (batchSize > 1) {
        // Use batching with concurrent publishers
        const actualBatchSize = Math.min(100, Math.floor(1000000 / messageSize));
        const messagesPerPublisher = Math.ceil(allMessages.length / concurrentPublishers);
        const publishingPromises: Promise<void>[] = [];
        
        for (let p = 0; p < concurrentPublishers; p++) {
          const startIndex = p * messagesPerPublisher;
          const endIndex = Math.min(startIndex + messagesPerPublisher, allMessages.length);
          const publisherMessages = allMessages.slice(startIndex, endIndex);
          
          const publishingPromise = (async () => {
            for (let i = 0; i < publisherMessages.length; i += actualBatchSize) {
              const batch = publisherMessages.slice(i, i + actualBatchSize);
              await transport.publisher.publishBatch('topic.default', batch);
              publishedCount += batch.length;
              
              if (publishedCount % 10000 === 0) {
                logger.debug(`Published ${publishedCount}/${messageCount} messages`);
              }
            }
          })();
          
          publishingPromises.push(publishingPromise);
        }
        
        await Promise.all(publishingPromises);
      } else {
        // Publish individually with concurrent publishers
        const messagesPerPublisher = Math.ceil(allMessages.length / concurrentPublishers);
        const publishingPromises: Promise<void>[] = [];
        
        for (let p = 0; p < concurrentPublishers; p++) {
          const startIndex = p * messagesPerPublisher;
          const endIndex = Math.min(startIndex + messagesPerPublisher, allMessages.length);
          const publisherMessages = allMessages.slice(startIndex, endIndex);
          
          const publishingPromise = (async () => {
            for (const message of publisherMessages) {
              await transport.publisher.publish('topic.default', message);
              publishedCount++;
              
              if (publishedCount % 10000 === 0) {
                logger.debug(`Published ${publishedCount}/${messageCount} messages`);
              }
            }
          })();
          
          publishingPromises.push(publishingPromise);
        }
        
        await Promise.all(publishingPromises);
      }

      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime);

      logger.info(`Published ${publishedCount} messages in ${(duration / 1000000).toFixed(2)}ms`);

      const throughput = (publishedCount / (duration / 1000000000)).toFixed(0);
      logger.info(`Publishing throughput: ${throughput} msg/s`);

      return {
        iteration,
        iterationId,
        duration,
        publishedCount: publishedCount,
        receivedCount: 0,
        messageLatencies: [],
        errors: [],
        metadata: {
          messageSize,
          batchSize,
          flushInterval,
          concurrentPublishers,
          throughput: parseInt(throughput)
        }
      };
    } catch (error) {
      logger.error(`Publishing benchmark failed: ${error}`);
      throw error;
    }
  }

  private generateTestData(messageCount: number, messageSize: number, iterationId: string): any[] {
    const messages: any[] = [];
    
    for (let i = 0; i < messageCount; i++) {
      const message = this.generateTestMessage(i, messageSize, iterationId);
      messages.push(message);
    }
    
    return messages;
  }

  private generateTestMessage(index: number, messageSize: number, iterationId: string): any {
    const payload = this.generatePayload(messageSize);
    
    return {
      id: `${iterationId}-${index}`,
      messageId: `${iterationId}-${index}`,
      sequence: index,
      payload,
      metadata: {
        source: 'benchmark',
        iteration: iterationId,
        size: messageSize,
        timestamp: Date.now()
      }
    };
  }

  private generatePayload(size: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < size; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
