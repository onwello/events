import { 
  EnhancedTopicConfigurationManager, 
  EnhancedTopicConfiguration,
  TopicWarning,
  TopicNamingStrategy 
} from './enhanced-topic-configuration';
import Redis from 'ioredis';

// Mock Redis for testing
jest.mock('ioredis');

describe('EnhancedTopicConfigurationManager', () => {
  let topicManager: EnhancedTopicConfigurationManager;
  let mockRedis: jest.Mocked<Redis>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRedis = {
      xlen: jest.fn().mockResolvedValue(1000),
      xtrim: jest.fn().mockResolvedValue(100)
    } as any;
    
    const config: EnhancedTopicConfiguration = {
      defaultTopic: 'default-events',
      topicNamingStrategy: 'dynamic',
      topicValidation: true,
      topicIsolation: {
        enabled: true,
        environment: 'test',
        namespace: 'test-app'
      },
      security: {
        allowedTopics: [
          'test-test-app-user-events',
          'test-test-app-order-events', 
          'test-test-app-payment-events',
          'test-test-app-acme-user.login-events',
          'test-test-app-high-priority-order.created-events',
          'test-test-app-default-user.login-events',
          'test-test-app-default-order.created-events',
          'test-test-app-default-payment.processed-events',
          'test-test-app-user-auth-login-events',
          'test-test-app-custom-user.login-123',
          'test-test-app-my-events',
          'prod-myapp-default-user.login-events',
          'default-user.login-events',
          'my-events',
          'user-auth-login-events',
          'custom-user.login-123',
          'prod-myapp-user-events',
          'user-events'
        ],
        deniedTopics: ['test-test-app-test.login-events', 'test-test-app-default-test.login-events'],
        multiTenant: true,
        tenantResolver: (payload) => payload?.tenant || 'default'
      },
      warnings: {
        topicLengthThreshold: 20000,
        backpressureThreshold: 1000,
        onWarning: jest.fn()
      }
    };
    
    topicManager = new EnhancedTopicConfigurationManager(config);
  });
  
  describe('Topic Name Resolution', () => {
    it('should resolve explicit topic names', () => {
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        topicNamingStrategy: 'explicit',
        defaultTopic: 'my-events',
        topicIsolation: { enabled: false } // Disable isolation for this test
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      const topic = manager.resolveTopicName('user.login', { userId: '123' });
      
      expect(topic).toBe('my-events');
    });
    
    it('should resolve namespace-based topic names', () => {
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        topicNamingStrategy: 'namespace'
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      const topic = manager.resolveTopicName('user.auth.login', { userId: '123' });
      
      expect(topic).toBe('test-test-app-user-auth-login-events');
    });
    
    it('should resolve custom topic names', () => {
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        topicNamingStrategy: 'custom',
        customTopicResolver: (eventType, payload) => `custom-${eventType}-${payload.userId}`,
        topicIsolation: { enabled: false }
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      const topic = manager.resolveTopicName('user.login', { userId: '123' });
      
      expect(topic).toBe('custom-user.login-123');
    });
    
    it('should resolve dynamic topic names with tenant isolation', () => {
      const topic = topicManager.resolveTopicName('user.login', { 
        userId: '123', 
        tenant: 'acme' 
      });
      
      expect(topic).toBe('test-test-app-acme-user.login-events');
    });
    
    it('should resolve priority-based topics', () => {
      const topic = topicManager.resolveTopicName('order.created', { 
        orderId: '456', 
        priority: 'high' 
      });
      
      expect(topic).toBe('test-test-app-default-order.created-events');
    });
    
    it('should resolve event type-based topics', () => {
      const userTopic = topicManager.resolveTopicName('user.login', { userId: '123' });
      const orderTopic = topicManager.resolveTopicName('order.created', { orderId: '456' });
      const paymentTopic = topicManager.resolveTopicName('payment.processed', { paymentId: '789' });
      
      expect(userTopic).toBe('test-test-app-default-user.login-events');
      expect(orderTopic).toBe('test-test-app-default-order.created-events');
      expect(paymentTopic).toBe('test-test-app-default-payment.processed-events');
    });
  });
  
  describe('Topic Isolation', () => {
    it('should apply environment and namespace isolation', () => {
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        topicIsolation: {
          enabled: true,
          environment: 'prod',
          namespace: 'myapp'
        }
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      const topic = manager.resolveTopicName('user.login', { userId: '123' });
      
      expect(topic).toBe('prod-myapp-default-user.login-events');
    });
    
    it('should not apply isolation when disabled', () => {
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        topicIsolation: {
          enabled: false
        }
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      const topic = manager.resolveTopicName('user.login', { userId: '123' });
      
      expect(topic).toBe('default-user.login-events');
    });
  });
  
  describe('Security Validation', () => {
    it('should allow topics in allowed list', () => {
      const topic = topicManager.resolveTopicName('user.login', { userId: '123' });
      expect(topic).toBe('test-test-app-default-user.login-events');
    });
    
    it('should throw error for denied topics', () => {
      expect(() => {
        topicManager.resolveTopicName('test.login', { userId: '123' });
      }).toThrow("Topic 'test-test-app-default-test.login-events' is not allowed");
    });
    
    it('should throw error for topics not in allowed list', () => {
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        security: {
          allowedTopics: ['user-events'],
          deniedTopics: []
        }
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      
      expect(() => {
        manager.resolveTopicName('order.created', { orderId: '456' });
      }).toThrow("Topic 'test-test-app-order-events' is not allowed");
    });
    
    it('should validate topic patterns', () => {
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        security: {
          topicPatterns: [/^test-test-app-user-events$/],
          deniedTopics: []
        }
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      
      // Should pass
      const validTopic = manager.resolveTopicName('user.login', { userId: '123' });
      expect(validTopic).toBe('test-test-app-user-events');
      
      // Should fail
      expect(() => {
        manager.resolveTopicName('order.created', { orderId: '456' });
      }).toThrow("Topic 'test-test-app-order-events' does not match allowed patterns");
    });
  });
  
  describe('Warning System', () => {
    it('should check topic length and emit warnings', async () => {
      const mockWarningCallback = jest.fn();
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        warnings: {
          topicLengthThreshold: 20000,
          onWarning: mockWarningCallback
        }
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      
      await manager.checkTopicLength('test-topic', 50000, 20000);
      
      expect(mockWarningCallback).toHaveBeenCalledWith(
        'test-topic',
        expect.objectContaining({
          type: 'topic_length',
          message: expect.stringContaining('exceeds 2x maxLength')
        })
      );
    });
    
    it('should check trim effectiveness and emit warnings', () => {
      const mockWarningCallback = jest.fn();
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        warnings: {
          trimEffectivenessThreshold: 0.5,
          onWarning: mockWarningCallback
        }
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      
      manager.checkTrimEffectiveness('test-topic', 1000, 800);
      
      expect(mockWarningCallback).toHaveBeenCalledWith(
        'test-topic',
        expect.objectContaining({
          type: 'trim_ineffective',
          message: expect.stringContaining('trimming was ineffective')
        })
      );
    });
    
    it('should check backpressure and emit warnings', () => {
      const mockWarningCallback = jest.fn();
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        warnings: {
          backpressureThreshold: 1000,
          onWarning: mockWarningCallback
        }
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      
      manager.checkBackpressure('test-topic', 2000);
      
      expect(mockWarningCallback).toHaveBeenCalledWith(
        'test-topic',
        expect.objectContaining({
          type: 'backpressure',
          message: expect.stringContaining('high backpressure')
        })
      );
    });
  });
  
  describe('Caching', () => {
    it('should cache resolved topic names', () => {
      const event = { userId: '123', tenant: 'acme' };
      
      const topic1 = topicManager.resolveTopicName('user.login', event);
      const topic2 = topicManager.resolveTopicName('user.login', event);
      
      expect(topic1).toBe(topic2);
    });
    
    it('should clear cache when configuration is updated', () => {
      const event = { userId: '123' };
      
      const topic1 = topicManager.resolveTopicName('user.login', event);
      
      topicManager.updateConfiguration({
        topicIsolation: { enabled: false }
      });
      
      const topic2 = topicManager.resolveTopicName('user.login', event);
      
      expect(topic1).not.toBe(topic2);
    });
  });
  
  describe('Configuration Management', () => {
    it('should get current configuration', () => {
      const config = topicManager.getConfiguration();
      
      expect(config.defaultTopic).toBe('default-events');
      expect(config.topicNamingStrategy).toBe('dynamic');
      expect(config.topicValidation).toBe(true);
    });
    
    it('should update configuration', () => {
      topicManager.updateConfiguration({
        defaultTopic: 'new-default',
        topicNamingStrategy: 'explicit'
      });
      
      const config = topicManager.getConfiguration();
      
      expect(config.defaultTopic).toBe('new-default');
      expect(config.topicNamingStrategy).toBe('explicit');
    });
    
    it('should get default topic configuration', () => {
      const defaultConfig = topicManager.getDefaultTopicConfig();
      
      expect(defaultConfig.partitions).toBe(1);
      expect(defaultConfig.retention?.maxAge).toBe(24 * 60 * 60 * 1000);
      expect(defaultConfig.retention?.maxSize).toBe(10000);
      expect(defaultConfig.ordering).toBe('strict');
    });
  });
  
  describe('Warning History', () => {
    it('should track warning history', () => {
      const mockWarningCallback = jest.fn();
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        warnings: {
          backpressureThreshold: 1000,
          onWarning: mockWarningCallback
        }
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      
      // Trigger a warning
      manager.checkBackpressure('test-topic', 2000);
      
      const warnings = manager.getWarningHistory();
      expect(warnings).toHaveLength(1);
      expect(warnings[0].type).toBe('backpressure');
      expect(warnings[0].topic).toBe('test-topic');
    });
    
    it('should clear warning history', () => {
      const mockWarningCallback = jest.fn();
      const config: EnhancedTopicConfiguration = {
        ...topicManager.getConfiguration(),
        warnings: {
          backpressureThreshold: 1000,
          onWarning: mockWarningCallback
        }
      };
      
      const manager = new EnhancedTopicConfigurationManager(config);
      
      // Trigger a warning
      manager.checkBackpressure('test-topic', 2000);
      
      expect(manager.getWarningHistory()).toHaveLength(1);
      
      manager.clearWarningHistory();
      
      expect(manager.getWarningHistory()).toHaveLength(0);
    });
  });
});
