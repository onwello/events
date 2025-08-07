import { ClientProxy } from '@nestjs/microservices';
import eventRoutingConfig, { EventRoute } from '../event-routing';
import { 
  EventEnvelope, 
  EventValidator, 
  DefaultEventValidator,
  createEventEnvelope
} from '../event-types';
import { firstValueFrom } from 'rxjs';

// Note: The 'prefix' in routing is used for legacy/compatibility purposes and is ignored for stream routing in the Redis Streams transport.

function getNamespaceFromType(eventType: string): string {
  return eventType.split('.')[0];
}

function getStreamForEventType(eventType: string): string {
  const namespace = getNamespaceFromType(eventType);
  return `${namespace}-events`;
}

export interface EventPublisherOptions {
  originServiceName: string;
  validator: EventValidator; // Now required
  eventNamespace?: string; // If not provided, uses originServiceName as namespace
}

export class EventPublisher {
  private validator: EventValidator;
  private eventNamespace: string; // Now required - either explicit or derived from service name

  constructor(
    private transports: Record<string, ClientProxy>,
    private options: EventPublisherOptions,
    private routingConfig: typeof eventRoutingConfig = eventRoutingConfig
  ) {
    if (!options || !options.originServiceName) {
      throw new Error('originServiceName must be provided in EventPublisherOptions');
    }
    
    if (!options.validator) {
      throw new Error('validator must be provided in EventPublisherOptions');
    }
    
    // Initialize validator
    this.validator = options.validator;
    
    // Set event namespace - use provided one or derive from service name
    this.eventNamespace = options.eventNamespace || options.originServiceName;
  }

  private getRouteForEvent(eventType: string): EventRoute | undefined {
    return this.routingConfig.routes.find(route => route.pattern.test(eventType));
  }

  private getTransportForEvent(eventType: string): { transport: ClientProxy, prefix?: string } {
    const route = this.getRouteForEvent(eventType);
    if (route) {
      return { transport: this.transports[route.transport], prefix: route.prefix };
    }
    return { transport: this.transports[eventRoutingConfig.default] };
  }

  async publish<T>(eventType: string, body: T): Promise<void> {
    // Validate event body using the validator
    const validation = this.validator.validate(eventType, body);
    if (!validation.valid) {
      throw new Error(`Invalid event body for type ${eventType}: ${validation.error}`);
    }

    const { transport, prefix } = this.getTransportForEvent(eventType);
    const finalEventType = prefix ? `${prefix}${eventType}` : eventType;
    const stream = getStreamForEventType(eventType);

    // Create the envelope with proper header generation
    const envelope: EventEnvelope<T> = createEventEnvelope(
      eventType,
      this.options.originServiceName,
      body,
      this.eventNamespace
    );

    // If the transport supports stream override, pass it
    if (typeof (transport as any).dispatchEvent === 'function') {
      await (transport as any).dispatchEvent({ pattern: finalEventType, data: envelope }, { stream });
    } else {
      await firstValueFrom(transport.emit(finalEventType, envelope));
    }
  }

  // Convenience method for publishing with custom validator
  async publishWithValidator<T>(
    eventType: string, 
    body: T, 
    validator: EventValidator
  ): Promise<void> {
    const tempValidator = this.validator;
    this.validator = validator;
    try {
      await this.publish(eventType, body);
    } finally {
      this.validator = tempValidator;
    }
  }

  // Method to register schemas with the default validator
  registerSchema(eventType: string, schema: any): void {
    if (this.validator instanceof DefaultEventValidator) {
      this.validator.registerSchema(eventType, schema);
    } else {
      throw new Error('Cannot register schema with custom validator');
    }
  }

  // Close method for proper resource cleanup
  async close(): Promise<void> {
    // Close all transports
    for (const transport of Object.values(this.transports)) {
      if (transport && typeof transport.close === 'function') {
        try {
          await transport.close();
        } catch (error) {
          console.warn('Error closing transport:', error);
        }
      }
    }
  }
}

export { MessagePattern, Payload } from '@nestjs/microservices'; 