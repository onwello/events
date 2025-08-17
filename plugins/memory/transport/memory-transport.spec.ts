import { MemoryTransport } from './memory-transport';
import { MessageHandler, MessageMetadata } from '../../../event-transport/transport.interface';

describe('MemoryTransport', () => {
  let transport: MemoryTransport;
  let mockHandler: jest.MockedFunction<MessageHandler>;

  beforeEach(() => {
    transport = new MemoryTransport();
    mockHandler = jest.fn();
  });

  afterEach(async () => {
    await transport.close();
  });

  describe('Transport Interface', () => {
    it('should have correct name', () => {
      expect(transport.name).toBe('memory');
    });

    it('should return correct capabilities', () => {
      const capabilities = transport.capabilities;
      
      expect(capabilities.supportsPartitioning).toBe(false);
      expect(capabilities.supportsOrdering).toBe(true);
      expect(capabilities.supportsDeadLetterQueues).toBe(false);
      expect(capabilities.supportsConsumerGroups).toBe(false);
      expect(capabilities.supportsPatternRouting).toBe(true);
      expect(capabilities.maxMessageSize).toBe(100 * 1024 * 1024);
      expect(capabilities.maxTopics).toBe(1000);
    });
  });

  describe('Lifecycle', () => {
    it('should connect successfully', async () => {
      await expect(transport.connect()).resolves.not.toThrow();
    });

    it('should close successfully', async () => {
      await expect(transport.close()).resolves.not.toThrow();
    });

    it('should not publish after closing', async () => {
      await transport.close();
      await expect(transport.publish('test-topic', { data: 'test' }))
        .rejects.toThrow('Transport is not running');
    });
  });

  describe('Publishing and Subscribing', () => {
    it('should publish and deliver messages to subscribers', async () => {
      const receivedMessages: any[] = [];
      
      mockHandler.mockImplementation(async (envelope, metadata) => {
        receivedMessages.push({ envelope, metadata });
      });

      await transport.subscribe('test-topic', mockHandler);
      await transport.publish('test-topic', { data: 'test message' });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].envelope.body).toEqual({ data: 'test message' });
      expect(receivedMessages[0].metadata.topic).toBe('test-topic');
      expect(receivedMessages[0].metadata.offset).toMatch(/^msg_\d+$/);
      expect(receivedMessages[0].metadata.timestamp).toBeGreaterThan(0);
    });

    it('should handle multiple subscribers to the same topic', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      await transport.subscribe('test-topic', handler1);
      await transport.subscribe('test-topic', handler2);
      await transport.publish('test-topic', { data: 'test' });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple topics independently', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      await transport.subscribe('topic-1', handler1);
      await transport.subscribe('topic-2', handler2);
      
      await transport.publish('topic-1', { data: 'message 1' });
      await transport.publish('topic-2', { data: 'message 2' });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler1).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { data: 'message 1' }
        }), 
        expect.any(Object)
      );
      expect(handler2).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { data: 'message 2' }
        }), 
        expect.any(Object)
      );
    });
  });

  describe('Pattern-based Subscriptions', () => {
    it('should handle wildcard patterns', async () => {
      const handler = jest.fn();

      await transport.subscribePattern('user.*', handler);
      
      await transport.publish('user.created', { id: 1 });
      await transport.publish('user.updated', { id: 2 });
      await transport.publish('order.created', { id: 3 }); // Should not match

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { id: 1 },
          header: expect.objectContaining({
            type: 'user.created'
          })
        }), 
        expect.objectContaining({
          topic: 'user.created',
          matchedPattern: 'user.*'
        }),
        'user.*'
      );
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { id: 2 },
          header: expect.objectContaining({
            type: 'user.updated'
          })
        }), 
        expect.objectContaining({
          topic: 'user.updated',
          matchedPattern: 'user.*'
        }),
        'user.*'
      );
    });

    it('should handle specific patterns', async () => {
      const handler = jest.fn();

      await transport.subscribePattern('user.created', handler);
      
      await transport.publish('user.created', { id: 1 }); // Should match
      await transport.publish('user.updated', { id: 2 });  // Should not match
      await transport.publish('order.created', { id: 3 }); // Should not match

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { id: 1 },
          header: expect.objectContaining({
            type: 'user.created'
          })
        }), 
        expect.objectContaining({
          topic: 'user.created',
          matchedPattern: 'user.created'
        }),
        'user.created'
      );
    });
  });

  describe('Message Headers', () => {
    it('should include headers in published messages', async () => {
      const handler = jest.fn();

      await transport.subscribe('test-topic', handler);
      await transport.publish('test-topic', { data: 'test' }, {
        headers: { 'content-type': 'application/json', 'user-id': '123' }
      });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { data: 'test' }
        }),
        expect.objectContaining({
          headers: { 'content-type': 'application/json', 'user-id': '123' }
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle handler errors gracefully', async () => {
      const errorHandler = jest.fn().mockRejectedValue(new Error('Handler error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await transport.subscribe('test-topic', errorHandler);
      await transport.publish('test-topic', { data: 'test' });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(errorHandler).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error processing message:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Debug Methods', () => {
    it('should provide topic information', async () => {
      await transport.publish('topic-1', { data: 'test1' });
      await transport.publish('topic-2', { data: 'test2' });

      const topics = transport.getTopics();
      expect(topics).toContain('topic-1');
      expect(topics).toContain('topic-2');
    });

    it('should provide message information', async () => {
      await transport.publish('test-topic', { data: 'test message' });

      const messages = transport.getMessages('test-topic');
      expect(messages).toHaveLength(1);
      expect(messages[0].envelope.body).toEqual({ data: 'test message' });
      expect(messages[0].topic).toBe('test-topic');
    });

    it('should provide subscription count', async () => {
      expect(transport.getSubscriptionCount()).toBe(0);

      await transport.subscribe('topic-1', jest.fn());
      expect(transport.getSubscriptionCount()).toBe(1);

      await transport.subscribePattern('user.*', jest.fn());
      expect(transport.getSubscriptionCount()).toBe(2);
    });

    it('should clear topics', async () => {
      await transport.publish('test-topic', { data: 'test' });
      expect(transport.getTopics()).toContain('test-topic');

      transport.clearTopic('test-topic');
      expect(transport.getTopics()).not.toContain('test-topic');
    });

    it('should clear all data', async () => {
      await transport.publish('topic-1', { data: 'test1' });
      await transport.publish('topic-2', { data: 'test2' });

      transport.clearAll();
      expect(transport.getTopics()).toHaveLength(0);
    });
  });
});
