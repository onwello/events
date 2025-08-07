# Contributing to NestJS Events Library

Thank you for your interest in contributing to the NestJS Events Library! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contributing Guidelines](#contributing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Feature Requests](#feature-requests)
- [Code Style](#code-style)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Redis (for testing)

### Development Setup

1. **Fork the repository**
   ```bash
   git clone https://github.com/your-username/nestjs-events.git
   cd nestjs-events
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Redis**
   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:alpine
   
   # Or install Redis locally
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Build the project**
   ```bash
   npm run build
   ```

## Contributing Guidelines

### Types of Contributions

We welcome contributions in the following areas:

- **Bug Fixes**: Fix issues and improve reliability
- **Feature Enhancements**: Add new features and capabilities
- **Documentation**: Improve guides, examples, and API docs
- **Tests**: Add test coverage and improve test quality
- **Performance**: Optimize performance and memory usage
- **Examples**: Create sample applications and demos

### Before Contributing

1. **Check existing issues**: Search for existing issues or discussions
2. **Discuss changes**: Open an issue to discuss significant changes
3. **Follow the style guide**: Ensure code follows our style guidelines
4. **Write tests**: Include tests for new features or bug fixes
5. **Update documentation**: Update relevant documentation

## Pull Request Process

### Creating a Pull Request

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the code style guidelines
   - Write tests for new functionality
   - Update documentation as needed

3. **Run tests and checks**
   ```bash
   npm test
   npm run build
   npm run lint  # (when available)
   ```

4. **Commit your changes**
   ```bash
   git commit -m "feat: add new feature description"
   ```

5. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request**
   - Use the PR template
   - Provide a clear description
   - Link related issues

### Pull Request Guidelines

- **Title**: Use conventional commit format
- **Description**: Explain what and why, not how
- **Tests**: Include tests for new functionality
- **Documentation**: Update relevant docs
- **Breaking Changes**: Clearly mark and explain

### Conventional Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Build process or auxiliary tool changes

## Reporting Bugs

### Before Reporting

1. **Check existing issues**: Search for similar issues
2. **Reproduce the issue**: Ensure it's reproducible
3. **Check documentation**: Verify it's not a usage issue

### Bug Report Template

```markdown
**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Environment:**
- Node.js version:
- npm version:
- Redis version:
- OS:

**Additional context**
Add any other context about the problem here.
```

## Feature Requests

### Feature Request Template

```markdown
**Is your feature request related to a problem? Please describe.**
A clear and concise description of what the problem is.

**Describe the solution you'd like**
A clear and concise description of what you want to happen.

**Describe alternatives you've considered**
A clear and concise description of any alternative solutions.

**Additional context**
Add any other context or screenshots about the feature request.
```

## Code Style

### TypeScript Guidelines

- Use TypeScript strict mode
- Prefer interfaces over types for object shapes
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused

### Example

```typescript
/**
 * Publishes an event to the configured transport
 * @param eventType - The type of event to publish
 * @param body - The event payload
 * @returns Promise that resolves when event is published
 */
async publish<T>(eventType: string, body: T): Promise<void> {
  // Implementation
}
```

### File Organization

- Group related functionality in modules
- Use consistent file naming (kebab-case)
- Keep files focused and not too large
- Export public APIs from index files

## Testing

### Test Guidelines

- Write tests for all new functionality
- Test both success and error scenarios
- Use descriptive test names
- Mock external dependencies
- Test edge cases and boundary conditions

### Test Structure

```typescript
describe('EventPublisher', () => {
  describe('publish', () => {
    it('should publish event successfully', async () => {
      // Test implementation
    });

    it('should handle validation errors', async () => {
      // Test error scenario
    });
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- event-publisher/batched-publisher.spec.ts
```

## Documentation

### Documentation Guidelines

- Keep documentation up to date
- Use clear and concise language
- Include code examples
- Document breaking changes
- Update API documentation for new features

### Documentation Structure

- **README.md**: Main project overview
- **docs/API.md**: Complete API reference
- **docs/QUICKSTART.md**: Getting started guide
- **docs/TROUBLESHOOTING.md**: Common issues and solutions
- **examples/**: Sample applications and demos

## Getting Help

- **Issues**: Use GitHub issues for bugs and feature requests
- **Discussions**: Use GitHub discussions for questions and ideas
- **Documentation**: Check the docs folder for guides and examples

## Recognition

Contributors will be recognized in:
- GitHub contributors list
- Release notes
- Project documentation

Thank you for contributing to the NestJS Events Library!
