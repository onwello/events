import { EventEnvelope, EventValidator, DefaultEventValidator } from '../event-types';

export type EventHandler<T = any> = (body: T, header: EventEnvelope['header'], raw?: any) => Promise<void> | void;

export interface EventConsumerOptions {
  handlers: Record<string, EventHandler>;
  onError?: (err: Error, eventType: string, envelope: any) => void;
  validator: EventValidator; // Now required
  logUnregisteredEvents?: 'none' | 'debug' | 'info' | 'warn';
}

export class EventConsumer {
  private handlers: Record<string, EventHandler>;
  private onError?: (err: Error, eventType: string, envelope: any) => void;
  private validator: EventValidator;
  private logUnregisteredEvents: 'none' | 'debug' | 'info' | 'warn';

  constructor(options: EventConsumerOptions) {
    this.handlers = options.handlers;
    this.onError = options.onError;
    
    if (!options.validator) {
      throw new Error('validator must be provided in EventConsumerOptions');
    }
    
    this.validator = options.validator;
    this.logUnregisteredEvents = options.logUnregisteredEvents || 'debug';
  }

  async handleMessage(rawMessage: any) {
    let envelope: EventEnvelope | undefined = undefined;
    try {
      // Validate that rawMessage has the expected structure
      if (!rawMessage || typeof rawMessage !== 'object') {
        throw new Error('Invalid message: not an object');
      }

      // Type guard to ensure proper envelope structure
      if (!this.isValidEnvelope(rawMessage)) {
        throw new Error('Invalid envelope structure: missing header or body');
      }

      envelope = rawMessage as EventEnvelope;
      const { type } = envelope.header;
      
      // Validate event body using the validator
      const validation = this.validator.validate(type, envelope.body);
      if (!validation.valid) {
        throw new Error(`Invalid event body for type ${type}: ${validation.error}`);
      }

      const handler = this.handlers[type];
      if (!handler) {
        // Gracefully ignore events that don't have registered handlers
        if (this.logUnregisteredEvents !== 'none') {
          console[this.logUnregisteredEvents](`[EventConsumer] No handler registered for event type: ${type}, ignoring message`);
        }
        return;
      }

      await handler(envelope.body, envelope.header, rawMessage);
    } catch (err) {
      if (this.onError) {
        this.onError(err as Error, (envelope?.header?.type ?? 'unknown'), rawMessage);
      } else {
        throw err;
      }
    }
  }

  private isValidEnvelope(message: any): message is EventEnvelope {
    return (
      message &&
      typeof message === 'object' &&
      message.header &&
      typeof message.header === 'object' &&
      typeof message.header.id === 'string' &&
      typeof message.header.type === 'string' &&
      typeof message.header.origin === 'string' &&
      typeof message.header.timestamp === 'string' &&
      typeof message.header.hash === 'string' &&
      typeof message.header.version === 'string' &&
      'body' in message
    );
  }

  // Method to register handlers dynamically
  registerHandler<T>(eventType: string, handler: EventHandler<T>): void {
    this.handlers[eventType] = handler;
  }

  // Method to unregister handlers
  unregisterHandler(eventType: string): void {
    delete this.handlers[eventType];
  }

  // Method to get registered event types
  getRegisteredEventTypes(): string[] {
    return Object.keys(this.handlers);
  }
} 