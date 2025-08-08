import { ClientProxy } from '@nestjs/microservices';
import Redis from 'ioredis';

export interface RedisStreamsClientOptions {
  host: string;
  port: number;
  stream: string;
  password?: string;
  tls?: any;
  verbose?: boolean; // Add verbose option
}

export class RedisStreamsClientProxy extends ClientProxy {
  private client: Redis;
  private options: RedisStreamsClientOptions;
  private verbose: boolean;

  constructor(options: RedisStreamsClientOptions) {
    super();
    this.options = options;
    this.client = new Redis({
      host: options.host,
      port: options.port,
      password: options.password,
      tls: options.tls,
      connectTimeout: 10000, // Add connection timeout
      commandTimeout: 5000,  // Add command timeout
      maxRetriesPerRequest: 3,
    });
    this.verbose = options.verbose ?? false;
  }

  async connect(): Promise<any> {
    return this.client;
  }

  async close() {
    await this.client.quit();
  }

  public async dispatchEvent(packet: any, options?: { stream?: string }): Promise<any> {
    try {
      const { pattern, data } = packet;
      const stream = options?.stream || this.options.stream;
      await this.client.xadd(stream, '*', 'data', JSON.stringify({ pattern, data }));
      if (this.verbose) console.log(`[RedisStreamsClientProxy] Published event to stream ${stream} with pattern ${pattern}`);
    } catch (err) {
      if (this.verbose) console.error('[RedisStreamsClientProxy] Error publishing event:', err);
    }
  }

  protected publish(packet: any, callback: (packet: any) => void): () => void {
    // Not implemented: request-response pattern for streams
    return () => {};
  }

  public emit(pattern: string, data: any): any {
    // Return an Observable that resolves immediately
    return {
      subscribe: (observer: any) => {
        this.dispatchEvent({ pattern, data })
          .then(() => {
            if (observer.next) observer.next(data);
            if (observer.complete) observer.complete();
          })
          .catch((error) => {
            if (observer.error) observer.error(error);
          });
        return { unsubscribe: () => {} };
      }
    };
  }
} 