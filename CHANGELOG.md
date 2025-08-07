# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of NestJS Events Library
- Event publishing with Redis Streams support
- Batched event publishing with configurable limits
- Event validation with Zod schemas
- Event consumption with idempotency support
- Dead letter queue support
- Memory management and cleanup features
- Health monitoring and observability
- Event routing to different streams
- Graceful shutdown capabilities

### Features
- **EventPublisher**: Single event publishing with validation
- **BatchedEventPublisher**: Advanced batching with memory management
- **RedisStreamsServer**: Event consumption with consumer groups
- **EventValidator**: Schema-based event validation
- **Event Routing**: Route events to different streams based on patterns
- **Memory Management**: Automatic cleanup and monitoring
- **Error Handling**: Comprehensive retry logic and dead letter queues
- **Idempotency**: Built-in idempotency support with event hashing
- **Observability**: Health monitoring and metrics collection

### Technical
- Full TypeScript support with comprehensive interfaces
- Native NestJS integration
- Redis Streams as primary transport
- Memory leak prevention and cleanup
- Concurrent batch limiting
- Failed message tracking and recovery
- Production-ready error handling

## [2.0.0] - 2024-01-XX

### Added
- Initial release
- Complete event publishing and consumption system
- Advanced batching capabilities
- Memory management features
- Comprehensive documentation
- Full test suite (68 tests)

### Breaking Changes
- None (initial release)

### Deprecated
- None

### Removed
- None

### Fixed
- None

### Security
- None
