# Examples

This directory contains example applications demonstrating how to use the NestJS Events Library.

## Examples

### Basic Examples

- **Simple Publisher**: Basic event publishing example
- **Batched Publisher**: Advanced batching with memory management
- **Event Consumer**: Event consumption with handlers
- **Event Validation**: Schema validation with Zod

### Advanced Examples

- **User Service**: Complete NestJS service with event publishing and consumption
- **Order Processing**: Complex event-driven workflow
- **Microservices**: Multi-service event communication
- **Production Setup**: Production-ready configuration with monitoring

### Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start Redis**
   ```bash
   docker run -d -p 6379:6379 redis:alpine
   ```

3. **Run an example**
   ```bash
   # Basic publisher
   npm run example:basic-publisher
   
   # User service
   npm run example:user-service
   ```

## Example Structure

Each example includes:
- **Source code**: Complete working implementation
- **README**: Detailed explanation and usage instructions
- **Tests**: Unit tests for the example
- **Docker setup**: Docker configuration for easy setup

## Contributing Examples

We welcome new examples! When contributing:

1. Create a new directory under `examples/`
2. Include a README with clear instructions
3. Add tests for the example
4. Update this README with a brief description

## Example Categories

### Beginner Examples
- Simple event publishing
- Basic event consumption
- Schema validation

### Intermediate Examples
- Batched publishing
- Event routing
- Error handling

### Advanced Examples
- Microservices communication
- Production deployments
- Performance optimization

## Running Examples

Each example can be run independently:

```bash
# Navigate to example directory
cd examples/user-service

# Install dependencies
npm install

# Start Redis (if not running)
docker run -d -p 6379:6379 redis:alpine

# Run the example
npm start
```

## Example Requirements

- Node.js 18+
- Redis 6+
- Docker (for Redis setup)

## Troubleshooting

If you encounter issues:

1. **Redis Connection**: Ensure Redis is running on localhost:6379
2. **Dependencies**: Run `npm install` in each example directory
3. **Port Conflicts**: Check for port conflicts with other services
4. **Permissions**: Ensure you have write permissions for logs

## Example Documentation

Each example includes:
- **Setup instructions**: How to get the example running
- **Code walkthrough**: Explanation of key concepts
- **Configuration**: Available options and settings
- **Troubleshooting**: Common issues and solutions

## Feedback

We welcome feedback on examples! Please:
- Report issues with examples
- Suggest improvements
- Share your own examples
- Contribute new examples
