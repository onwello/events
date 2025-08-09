import { Transport, MessageHandler, MessageMetadata, PublishOptions, SubscribeOptions, TransportCapabilities } from './transport.interface';
import { Observable } from 'rxjs';

// Mock transport implementation for testing
class MockTransport implements Transport {
  name = 'mock';
  private connected = false;
  private publishedMessages: Array<{ topic: string; message: any; options?: PublishOptions }> = [];
  private subscriptions: Map<string, MessageHandler> = new Map();
  
  async publish(topic: string, message: any, options?: PublishOptions): Promise<void> {
    this.publishedMessages.push({ topic, message, options });
  }
  
  async subscribe(topic: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void> {
    this.subscriptions.set(topic, handler);
  }
  
  async subscribePattern(pattern: string, handler: MessageHandler, options?: SubscribeOptions): Promise<void> {
    this.subscriptions.set(pattern, handler);
  }
  
  emit(pattern: string, data: any): Observable<any> {
    return new Observable(observer => {
      observer.next(data);
      observer.complete();
    });
  }
  
  send(pattern: string, data: any): Observable<any> {
    return new Observable(observer => {
      observer.next(data);
      observer.complete();
    });
  }
  
  async connect(): Promise<void> {
    this.connected = true;
  }
  
  async close(): Promise<void> {
    this.connected = false;
  }
  
  getCapabilities(): TransportCapabilities {
    return {
      supportsPartitioning: true,
      supportsOrdering: true,
      supportsDeadLetterQueues: true,
      supportsConsumerGroups: true,
      supportsPatternRouting: true,
      maxMessageSize: 1024 * 1024,
      maxTopics: 1000
    };
  }
  
  // Test helpers
  getPublishedMessages() {
    return this.publishedMessages;
  }
  
  getSubscriptions() {
    return this.subscriptions;
  }
  
  isConnected() {
    return this.connected;
  }
}

describe('Transport Interface', () => {
  let transport: MockTransport;
  
  beforeEach(() => {
    transport = new MockTransport();
  });
  
  describe('Basic Transport Operations', () => {
    it('should implement all required methods', () => {
      expect(transport.name).toBe('mock');
      expect(typeof transport.publish).toBe('function');
      expect(typeof transport.subscribe).toBe('function');
      expect(typeof transport.subscribePattern).toBe('function');
      expect(typeof transport.emit).toBe('function');
      expect(typeof transport.send).toBe('function');
      expect(typeof transport.connect).toBe('function');
      expect(typeof transport.close).toBe('function');
      expect(typeof transport.getCapabilities).toBe('function');
    });
    
    it('should publish messages correctly', async () => {
      const topic = 'test-topic';
      const message = { id: '123', data: 'test' };
      const options: PublishOptions = { partitionKey: 'key-123' };
      
      await transport.publish(topic, message, options);
      
      const published = transport.getPublishedMessages();
      expect(published).toHaveLength(1);
      expect(published[0]).toEqual({ topic, message, options });
    });
    
    it('should subscribe to topics correctly', async () => {
      const topic = 'test-topic';
      const handler: MessageHandler = async (message, metadata) => {
        console.log('Handled:', message);
      };
      const options: SubscribeOptions = { groupId: 'test-group' };
      
      await transport.subscribe(topic, handler, options);
      
      const subscriptions = transport.getSubscriptions();
      expect(subscriptions.has(topic)).toBe(true);
      expect(subscriptions.get(topic)).toBe(handler);
    });
    
    it('should subscribe to patterns correctly', async () => {
      const pattern = 'test.*';
      const handler: MessageHandler = async (message, metadata) => {
        console.log('Handled pattern:', message);
      };
      const options: SubscribeOptions = { groupId: 'test-group' };
      
      await transport.subscribePattern(pattern, handler, options);
      
      const subscriptions = transport.getSubscriptions();
      expect(subscriptions.has(pattern)).toBe(true);
      expect(subscriptions.get(pattern)).toBe(handler);
    });
    
    it('should emit observables correctly', () => {
      const pattern = 'test-pattern';
      const data = { test: 'data' };
      
      const observable = transport.emit(pattern, data);
      
      expect(observable).toBeDefined();
      expect(typeof observable.subscribe).toBe('function');
    });
    
    it('should send observables correctly', () => {
      const pattern = 'test-pattern';
      const data = { test: 'data' };
      
      const observable = transport.send(pattern, data);
      
      expect(observable).toBeDefined();
      expect(typeof observable.subscribe).toBe('function');
    });
    
    it('should manage connection state', async () => {
      expect(transport.isConnected()).toBe(false);
      
      await transport.connect();
      expect(transport.isConnected()).toBe(true);
      
      await transport.close();
      expect(transport.isConnected()).toBe(false);
    });
  });
  
  describe('Transport Capabilities', () => {
    it('should return valid capabilities', () => {
      const capabilities = transport.getCapabilities();
      
      expect(capabilities).toEqual({
        supportsPartitioning: true,
        supportsOrdering: true,
        supportsDeadLetterQueues: true,
        supportsConsumerGroups: true,
        supportsPatternRouting: true,
        maxMessageSize: 1024 * 1024,
        maxTopics: 1000
      });
    });
    
    it('should have required capability properties', () => {
      const capabilities = transport.getCapabilities();
      
      expect(typeof capabilities.supportsPartitioning).toBe('boolean');
      expect(typeof capabilities.supportsOrdering).toBe('boolean');
      expect(typeof capabilities.supportsDeadLetterQueues).toBe('boolean');
      expect(typeof capabilities.supportsConsumerGroups).toBe('boolean');
      expect(typeof capabilities.supportsPatternRouting).toBe('boolean');
      expect(typeof capabilities.maxMessageSize).toBe('number');
      expect(typeof capabilities.maxTopics).toBe('number');
    });
  });
  
  describe('Message Metadata', () => {
    it('should have correct MessageMetadata structure', () => {
      const metadata: MessageMetadata = {
        topic: 'test-topic',
        partition: 0,
        offset: '1234567890-0',
        timestamp: Date.now(),
        headers: { 'content-type': 'application/json' },
        matchedPattern: 'test.*'
      };
      
      expect(metadata.topic).toBe('test-topic');
      expect(metadata.partition).toBe(0);
      expect(metadata.offset).toBe('1234567890-0');
      expect(typeof metadata.timestamp).toBe('number');
      expect(metadata.headers).toEqual({ 'content-type': 'application/json' });
      expect(metadata.matchedPattern).toBe('test.*');
    });
  });
  
  describe('Publish Options', () => {
    it('should handle all publish option types', () => {
      const options: PublishOptions = {
        partitionKey: 'user-123',
        partition: 2,
        headers: { 'tenant': 'tenant-a' }
      };
      
      expect(options.partitionKey).toBe('user-123');
      expect(options.partition).toBe(2);
      expect(options.headers).toEqual({ 'tenant': 'tenant-a' });
    });
  });
  
  describe('Subscribe Options', () => {
    it('should handle all subscribe option types', () => {
      const options: SubscribeOptions = {
        groupId: 'consumer-group-1',
        consumerId: 'consumer-1',
        autoOffsetReset: 'latest',
        enableAutoCommit: true,
        autoCommitInterval: 5000
      };
      
      expect(options.groupId).toBe('consumer-group-1');
      expect(options.consumerId).toBe('consumer-1');
      expect(options.autoOffsetReset).toBe('latest');
      expect(options.enableAutoCommit).toBe(true);
      expect(options.autoCommitInterval).toBe(5000);
    });
  });
});
