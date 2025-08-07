import { BatchingStrategy, BatchingTypeStrategy } from '../batching-strategy';
import { RedisStreamsBatchingStrategy } from './redis-streams-strategy';
import { ConsoleBatchingStrategy } from './console-strategy';

export type TransportType = 'redis' | 'console' | 'kafka' | 'rabbitmq';

export interface StrategyFactoryOptions {
  typePrefix?: string;
  batchingTypeStrategy?: BatchingTypeStrategy;
}

export class BatchingStrategyFactory {
  static createStrategy(
    transportType: TransportType, 
    options: StrategyFactoryOptions = {}
  ): BatchingStrategy {
    const { typePrefix = 'default', batchingTypeStrategy = 'exact' } = options;
    
    switch (transportType) {
      case 'redis':
        return new RedisStreamsBatchingStrategy(typePrefix, batchingTypeStrategy);
      case 'console':
        return new ConsoleBatchingStrategy(batchingTypeStrategy);
      case 'kafka':
        // TODO: Implement Kafka strategy
        throw new Error('Kafka batching strategy not implemented yet');
      case 'rabbitmq':
        // TODO: Implement RabbitMQ strategy
        throw new Error('RabbitMQ batching strategy not implemented yet');
      default:
        throw new Error(`Unknown transport type: ${transportType}`);
    }
  }
}
