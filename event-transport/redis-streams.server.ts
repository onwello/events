import { Server, CustomTransportStrategy } from '@nestjs/microservices';
import Redis from 'ioredis';
import { RedisStreamConsumer } from '../event-consumer/redis-streams-consumer';
import { EventHandler } from '../event-consumer/consumer';

export interface RedisStreamsServerOptions {
  host: string;
  port: number;
  stream: string;
  group: string;
  consumer?: string;
  password?: string;
  tls?: any;
  blockTimeoutMs?: number;
  verbose?: boolean;
  deadLetterStream?: string; // Add dead letter support
}

export class RedisStreamsServer extends Server implements CustomTransportStrategy {
  private client: Redis;
  private options: RedisStreamsServerOptions;
  private consumerName: string;
  private isRunning = false;
  private blockTimeoutMs: number;
  private verbose: boolean;
  private consumer: RedisStreamConsumer | undefined;

  constructor(options: RedisStreamsServerOptions) {
    super();
    this.options = options;
    this.consumerName = options.consumer || 'consumer-' + Math.random().toString(36).slice(2);
    this.client = new Redis({
      host: options.host,
      port: options.port,
      password: options.password,
      tls: options.tls,
      connectTimeout: 10000, // Add connection timeout
      commandTimeout: 5000,  // Add command timeout
      maxRetriesPerRequest: 3,
    });
    this.blockTimeoutMs = options.blockTimeoutMs ?? 10000;
    this.verbose = options.verbose ?? false;
    if (this.verbose) {
      console.log('[RedisStreamsServer] Constructed with config:', {
        host: options.host,
        port: options.port,
        stream: options.stream,
        group: options.group,
        consumer: this.consumerName,
        blockTimeoutMs: this.blockTimeoutMs,
        deadLetterStream: options.deadLetterStream,
      });
    }
  }

  async listen(callback: () => void) {
    if (this.verbose) console.log('[RedisStreamsServer] Starting listen method');
    // Create consumer group if it doesn't exist
    try {
      await this.client.xgroup('CREATE', this.options.stream, this.options.group, '$', 'MKSTREAM');
      if (this.verbose) console.log('[RedisStreamsServer] Consumer group created or already exists');
    } catch (e: any) {
      if (!String(e.message).includes('BUSYGROUP')) {
        console.error(`[RedisStreamsServer] Error creating group: ${e.message}`);
      } else {
        if (this.verbose) console.log('[RedisStreamsServer] Consumer group already exists (BUSYGROUP)');
      }
    }

    // Map NestJS handlers to event handlers
    const patternHandlers: Record<string, EventHandler> = {};
    for (const [pattern, handler] of this.getHandlers().entries()) {
      patternHandlers[pattern as string] = async (payload: any, header: any, raw?: any) => {
        await handler(payload); // NestJS expects just the payload
      };
    }
    if (this.verbose) console.log('[RedisStreamsServer] Registered handlers:', Object.keys(patternHandlers));
    if (Object.keys(patternHandlers).length === 0) {
      console.warn('[RedisStreamsServer] WARNING: No handlers registered!');
    }

    // Create the Redis Streams consumer
    this.consumer = new RedisStreamConsumer({
      redis: this.client,
      stream: this.options.stream,
      group: this.options.group,
      consumer: this.consumerName,
      handlers: patternHandlers,
      blockMs: this.blockTimeoutMs,
      deadLetterStream: this.options.deadLetterStream,
      verbose: this.verbose,
      onError: (err: Error, eventType: string, envelope: any) => {
        console.error(`[RedisStreamsServer] Error for event ${eventType}: ${err.message}`);
        if (err.stack) console.error(err.stack);
      },
    });

    this.isRunning = true;
    if (this.verbose) console.log('[RedisStreamsServer] Calling callback and starting poll loop');
    callback();
    // Start polling in the background
    this.pollLoop();
  }

  private async pollLoop() {
    if (!this.consumer) return;
    if (this.verbose) console.log('[RedisStreamsServer] Starting poll loop');
    while (this.isRunning) {
      try {
        if (this.verbose) console.log('[RedisStreamsServer] Polling for messages...');
        await this.consumer.pollAndHandle();
        // Use setImmediate instead of setTimeout for better performance
        await new Promise(resolve => setImmediate(resolve));
      } catch (error) {
        console.error('[RedisStreamsServer] Poll loop error:', error);
        // Add delay on error to prevent tight loops
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async close() {
    this.isRunning = false;
    if (this.consumer) {
      this.consumer.stop();
    }
    await this.client.quit();
  }
} 