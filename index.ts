/**
 * @logistically/events - A production-ready event-driven architecture library for NestJS
 * Copyright (c) 2024 Onwello Team
 * Licensed under the MIT License
 */

// Core event types and utilities
export * from './event-types';

// Original event publisher and consumer
export * from './event-publisher';
export * from './event-consumer';

// Enhanced message broker features
export * from './event-transport/transport.interface';
export * from './event-transport/topic-manager';
export * from './event-transport/pattern-router';
export * from './event-transport/redis-topic-transport';
export { createMessageBroker, MessageBroker } from './event-transport/transport-factory';

// Enhanced publisher and consumer
export * from './event-publisher/enhanced-publisher';
export * from './event-consumer/enhanced-consumer';

// Event routing
export * from './event-routing';

// Event transport
export * from './event-transport';

// NEW: Roadmap Features Implementation
// Enhanced Topic Configuration & Stream Control
export * from './event-transport/enhanced-topic-configuration';

// Poison Message Handling & Visibility
export * from './event-transport/poison-message-handler';

// Enhanced Consumer Group Management
export * from './event-transport/consumer-group-manager';

// Configurable Trim Strategy with Warning System
export * from './event-transport/topic-trim-manager';

// Enhanced Redis Failover & Cluster Support
export * from './event-transport/redis-cluster-support';

// Enhanced Backpressure & Slow Consumer Handling
export * from './event-transport/backpressure-monitor';

// CLI Tools for Group Management
export * from './event-transport/cli-tools';

// Re-export commonly used types for convenience
export type {
  EventEnvelope,
  EventHeader,
  EventValidator,
  ValidationResult
} from './event-types';

export {
  createEventEnvelope,
  createEventHeader,
  generateEventId,
  generateEventHash,
  DefaultEventValidator
} from './event-types';

export type {
  Transport,
  MessageHandler,
  MessageMetadata,
  PublishOptions,
  SubscribeOptions,
  TransportCapabilities
} from './event-transport/transport.interface';

export type {
  TopicConfig,
  TopicMetadata,
  RetentionConfig,
  TopicStats
} from './event-transport/topic-manager';

export type {
  TopicRoute,
  TopicRegistry
} from './event-transport/pattern-router';

export type {
  EnhancedPublisherConfig
} from './event-publisher/enhanced-publisher';

export type {
  EnhancedConsumerConfig,
  ConsumerOptions
} from './event-consumer/enhanced-consumer';

// NEW: Roadmap Features Types
export type {
  EnhancedTopicConfiguration,
  TopicWarning,
  TopicIsolation,
  TopicSecurity,
  TopicWarnings,
  TopicNamingStrategy
} from './event-transport/enhanced-topic-configuration';

export type {
  PoisonMessage,
  PoisonMessageConfig,
  PoisonMessageStats
} from './event-transport/poison-message-handler';

export type {
  ConsumerGroupConfig,
  ConsumerGroupInfo,
  GroupManagementCLI
} from './event-transport/consumer-group-manager';

export type {
  TrimStrategy,
  TrimEvent
} from './event-transport/topic-trim-manager';

export type {
  RedisClusterConfig,
  FailoverEvent
} from './event-transport/redis-cluster-support';

export type {
  BackpressureConfig,
  BackpressureMetrics,
  BackpressureAlert
} from './event-transport/backpressure-monitor';

export type {
  CLIToolsConfig
} from './event-transport/cli-tools';

// Factory functions for easy usage
// createMessageBroker is already exported above 