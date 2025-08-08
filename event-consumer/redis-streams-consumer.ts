import { EventConsumer, EventHandler } from './consumer';
import { Redis } from 'ioredis';
import { EventValidator, DefaultEventValidator } from '../event-types';

export interface RedisStreamConsumerOptions {
  redis: Redis;
  stream: string;
  group: string;
  consumer: string;
  handlers: Record<string, EventHandler>;
  onError?: (err: Error, eventType: string, envelope: any) => void;
  blockMs?: number;
  count?: number;
  deadLetterStream?: string;
  verbose?: boolean;
  validator?: EventValidator; // Add validator option
}

export class RedisStreamConsumer {
  private eventConsumer: EventConsumer;
  private redis: Redis;
  private stream: string;
  private group: string;
  private consumer: string;
  private blockMs: number;
  private count: number;
  private deadLetterStream?: string;
  private running: boolean = true;
  private verbose: boolean;

  constructor(options: RedisStreamConsumerOptions) {
    this.redis = options.redis;
    this.stream = options.stream;
    this.group = options.group;
    this.consumer = options.consumer;
    this.blockMs = options.blockMs ?? 5000;
    this.count = options.count ?? 10;
    this.deadLetterStream = options.deadLetterStream;
    this.verbose = options.verbose ?? false;
    
    // Create a default validator if none provided
    const validator = options.validator || new DefaultEventValidator();
    
    this.eventConsumer = new EventConsumer({
      handlers: options.handlers,
      onError: options.onError,
      validator,
    });
  }

  async pollAndHandle() {
    if (!this.running) return; // Stop polling if consumer is stopped
    if (this.verbose) console.log('[RedisStreamConsumer] pollAndHandle called');
    const res = await this.redis.xreadgroup(
      'GROUP', this.group, this.consumer,
      'COUNT', this.count,
      'BLOCK', this.blockMs,
      'STREAMS', this.stream, '>'
    );
    if (!res || res.length === 0) {
      if (this.verbose) console.log('[RedisStreamConsumer] No messages found in this poll.');
    } else {
      const messages = (res as any[])[0]?.[1] || [];
      if (this.verbose) console.log(`[RedisStreamConsumer] Received ${messages.length} messages from stream.`);
    }
    if (!res || res.length === 0) return;
    for (const [stream, messages] of res as any[]) {
      for (const [id, fields] of messages) {
        try {
          if (this.verbose) console.log(`[RedisStreamConsumer] Raw fields for id ${id}:`, JSON.stringify(fields));
          const raw = fields.data ? JSON.parse(fields.data) : fields;
          if (this.verbose) console.log(`[RedisStreamConsumer] Parsed raw for id ${id}:`, JSON.stringify(raw));
          
          // Handle the case where raw is an array with the JSON string as the second element
          let messageData;
          if (Array.isArray(raw) && raw.length >= 2) {
            // raw is ["data", "json_string"], so parse the second element
            messageData = JSON.parse(raw[1]);
          } else if (raw.data) {
            // raw is an object with a data property
            messageData = raw.data;
          } else {
            // raw is already the message data
            messageData = raw;
          }
          
          if (this.verbose) console.log(`[RedisStreamConsumer] Message data for id ${id}:`, JSON.stringify(messageData));
          
          // Extract the envelope from the data field
          const envelope = messageData.data || messageData;
          if (this.verbose) console.log(`[RedisStreamConsumer] Extracted envelope for id ${id}:`, JSON.stringify(envelope));
          if (envelope.header) {
            if (this.verbose) console.log(`[RedisStreamConsumer] Envelope event type: ${envelope.header.type}`);
          } else {
            console.warn(`[RedisStreamConsumer] Envelope missing header for id ${id}`);
          }
          await this.eventConsumer.handleMessage(envelope);
          if (this.verbose) console.log(`[RedisStreamConsumer] Successfully handled message for id ${id}`);
          try {
            await this.redis.xack(this.stream, this.group, id);
            if (this.verbose) console.log(`[RedisStreamConsumer] ACKed message for id ${id}`);
          } catch (ackError: unknown) {
            if ((ackError as Error).message?.includes('Connection is closed')) {
              if (this.verbose) console.log(`[RedisStreamConsumer] Skipping ACK for id ${id} - connection closed`);
            } else {
              throw ackError;
            }
          }
        } catch (err: unknown) {
          console.error(`[RedisStreamConsumer] Error processing message for id ${id}:`, err);
          if (this.verbose) console.error('[RedisStreamConsumer] Message fields:', JSON.stringify(fields));
          if ((err as Error).stack) console.error((err as Error).stack);
          if (this.deadLetterStream) {
            try {
              await this.redis.xadd(this.deadLetterStream, '*', 'data', fields.data || JSON.stringify(fields));
              await this.redis.xack(this.stream, this.group, id);
              if (this.verbose) console.log(`[RedisStreamConsumer] Sent message for id ${id} to DLQ and ACKed.`);
            } catch (dlqErr) {
              console.error(`[RedisStreamConsumer] Failed to push to dead letter stream for id ${id}:`, dlqErr);
              if ((dlqErr as Error).stack) console.error((dlqErr as Error).stack);
              // Do not ack, so the message can be retried
            }
          } else {
            console.error(`[RedisStreamConsumer] Message handling failed and no dead letter stream is configured for id ${id}:`, err);
            // Do not ack
          }
        }
      }
    }
  }

  stop() {
    this.running = false;
  }
} 