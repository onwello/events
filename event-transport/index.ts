import { ClientProxy, ClientProxyFactory, Transport, ClientsModuleOptions } from '@nestjs/microservices';

export type EventTransportType = 'rabbitmq' | 'eventbridge' | 'nats' | 'redis' | 'mqtt' | 'tcp' | 'grpc';

export interface EventTransportOptions {
  type: EventTransportType;
  options: any;
}

export function createEventClientProxy(options: EventTransportOptions): ClientProxy {
  switch (options.type) {
    case 'rabbitmq':
      return ClientProxyFactory.create({
        transport: Transport.RMQ,
        options: options.options,
      });
    // Placeholder for EventBridge (implement as needed)
    // case 'eventbridge':
    //   throw new Error('EventBridge transport not yet implemented');
    case 'nats':
      return ClientProxyFactory.create({
        transport: Transport.NATS,
        options: options.options,
      });
    case 'redis':
      return ClientProxyFactory.create({
        transport: Transport.REDIS,
        options: options.options,
      });
    case 'mqtt':
      return ClientProxyFactory.create({
        transport: Transport.MQTT,
        options: options.options,
      });
    case 'tcp':
      return ClientProxyFactory.create({
        transport: Transport.TCP,
        options: options.options,
      });
    case 'grpc':
      return ClientProxyFactory.create({
        transport: Transport.GRPC,
        options: options.options,
      }) as any;
    default:
      throw new Error(`Unsupported event transport type: ${options.type}`);
  }
}

export * from './redis-streams.server';
export * from './redis-streams.client'; 