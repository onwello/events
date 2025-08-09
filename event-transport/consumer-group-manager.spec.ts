import { 
  ConsumerGroupManager, 
  ConsumerGroupConfig,
  ConsumerGroupInfo
} from './consumer-group-manager';
import Redis from 'ioredis';

// Mock Redis for testing
jest.mock('ioredis');

describe('ConsumerGroupManager', () => {
  let groupManager: ConsumerGroupManager;
  let mockRedis: jest.Mocked<Redis>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRedis = {
      xgroup: jest.fn().mockResolvedValue('OK'),
      xinfo: jest.fn().mockResolvedValue([]),
      xpending: jest.fn().mockResolvedValue([0, '0-0', '0-0', []]),
      xclaim: jest.fn().mockResolvedValue([])
    } as any;
    
    const config: ConsumerGroupConfig = {
      autoCreateGroup: true,
      groupNamingStrategy: 'service-name',
      groupValidation: true,
      resumeUnackedMessages: 'only-if-stale',
      staleMessageThreshold: 300000, // 5 minutes
      poisonQueue: {
        enabled: true,
        maxRetries: 3,
        deadLetterTopic: 'dead-letter-events',
        retryDelayMs: 1000
      }
    };
    
    groupManager = new ConsumerGroupManager(mockRedis, config);
  });
  
  describe('Consumer Group Creation', () => {
    it('should create consumer group for topic', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      await groupManager.createConsumerGroup(topic, groupName);
      
      expect(mockRedis.xgroup).toHaveBeenCalledWith(
        'CREATE',
        'topic:user-events:partition:0',
        groupName,
        '0',
        'MKSTREAM'
      );
    });
    
    it('should handle existing consumer group gracefully', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      // Mock Redis to throw BUSYGROUP error
      mockRedis.xgroup.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'));
      
      await groupManager.createConsumerGroup(topic, groupName);
      
      expect(mockRedis.xgroup).toHaveBeenCalled();
    });
    
    it('should throw error for other Redis errors', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      // Mock Redis to throw different error
      mockRedis.xgroup.mockRejectedValueOnce(new Error('Connection failed'));
      
      await expect(groupManager.createConsumerGroup(topic, groupName))
        .rejects.toThrow('Connection failed');
    });
  });
  
  describe('Group Naming Strategy', () => {
    it('should generate service-name based group names', () => {
      const topic = 'user-events';
      const serviceName = 'user-service';
      
      const groupName = groupManager.getConsumerGroupName(topic, serviceName);
      
      expect(groupName).toBe('user-service-user-events-group');
    });
    
    it('should generate custom group names', () => {
      const config: ConsumerGroupConfig = {
        ...groupManager.getConfiguration(),
        groupNamingStrategy: 'custom',
        customGroupName: 'my-custom-group'
      };
      
      const manager = new ConsumerGroupManager(mockRedis, config);
      const groupName = manager.getConsumerGroupName('user-events');
      
      expect(groupName).toBe('my-custom-group');
    });
    
    it('should generate explicit group names', () => {
      const config: ConsumerGroupConfig = {
        ...groupManager.getConfiguration(),
        groupNamingStrategy: 'explicit',
        customGroupName: 'explicit-group'
      };
      
      const manager = new ConsumerGroupManager(mockRedis, config);
      const groupName = manager.getConsumerGroupName('user-events');
      
      expect(groupName).toBe('explicit-group');
    });
    
    it('should generate default group names', () => {
      const config: ConsumerGroupConfig = {
        ...groupManager.getConfiguration(),
        groupNamingStrategy: 'service-name'
      };
      
      const manager = new ConsumerGroupManager(mockRedis, config);
      const groupName = manager.getConsumerGroupName('user-events');
      
      expect(groupName).toBe('user-events-group');
    });
  });
  
  describe('Group Validation', () => {
    it('should validate existing consumer group', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      // Mock Redis to return group info
      mockRedis.xinfo.mockResolvedValueOnce([
        ['name', groupName, 'consumers', '2', 'pending', '5', 'last-delivered-id', '1234567890-0']
      ]);
      
      const isValid = await groupManager.validateConsumerGroup(topic, groupName);
      
      expect(isValid).toBe(true);
      expect(mockRedis.xinfo).toHaveBeenCalledWith('GROUPS', 'topic:user-events:partition:0');
    });
    
    it('should return false for non-existent group', async () => {
      const topic = 'user-events';
      const groupName = 'non-existent-group';
      
      // Mock Redis to return empty groups
      mockRedis.xinfo.mockResolvedValueOnce([]);
      
      const isValid = await groupManager.validateConsumerGroup(topic, groupName);
      
      expect(isValid).toBe(false);
    });
    
    it('should handle Redis errors during validation', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      // Mock Redis to throw error
      mockRedis.xinfo.mockRejectedValueOnce(new Error('Connection failed'));
      
      const isValid = await groupManager.validateConsumerGroup(topic, groupName);
      
      expect(isValid).toBe(false);
    });
  });
  
  describe('Failover Recovery', () => {
    it('should handle failover recovery for topic and group', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      await groupManager.handleFailoverRecovery(topic, groupName);
      
      // Should have called Redis commands for recovery
      expect(mockRedis.xpending).toHaveBeenCalledWith('topic:user-events:partition:0', groupName);
    });
    
    it('should recover unacknowledged messages', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      // Mock pending messages
      mockRedis.xpending.mockResolvedValueOnce([5, '1234567890-0', '1234567890-4', [
        ['1234567890-0', 'consumer-1', 300000, 1],
        ['1234567890-1', 'consumer-2', 600000, 1]
      ]]);
      
      await groupManager.handleFailoverRecovery(topic, groupName);
      
      expect(mockRedis.xpending).toHaveBeenCalled();
    });
    
    it('should handle no pending messages', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      // Mock no pending messages
      mockRedis.xpending.mockResolvedValueOnce([0, '0-0', '0-0', []]);
      
      await groupManager.handleFailoverRecovery(topic, groupName);
      
      expect(mockRedis.xpending).toHaveBeenCalled();
    });
  });
  
  describe('Stale Message Detection', () => {
    it('should detect stale messages', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      // Mock stale messages (older than threshold)
      mockRedis.xpending.mockResolvedValueOnce([2, '1234567890-0', '1234567890-1', [
        ['1234567890-0', 'consumer-1', 400000, 1], // 400s old (stale)
        ['1234567890-1', 'consumer-2', 100000, 1]  // 100s old (not stale)
      ]]);
      
      await groupManager.handleFailoverRecovery(topic, groupName);
      
      expect(mockRedis.xpending).toHaveBeenCalled();
    });
  });
  
  describe('Message Reprocessing', () => {
    it('should reprocess specific messages', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      // Create a manager with resumeUnackedMessages: true for simpler testing
      const testConfig: ConsumerGroupConfig = {
        ...groupManager.getConfiguration(),
        resumeUnackedMessages: true
      };
      const testManager = new ConsumerGroupManager(mockRedis, testConfig);
      
      // Mock pending messages
      mockRedis.xpending.mockResolvedValueOnce([2, '1234567890-0', '1234567890-1', [
        ['1234567890-0', 'consumer-1', 400000, 1],
        ['1234567890-1', 'consumer-2', 400000, 1]
      ]]);
      
      await testManager.handleFailoverRecovery(topic, groupName);
      
      expect(mockRedis.xclaim).toHaveBeenCalled();
    });
  });
  
  describe('Consumer Group Information', () => {
    it('should get consumer group info', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      // Mock group info
      mockRedis.xinfo.mockResolvedValueOnce([
        ['name', groupName, 'consumers', '2', 'pending', '5', 'last-delivered-id', '1234567890-0', 'entries-read', '10', 'lag', '3']
      ]);
      
      // Mock pending info
      mockRedis.xpending.mockResolvedValueOnce([5, '1234567890-0', '1234567890-4', []]);
      
      // Mock consumers
      mockRedis.xinfo.mockResolvedValueOnce([
        ['name', 'consumer-1', 'pending', '3'],
        ['name', 'consumer-2', 'pending', '2']
      ]);
      
      const groupInfo = await groupManager.getConsumerGroupInfo(topic, groupName);
      
      expect(groupInfo).toHaveLength(1);
      expect(groupInfo[0].name).toBe(groupName);
      expect(groupInfo[0].consumers).toBe(2);
      expect(groupInfo[0].pending).toBe(5);
    });
    
    it('should handle missing consumer group', async () => {
      const topic = 'user-events';
      const groupName = 'non-existent-group';
      
      // Mock empty group info
      mockRedis.xinfo.mockResolvedValueOnce([]);
      
      const groupInfo = await groupManager.getConsumerGroupInfo(topic, groupName);
      
      expect(groupInfo).toHaveLength(0);
    });
  });
  
  describe('Group Offset Management', () => {
    it('should reset group offset', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      const offset = '1234567890-0';
      
      await groupManager.resetGroupOffset(topic, groupName, offset);
      
      expect(mockRedis.xgroup).toHaveBeenCalledWith(
        'SETID',
        'topic:user-events:partition:0',
        groupName,
        offset
      );
    });
    
    it('should handle Redis errors during offset reset', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      const offset = '1234567890-0';
      
      // Mock Redis to throw error
      mockRedis.xgroup.mockRejectedValueOnce(new Error('Connection failed'));
      
      await expect(groupManager.resetGroupOffset(topic, groupName, offset))
        .rejects.toThrow('Connection failed');
    });
  });
  
  describe('Group Cleanup', () => {
    it('should cleanup unused groups', async () => {
      const topic = 'user-events';
      const maxAgeHours = 24;
      
      // Mock groups info
      mockRedis.xinfo.mockResolvedValueOnce([
        ['name', 'group-1', 'consumers', '0', 'pending', '0', 'last-delivered-id', '0-0'],
        ['name', 'group-2', 'consumers', '2', 'pending', '5', 'last-delivered-id', '1234567890-0']
      ]);
      
      await groupManager.cleanupUnusedGroups(topic, maxAgeHours);
      
      expect(mockRedis.xinfo).toHaveBeenCalled();
    });
  });
  
  describe('Configuration Management', () => {
    it('should get current configuration', () => {
      const config = groupManager.getConfiguration();
      
      expect(config.autoCreateGroup).toBe(true);
      expect(config.groupNamingStrategy).toBe('service-name');
      expect(config.groupValidation).toBe(true);
      expect(config.resumeUnackedMessages).toBe('only-if-stale');
      expect(config.staleMessageThreshold).toBe(300000);
    });
    
    it('should update configuration', () => {
      groupManager.updateConfiguration({
        autoCreateGroup: false,
        groupNamingStrategy: 'custom',
        customGroupName: 'new-custom-group'
      });
      
      const config = groupManager.getConfiguration();
      
      expect(config.autoCreateGroup).toBe(false);
      expect(config.groupNamingStrategy).toBe('custom');
      expect(config.customGroupName).toBe('new-custom-group');
    });
  });
  
  describe('Group Management Operations', () => {
    it('should ensure consumer group exists', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      await groupManager.ensureConsumerGroup(topic, groupName);
      
      expect(mockRedis.xgroup).toHaveBeenCalled();
    });
    
    it('should not create group when autoCreateGroup is disabled', async () => {
      const config: ConsumerGroupConfig = {
        ...groupManager.getConfiguration(),
        autoCreateGroup: false
      };
      
      const manager = new ConsumerGroupManager(mockRedis, config);
      const topic = 'user-events';
      const groupName = 'test-group';
      
      await manager.ensureConsumerGroup(topic, groupName);
      
      expect(mockRedis.xgroup).not.toHaveBeenCalled();
    });
    
    it('should handle errors during group creation', async () => {
      const topic = 'user-events';
      const groupName = 'test-group';
      
      // Mock Redis to throw error
      mockRedis.xgroup.mockRejectedValueOnce(new Error('Connection failed'));
      
      await expect(groupManager.ensureConsumerGroup(topic, groupName))
        .rejects.toThrow('Connection failed');
    });
  });
});
