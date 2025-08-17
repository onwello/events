/**
 * @logistically/events - A production-ready event-driven architecture library for NestJS
 * Copyright (c) 2024 Onwello Team
 * Licensed under the MIT License
 */

// Core exports
export { EventPublisher, createPublisher } from './event-publisher/publisher';
export { EventConsumer, createConsumer } from './event-consumer/consumer';
export { TransportFactory, createTransportFactory } from './event-transport/factory';
export { EventSystemBuilder, createEventSystemBuilder, createEventSystem } from './event-system-builder';

// Plugin exports
export { RedisStreamsPlugin, MemoryTransportPlugin } from './plugins';
export type { TransportPlugin, PluginRegistry, PluginStructure } from './event-transport/plugin.interface';

// Configuration exports - now consolidated
export type { 
  PublisherConfig, 
  ConsumerConfig, 
  EventSystemConfig 
} from './event-system-builder';

export type { TransportFactoryConfig } from './event-transport/factory';

export type { 
  Transport, 
  TransportCapabilities, 
  EventEnvelope, 
  MessageHandler, 
  PatternHandler 
} from './event-transport/transport.interface';

export type { 
  EventRouter, 
  RoutingConfig, 
  EventRoute 
} from './event-routing';

export type { 
  EventValidator, 
  ValidationResult 
} from './event-types';

// Transport configs are now plugin-specific
// Use plugin.getDefaultConfig() or plugin-specific config interfaces

// Event types
export { 
  createEventEnvelope, 
  createEventValidator, 
  DefaultEventValidator 
} from './event-types';

// Routing
export { 
  createEventRouter, 
  createBasicRoutingConfig 
} from './event-routing';

 