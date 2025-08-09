import { Redis } from 'ioredis';
import { Transport, TransportConfig, TransportFactory } from './transport.interface';
import { RedisTopicTransport } from './redis-topic-transport';

export class MessageBrokerTransportFactory implements TransportFactory {
  createTransport(config: TransportConfig): Transport {
    switch (config.type) {
      case 'redis':
        return this.createRedisTransport(config.options);
      case 'kafka':
        throw new Error('Kafka transport not yet implemented');
      case 'rabbitmq':
        throw new Error('RabbitMQ transport not yet implemented');
      default:
        throw new Error(`Unsupported transport type: ${config.type}`);
    }
  }
  
  private createRedisTransport(options: any): Transport {
    const redis = new Redis(options);
    return new RedisTopicTransport(redis);
  }
}

// Unified message broker that abstracts transport details
export class MessageBroker {
  private transport: Transport;
  private connected: boolean = false;
  
  constructor(transport: Transport) {
    this.transport = transport;
  }
  
  // NestJS microservices compatibility
  emit(pattern: string, data: any) {
    return this.transport.emit(pattern, data);
  }
  
  send(pattern: string, data: any) {
    return this.transport.send(pattern, data);
  }
  
  // Message broker specific methods
  async publish(topic: string, message: any, options?: any): Promise<void> {
    await this.ensureConnected();
    return this.transport.publish(topic, message, options);
  }
  
  async subscribe(topic: string, handler: any, options?: any): Promise<void> {
    await this.ensureConnected();
    return this.transport.subscribe(topic, handler, options);
  }
  
  async subscribePattern(pattern: string, handler: any, options?: any): Promise<void> {
    await this.ensureConnected();
    return this.transport.subscribePattern(pattern, handler, options);
  }
  
  async connect(): Promise<void> {
    if (!this.connected) {
      await this.transport.connect();
      this.connected = true;
    }
  }
  
  async close(): Promise<void> {
    if (this.connected) {
      await this.transport.close();
      this.connected = false;
    }
  }
  
  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
  }
  
  // Transport-specific capabilities
  getCapabilities() {
    return this.transport.getCapabilities();
  }
}

// Factory function for easy creation
export function createMessageBroker(config: TransportConfig): MessageBroker {
  const factory = new MessageBrokerTransportFactory();
  const transport = factory.createTransport(config);
  return new MessageBroker(transport);
}
