import { 
  PoisonMessageMonitor, 
  PoisonMessageConfig,
  PoisonMessage,
  PoisonMessageStats
} from './poison-message-handler';
import Redis from 'ioredis';

// Mock Redis for testing
jest.mock('ioredis');

describe('PoisonMessageMonitor', () => {
  let poisonMonitor: PoisonMessageMonitor;
  let mockRedis: jest.Mocked<Redis>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRedis = {
      xadd: jest.fn().mockResolvedValue('1234567890-0')
    } as any;
    
    const config: PoisonMessageConfig = {
      enabled: true,
      maxRetries: 3,
      deadLetterTopic: 'dead-letter-events',
      retryDelayMs: 1000,
      retryBackoff: 'exponential',
      poisonMessageHandlers: {
        onPoisonMessage: jest.fn(),
        onMaxRetriesExceeded: jest.fn()
      }
    };
    
    poisonMonitor = new PoisonMessageMonitor(mockRedis, config);
  });
  
  describe('Message Tracking', () => {
    it('should track a new failed message', async () => {
      const messageId = 'msg-123';
      const topic = 'user-events';
      const group = 'user-service-group';
      const eventType = 'user.login';
      const payload = { userId: '123', action: 'login' };
      const error = new Error('Database connection failed');
      
      await poisonMonitor.trackFailedMessage(
        messageId,
        topic,
        group,
        eventType,
        payload,
        error
      );
      
      const message = poisonMonitor.getPoisonMessage(messageId);
      expect(message).toBeDefined();
      expect(message?.id).toBe(messageId);
      expect(message?.topic).toBe(topic);
      expect(message?.group).toBe(group);
      expect(message?.eventType).toBe(eventType);
      expect(message?.payload).toEqual(payload);
      expect(message?.error).toBe(error.message);
      expect(message?.retryCount).toBe(1);
      expect(message?.firstFailureTime).toBeInstanceOf(Date);
      expect(message?.lastFailureTime).toBeInstanceOf(Date);
    });
    
    it('should update existing poison message on retry', async () => {
      const messageId = 'msg-123';
      const topic = 'user-events';
      const group = 'user-service-group';
      const eventType = 'user.login';
      const payload = { userId: '123', action: 'login' };
      const error1 = new Error('Database connection failed');
      const error2 = new Error('Network timeout');
      
      // First failure
      await poisonMonitor.trackFailedMessage(
        messageId,
        topic,
        group,
        eventType,
        payload,
        error1
      );
      
      const message1 = poisonMonitor.getPoisonMessage(messageId);
      expect(message1?.retryCount).toBe(1);
      expect(message1?.error).toBe(error1.message);
      
      // Second failure
      await poisonMonitor.trackFailedMessage(
        messageId,
        topic,
        group,
        eventType,
        payload,
        error2
      );
      
      const message2 = poisonMonitor.getPoisonMessage(messageId);
      expect(message2?.retryCount).toBe(2);
      expect(message2?.error).toBe(error2.message);
      // totalProcessingTime is calculated as Date.now() - firstFailureTime.getTime()
      // Since we're in a test environment, we need to account for the time difference
      expect(message2?.totalProcessingTime).toBeGreaterThanOrEqual(0);
    });
    
    it('should handle max retries exceeded', async () => {
      const messageId = 'msg-123';
      const topic = 'user-events';
      const group = 'user-service-group';
      const eventType = 'user.login';
      const payload = { userId: '123', action: 'login' };
      const error = new Error('Database connection failed');
      
      // Fail 3 times (max retries)
      for (let i = 0; i < 3; i++) {
        await poisonMonitor.trackFailedMessage(
          messageId,
          topic,
          group,
          eventType,
          payload,
          error
        );
      }
      
      // Message should be removed from active poison messages (sent to DLQ)
      const message = poisonMonitor.getPoisonMessage(messageId);
      expect(message).toBeUndefined();
      
      // Check that onMaxRetriesExceeded was called
      const config = poisonMonitor.getConfiguration();
      expect(config.poisonMessageHandlers?.onMaxRetriesExceeded).toHaveBeenCalledWith(
        expect.objectContaining({
          id: messageId,
          retryCount: 3
        })
      );
    });
  });
  
  describe('Statistics', () => {
    it('should calculate poison message statistics', async () => {
      // Add multiple poison messages
      const messages = [
        {
          id: 'msg-1',
          topic: 'user-events',
          group: 'user-service-group',
          eventType: 'user.login',
          payload: { userId: '123' },
          error: new Error('Error 1')
        },
        {
          id: 'msg-2',
          topic: 'order-events',
          group: 'order-service-group',
          eventType: 'order.created',
          payload: { orderId: '456' },
          error: new Error('Error 2')
        },
        {
          id: 'msg-3',
          topic: 'user-events',
          group: 'user-service-group',
          eventType: 'user.logout',
          payload: { userId: '789' },
          error: new Error('Error 3')
        }
      ];
      
      for (const msg of messages) {
        await poisonMonitor.trackFailedMessage(
          msg.id,
          msg.topic,
          msg.group,
          msg.eventType,
          msg.payload,
          msg.error
        );
      }
      
      const stats = poisonMonitor.getPoisonMessageStats();
      
      expect(stats.totalPoisonMessages).toBe(3);
      expect(stats.messagesByEventType['user.login']).toBe(1);
      expect(stats.messagesByEventType['order.created']).toBe(1);
      expect(stats.messagesByEventType['user.logout']).toBe(1);
      expect(stats.messagesByTopic['user-events']).toBe(2);
      expect(stats.messagesByTopic['order-events']).toBe(1);
      expect(stats.averageRetryCount).toBe(1);
      expect(stats.oldestPoisonMessage).toBeInstanceOf(Date);
      expect(stats.retryDistribution[1]).toBe(3);
    });
    
    it('should handle empty statistics', () => {
      const stats = poisonMonitor.getPoisonMessageStats();
      
      expect(stats.totalPoisonMessages).toBe(0);
      expect(stats.messagesByEventType).toEqual({});
      expect(stats.messagesByTopic).toEqual({});
      expect(stats.averageRetryCount).toBe(0);
      expect(stats.oldestPoisonMessage).toBeNull();
      expect(stats.retryDistribution).toEqual({});
    });
  });
  
  describe('Message Retrieval', () => {
    it('should get all poison messages', async () => {
      const messages = [
        {
          id: 'msg-1',
          topic: 'user-events',
          group: 'user-service-group',
          eventType: 'user.login',
          payload: { userId: '123' },
          error: new Error('Error 1')
        },
        {
          id: 'msg-2',
          topic: 'order-events',
          group: 'order-service-group',
          eventType: 'order.created',
          payload: { orderId: '456' },
          error: new Error('Error 2')
        }
      ];
      
      for (const msg of messages) {
        await poisonMonitor.trackFailedMessage(
          msg.id,
          msg.topic,
          msg.group,
          msg.eventType,
          msg.payload,
          msg.error
        );
      }
      
      const allMessages = poisonMonitor.getAllPoisonMessages();
      expect(allMessages).toHaveLength(2);
      expect(allMessages[0].id).toBe('msg-1');
      expect(allMessages[1].id).toBe('msg-2');
    });
    
    it('should get poison messages by topic', async () => {
      const messages = [
        {
          id: 'msg-1',
          topic: 'user-events',
          group: 'user-service-group',
          eventType: 'user.login',
          payload: { userId: '123' },
          error: new Error('Error 1')
        },
        {
          id: 'msg-2',
          topic: 'order-events',
          group: 'order-service-group',
          eventType: 'order.created',
          payload: { orderId: '456' },
          error: new Error('Error 2')
        },
        {
          id: 'msg-3',
          topic: 'user-events',
          group: 'user-service-group',
          eventType: 'user.logout',
          payload: { userId: '789' },
          error: new Error('Error 3')
        }
      ];
      
      for (const msg of messages) {
        await poisonMonitor.trackFailedMessage(
          msg.id,
          msg.topic,
          msg.group,
          msg.eventType,
          msg.payload,
          msg.error
        );
      }
      
      const userMessages = poisonMonitor.getPoisonMessagesByTopic('user-events');
      const orderMessages = poisonMonitor.getPoisonMessagesByTopic('order-events');
      
      expect(userMessages).toHaveLength(2);
      expect(orderMessages).toHaveLength(1);
      expect(userMessages[0].topic).toBe('user-events');
      expect(orderMessages[0].topic).toBe('order-events');
    });
    
    it('should get poison messages by event type', async () => {
      const messages = [
        {
          id: 'msg-1',
          topic: 'user-events',
          group: 'user-service-group',
          eventType: 'user.login',
          payload: { userId: '123' },
          error: new Error('Error 1')
        },
        {
          id: 'msg-2',
          topic: 'order-events',
          group: 'order-service-group',
          eventType: 'order.created',
          payload: { orderId: '456' },
          error: new Error('Error 2')
        },
        {
          id: 'msg-3',
          topic: 'user-events',
          group: 'user-service-group',
          eventType: 'user.login',
          payload: { userId: '789' },
          error: new Error('Error 3')
        }
      ];
      
      for (const msg of messages) {
        await poisonMonitor.trackFailedMessage(
          msg.id,
          msg.topic,
          msg.group,
          msg.eventType,
          msg.payload,
          msg.error
        );
      }
      
      const loginMessages = poisonMonitor.getPoisonMessagesByEventType('user.login');
      const orderMessages = poisonMonitor.getPoisonMessagesByEventType('order.created');
      
      expect(loginMessages).toHaveLength(2);
      expect(orderMessages).toHaveLength(1);
      expect(loginMessages[0].eventType).toBe('user.login');
      expect(orderMessages[0].eventType).toBe('order.created');
    });
  });
  
  describe('Retry Logic', () => {
    it('should calculate linear retry delay', () => {
      const config: PoisonMessageConfig = {
        ...poisonMonitor.getConfiguration(),
        retryBackoff: 'linear'
      };
      
      const monitor = new PoisonMessageMonitor(mockRedis, config);
      
      expect(monitor.getRetryDelay(1)).toBe(1000);
      expect(monitor.getRetryDelay(2)).toBe(1000); // Linear means same delay each time
      expect(monitor.getRetryDelay(3)).toBe(1000);
    });
    
    it('should calculate exponential retry delay', () => {
      const config: PoisonMessageConfig = {
        ...poisonMonitor.getConfiguration(),
        retryBackoff: 'exponential'
      };
      
      const monitor = new PoisonMessageMonitor(mockRedis, config);
      
      expect(monitor.getRetryDelay(1)).toBe(1000);
      expect(monitor.getRetryDelay(2)).toBe(2000);
      expect(monitor.getRetryDelay(3)).toBe(4000);
    });
    
    it('should check if message should be retried', async () => {
      const messageId = 'msg-123';
      const topic = 'user-events';
      const group = 'user-service-group';
      const eventType = 'user.login';
      const payload = { userId: '123' };
      const error = new Error('Database connection failed');
      
      // First failure
      await poisonMonitor.trackFailedMessage(
        messageId,
        topic,
        group,
        eventType,
        payload,
        error
      );
      
      expect(poisonMonitor.shouldRetry(messageId)).toBe(true);
      
      // Fail 2 more times (total 3, max retries)
      for (let i = 0; i < 2; i++) {
        await poisonMonitor.trackFailedMessage(
          messageId,
          topic,
          group,
          eventType,
          payload,
          error
        );
      }
      
      // Message should be removed from active poison messages
      expect(poisonMonitor.shouldRetry(messageId)).toBe(false);
    });
  });
  
  describe('Message Management', () => {
    it('should remove specific poison message', async () => {
      const messageId = 'msg-123';
      const topic = 'user-events';
      const group = 'user-service-group';
      const eventType = 'user.login';
      const payload = { userId: '123' };
      const error = new Error('Database connection failed');
      
      await poisonMonitor.trackFailedMessage(
        messageId,
        topic,
        group,
        eventType,
        payload,
        error
      );
      
      expect(poisonMonitor.getPoisonMessage(messageId)).toBeDefined();
      
      const removed = poisonMonitor.removePoisonMessage(messageId);
      expect(removed).toBe(true);
      
      expect(poisonMonitor.getPoisonMessage(messageId)).toBeUndefined();
    });
    
    it('should clear all poison messages', async () => {
      const messages = [
        {
          id: 'msg-1',
          topic: 'user-events',
          group: 'user-service-group',
          eventType: 'user.login',
          payload: { userId: '123' },
          error: new Error('Error 1')
        },
        {
          id: 'msg-2',
          topic: 'order-events',
          group: 'order-service-group',
          eventType: 'order.created',
          payload: { orderId: '456' },
          error: new Error('Error 2')
        }
      ];
      
      for (const msg of messages) {
        await poisonMonitor.trackFailedMessage(
          msg.id,
          msg.topic,
          msg.group,
          msg.eventType,
          msg.payload,
          msg.error
        );
      }
      
      expect(poisonMonitor.getAllPoisonMessages()).toHaveLength(2);
      
      poisonMonitor.clearPoisonMessages();
      
      expect(poisonMonitor.getAllPoisonMessages()).toHaveLength(0);
      expect(poisonMonitor.getPoisonMessageStats().totalPoisonMessages).toBe(0);
    });
  });
  
  describe('Configuration Management', () => {
    it('should get current configuration', () => {
      const config = poisonMonitor.getConfiguration();
      
      expect(config.enabled).toBe(true);
      expect(config.maxRetries).toBe(3);
      expect(config.deadLetterTopic).toBe('dead-letter-events');
      expect(config.retryDelayMs).toBe(1000);
      expect(config.retryBackoff).toBe('exponential');
    });
    
    it('should update configuration', () => {
      poisonMonitor.updateConfiguration({
        maxRetries: 5,
        retryDelayMs: 2000,
        retryBackoff: 'linear'
      });
      
      const config = poisonMonitor.getConfiguration();
      
      expect(config.maxRetries).toBe(5);
      expect(config.retryDelayMs).toBe(2000);
      expect(config.retryBackoff).toBe('linear');
    });
  });
  
  describe('Dead Letter Queue', () => {
    it('should send message to dead letter topic on max retries', async () => {
      const messageId = 'msg-123';
      const topic = 'user-events';
      const group = 'user-service-group';
      const eventType = 'user.login';
      const payload = { userId: '123' };
      const error = new Error('Database connection failed');
      
      // Fail max retries times
      for (let i = 0; i < 3; i++) {
        await poisonMonitor.trackFailedMessage(
          messageId,
          topic,
          group,
          eventType,
          payload,
          error
        );
      }
      
      // Should have called xadd to send to dead letter topic
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'topic:dead-letter-events:partition:0',
        '*',
        'message',
        expect.stringContaining('max_retries_exceeded')
      );
    });
  });
});
