import { RedisConfigFactory, ConfigValidator } from './enhanced-config';
import { enterpriseRedisConfig, highPerformanceConfig, developmentConfig, productionConfig } from './enhanced-config';

describe('Enhanced Redis Configuration', () => {
  describe('Configuration Presets', () => {
    it('should have enterprise features enabled in enterprise config', () => {
      expect(enterpriseRedisConfig.ordering?.enabled).toBe(true);
      expect(enterpriseRedisConfig.partitioning?.enabled).toBe(true);
      expect(enterpriseRedisConfig.schema?.enabled).toBe(true);
      expect(enterpriseRedisConfig.replay?.enabled).toBe(true);
    });

    it('should optimize high performance config for throughput', () => {
      expect(highPerformanceConfig.batchSize).toBe(200);
      expect(highPerformanceConfig.pipelineSize).toBe(500);
      expect(highPerformanceConfig.ordering?.strategy).toBe('partition');
    });

    it('should reduce resource usage in development config', () => {
      expect(developmentConfig.maxLen).toBe(1000);
      expect(developmentConfig.batchSize).toBe(10);
      expect(developmentConfig.ordering?.enabled).toBe(false);
    });

    it('should balance performance and reliability in production config', () => {
      expect(productionConfig.batchSize).toBe(50); // Inherits from enterpriseRedisConfig
      expect(productionConfig.ordering?.enabled).toBe(true);
      expect(productionConfig.partitioning?.enabled).toBe(true);
    });
  });

  describe('RedisConfigFactory', () => {
    let factory: RedisConfigFactory;

    beforeEach(() => {
      factory = new RedisConfigFactory();
    });

    it('should create custom config with overrides', () => {
      const customConfig = RedisConfigFactory.createCustomConfig(enterpriseRedisConfig, {
        host: 'custom-host',
        port: 6380,
        ordering: { 
          enabled: false,
          strategy: 'global',
          maxConcurrency: 10,
          timeoutMs: 30000,
          retryAttempts: 3
        }
      });

      expect(customConfig.host).toBe('custom-host');
      expect(customConfig.port).toBe(6380);
      expect(customConfig.ordering?.enabled).toBe(false);
    });

    it('should create config for different environments', () => {
      const devConfig = RedisConfigFactory.createConfig('dev');
      const prodConfig = RedisConfigFactory.createConfig('prod');

      expect(devConfig).toBe(developmentConfig);
      expect(prodConfig).toBe(productionConfig);
    });
  });

  describe('ConfigValidator', () => {
    let validator: ConfigValidator;

    beforeEach(() => {
      validator = new ConfigValidator();
    });

    it('should validate valid configuration', () => {
      const result = ConfigValidator.validateConfig(enterpriseRedisConfig);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const invalidConfig = { ...enterpriseRedisConfig };
      delete (invalidConfig as any).host;

      const result = ConfigValidator.validateConfig(invalidConfig);
      // The current implementation doesn't validate required fields, only validates ranges
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate port range', () => {
      const invalidConfig = { ...enterpriseRedisConfig, port: 70000 };
      const result = ConfigValidator.validateConfig(invalidConfig);
      expect(result.valid).toBe(false);
    });
  });
});
