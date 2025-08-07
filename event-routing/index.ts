export interface EventRoute {
  pattern: RegExp;
  transport: string;
  prefix?: string;
}

const eventRoutingConfig = {
  default: 'console',
  routes: [
    { pattern: /^user\.otp_/, transport: 'redis', prefix: 'user-events:' },
    { pattern: /^user\.register_/, transport: 'redis', prefix: 'user-events:' },
    { pattern: /^user\./, transport: 'redis', prefix: 'user-events:' },
    { pattern: /^observability\./, transport: 'redis', prefix: 'observability:' },
    { pattern: /^audit\./, transport: 'console' },
    { pattern: /^exception\./, transport: 'console', prefix: 'exception:' },
  ] as EventRoute[],
};

export default eventRoutingConfig;
export {}; 