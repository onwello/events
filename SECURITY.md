# Security Policy

## Supported Versions

currently being supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |


## Reporting a Vulnerability

We take the security of the NestJS Events Library seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### Reporting Process

1. **DO NOT** create a public GitHub issue for the vulnerability
2. **DO** email us at [security@onwello.com] with the subject line "SECURITY VULNERABILITY"
3. **DO** include a detailed description of the vulnerability
4. **DO** include steps to reproduce the issue
5. **DO** include any relevant code examples or proof of concept

### What to Include in Your Report

Please include the following information in your security report:

- **Description**: A clear description of the vulnerability
- **Impact**: The potential impact of the vulnerability
- **Steps to Reproduce**: Detailed steps to reproduce the issue
- **Environment**: Node.js version, npm version, Redis version, OS
- **Proof of Concept**: Code examples or screenshots if applicable
- **Suggested Fix**: If you have a suggested fix, please include it

### Response Timeline

- **Initial Response**: Within 48 hours of receiving the report
- **Assessment**: Within 1 week to assess the severity
- **Fix Development**: Timeline depends on severity and complexity
- **Public Disclosure**: Coordinated disclosure after fix is available

### Severity Levels

We use the following severity levels for security issues:

- **Critical**: Immediate fix required, potential for data loss or system compromise
- **High**: Fix required within 1 week, significant security impact
- **Medium**: Fix required within 1 month, moderate security impact
- **Low**: Fix required within 3 months, minor security impact

### Responsible Disclosure

We follow responsible disclosure practices:

1. **Private Reporting**: Security issues are reported privately
2. **Timely Response**: We respond to all security reports promptly
3. **Coordinated Disclosure**: Public disclosure is coordinated after fixes are available
4. **Credit**: Security researchers are credited in our security advisories

### Security Best Practices

When using the NestJS Events Library, follow these security best practices:

#### Redis Security

- **Network Security**: Ensure Redis is not exposed to the internet
- **Authentication**: Use Redis authentication when possible
- **TLS**: Use TLS for Redis connections in production
- **Firewall**: Configure firewalls to restrict Redis access

#### Event Validation

- **Schema Validation**: Always use event validation with Zod schemas
- **Input Sanitization**: Sanitize all event data before processing
- **Type Safety**: Use TypeScript for compile-time type checking

#### Error Handling

- **Graceful Degradation**: Handle errors gracefully without exposing sensitive information
- **Logging**: Log errors appropriately without logging sensitive data
- **Monitoring**: Monitor for unusual patterns or errors

#### Memory Management

- **Resource Limits**: Configure appropriate memory limits
- **Cleanup**: Use the built-in cleanup methods for long-running applications
- **Monitoring**: Monitor memory usage in production

### Security Features

The NestJS Events Library includes several security features:

- **Event Validation**: Built-in schema validation prevents invalid data
- **Idempotency**: Prevents duplicate event processing
- **Error Isolation**: Failed events are isolated and don't affect other processing
- **Memory Management**: Automatic cleanup prevents memory leaks
- **Type Safety**: Full TypeScript support prevents type-related vulnerabilities

### Security Updates

- **Regular Updates**: We regularly update dependencies for security patches
- **Security Advisories**: We publish security advisories for known issues
- **Version Support**: We maintain security updates for supported versions

### Contact Information

For security issues, please contact us at:
- **Email**: [security@onwello.com]
- **PGP Key**: [Include PGP key if available]

### Acknowledgments

We thank the security researchers and community members who responsibly report vulnerabilities to us. Your contributions help make the NestJS Events Library more secure for everyone.

### Security Hall of Fame

We maintain a security hall of fame to recognize researchers who responsibly report vulnerabilities:

- [Researcher Name] - [Vulnerability Description] - [Date]
- [Researcher Name] - [Vulnerability Description] - [Date]

### Related Links

- [NestJS Security Best Practices](https://docs.nestjs.com/security/authentication)
- [Redis Security Documentation](https://redis.io/topics/security)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
