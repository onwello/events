import { Redis } from 'ioredis';
import { EnhancedRedisStreamsTransport } from '../transport/enhanced-redis-streams-transport';
import { enterpriseRedisConfig } from '../transport/enhanced-config';
import { z } from 'zod';

/**
 * Comprehensive example demonstrating enterprise-grade Redis Streams features
 */
async function enterpriseFeaturesExample() {
  console.log('🚀 Starting Enterprise Features Example...\n');

  // 1. Initialize Redis connection
  const redis = new Redis({
    host: 'localhost',
    port: 6379,
    lazyConnect: true
  });

  // 2. Create enhanced transport with enterprise features
  const transport = new EnhancedRedisStreamsTransport(redis, enterpriseRedisConfig);
  
  try {
    // 3. Connect to Redis
    await transport.connect();
    console.log('✅ Connected to Redis with enterprise features\n');

    // 4. Demonstrate Schema Management
    await demonstrateSchemaManagement(transport);
    
    // 5. Demonstrate Message Ordering
    await demonstrateMessageOrdering(transport);
    
    // 6. Demonstrate Advanced Partitioning
    await demonstratePartitioning(transport);
    
    // 7. Demonstrate Message Replay
    await demonstrateMessageReplay(transport);
    
    // 8. Demonstrate Enterprise Monitoring
    await demonstrateEnterpriseMonitoring(transport);

  } catch (error) {
    console.error('❌ Error in enterprise features example:', error);
  } finally {
    // 9. Cleanup
    await transport.close();
    await redis.quit();
    console.log('\n🧹 Cleanup completed');
  }
}

/**
 * Demonstrate schema management capabilities
 */
async function demonstrateSchemaManagement(transport: EnhancedRedisStreamsTransport) {
  console.log('📋 Schema Management Demo:');
  
  const schemaManager = transport.getSchemaManager();
  if (!schemaManager) {
    console.log('   Schema management not enabled');
    return;
  }

  // Define schemas for different event types
  const userCreatedSchema = z.object({
    userId: z.string(),
    email: z.string().email(),
    name: z.string(),
    createdAt: z.string().datetime()
  });

  const orderPlacedSchema = z.object({
    orderId: z.string(),
    userId: z.string(),
    items: z.array(z.object({
      productId: z.string(),
      quantity: z.number().positive(),
      price: z.number().positive()
    })),
    totalAmount: z.number().positive(),
    placedAt: z.string().datetime()
  });

  // Register schemas
  await schemaManager.registerSchema('user.created', userCreatedSchema, '1.0.0', 'backward');
  await schemaManager.registerSchema('order.placed', orderPlacedSchema, '1.0.0', 'backward');
  
  console.log('   ✅ Registered schemas for user.created and order.placed');

  // Validate messages
  const validUserMessage = {
    userId: 'user-123',
    email: 'user@example.com',
    name: 'John Doe',
    createdAt: new Date().toISOString()
  };

  const validation = await schemaManager.validateMessage('user.created', validUserMessage);
  console.log(`   ✅ Message validation: ${validation.valid ? 'PASSED' : 'FAILED'}`);

  // Show schema statistics
  const stats = schemaManager.getSchemaStats();
  console.log(`   📊 Schema stats: ${stats.totalEventTypes} event types, ${stats.totalSchemas} schemas`);
  console.log();
}

/**
 * Demonstrate message ordering capabilities
 */
async function demonstrateMessageOrdering(transport: EnhancedRedisStreamsTransport) {
  console.log('🔢 Message Ordering Demo:');
  
  const orderingManager = transport.getOrderingManager();
  if (!orderingManager) {
    console.log('   Message ordering not enabled');
    return;
  }

  // Generate sequence numbers for different partitions
  const sequence1 = await orderingManager.generateSequenceNumber('user.events', 'user-123');
  const sequence2 = await orderingManager.generateSequenceNumber('user.events', 'user-456');
  
  console.log(`   ✅ Generated sequence for user-123: ${sequence1.sequenceNumber}`);
  console.log(`   ✅ Generated sequence for user-456: ${sequence2.sequenceNumber}`);

  // Show ordering guarantees
  const guarantees = orderingManager.getOrderingGuarantees();
  console.log(`   🎯 Ordering guarantees:`);
  console.log(`      - Global ordering: ${guarantees.globalOrdering}`);
  console.log(`      - Partition ordering: ${guarantees.partitionOrdering}`);
  console.log(`      - Causal ordering: ${guarantees.causalOrdering}`);
  console.log(`      - Exactly once delivery: ${guarantees.exactlyOnceDelivery}`);
  console.log();
}

/**
 * Demonstrate advanced partitioning capabilities
 */
async function demonstratePartitioning(transport: EnhancedRedisStreamsTransport) {
  console.log('🔀 Advanced Partitioning Demo:');
  
  const partitioningManager = transport.getPartitioningManager();
  if (!partitioningManager) {
    console.log('   Advanced partitioning not enabled');
    return;
  }

  // Get partition for different messages
  const userMessage = { userId: 'user-123', action: 'login' };
  const orderMessage = { orderId: 'order-456', userId: 'user-123' };
  
  const userPartition = await partitioningManager.getPartition(userMessage, 'user-123');
  const orderPartition = await partitioningManager.getPartition(orderMessage, 'order-456');
  
  console.log(`   ✅ User message assigned to partition: ${userPartition}`);
  console.log(`   ✅ Order message assigned to partition: ${orderPartition}`);

  // Show partitioning strategy
  const strategy = partitioningManager.getPartitioningStrategy();
  console.log(`   🎯 Partitioning strategy:`);
  console.log(`      - Hash-based: ${strategy.hashBased}`);
  console.log(`      - Round-robin: ${strategy.roundRobin}`);
  console.log(`      - Key-based: ${strategy.keyBased}`);
  console.log(`      - Dynamic: ${strategy.dynamicPartitioning}`);
  console.log(`      - Auto-rebalancing: ${strategy.partitionRebalancing}`);

  // Show partition information
  const partitionInfo = partitioningManager.getAllPartitionInfo();
  console.log(`   📊 Total partitions: ${partitionInfo.length}`);
  console.log();
}

/**
 * Demonstrate message replay capabilities
 */
async function demonstrateMessageReplay(transport: EnhancedRedisStreamsTransport) {
  console.log('🔄 Message Replay Demo:');
  
  const replayManager = transport.getReplayManager();
  if (!replayManager) {
    console.log('   Message replay not enabled');
    return;
  }

  // Publish some test messages first
  const topic = 'test.replay';
  const messages = [
    { id: 1, data: 'First message' },
    { id: 2, data: 'Second message' },
    { id: 3, data: 'Third message' }
  ];

  for (const message of messages) {
    await transport.publish(topic, message);
  }
  console.log(`   ✅ Published ${messages.length} test messages`);

  // Wait a moment for messages to be processed
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Demonstrate replay
  const replayRequest = {
    streamName: `stream:${topic}`,
    startTime: Date.now() - 60000, // Last minute
    maxMessages: 10,
    preserveOrdering: true
  };

  try {
    const replayResult = await replayManager.replayMessages(replayRequest);
    console.log(`   ✅ Replay completed: ${replayResult.messagesReplayed} messages replayed`);
    console.log(`   📊 Replay duration: ${replayResult.duration}ms`);
  } catch (error) {
    console.log(`   ⚠️ Replay failed: ${error}`);
  }

  // Show replay metrics
  const metrics = replayManager.getReplayMetrics();
  console.log(`   📊 Replay metrics:`);
  console.log(`      - Total replays: ${metrics.totalReplays}`);
  console.log(`      - Total messages replayed: ${metrics.totalMessagesReplayed}`);
  console.log(`      - Average replay time: ${metrics.averageReplayTime.toFixed(2)}ms`);
  console.log();
}

/**
 * Demonstrate enterprise monitoring capabilities
 */
async function demonstrateEnterpriseMonitoring(transport: EnhancedRedisStreamsTransport) {
  console.log('📊 Enterprise Monitoring Demo:');
  
  // Get transport status
  const status = await transport.getStatus();
  console.log(`   🔍 Transport status:`);
  console.log(`      - Connected: ${status.connected}`);
  console.log(`      - Healthy: ${status.healthy}`);
  console.log(`      - Uptime: ${status.uptime}ms`);
  console.log(`      - Version: ${status.version}`);

  // Get transport metrics
  const metrics = await transport.getMetrics();
  console.log(`   📈 Transport metrics:`);
  console.log(`      - Messages published: ${metrics.messagesPublished}`);
  console.log(`      - Messages received: ${metrics.messagesReceived}`);
  console.log(`      - Publish latency: ${metrics.publishLatency.toFixed(2)}ms`);
  console.log(`      - Receive latency: ${metrics.receiveLatency.toFixed(2)}ms`);
  console.log(`      - Error rate: ${(metrics.errorRate * 100).toFixed(2)}%`);
  console.log(`      - Throughput: ${metrics.throughput.toFixed(2)} msg/s`);

  // Get enterprise feature status
  const orderingManager = transport.getOrderingManager();
  const partitioningManager = transport.getPartitioningManager();
  const schemaManager = transport.getSchemaManager();
  const replayManager = transport.getReplayManager();

  console.log(`   🏢 Enterprise features status:`);
  console.log(`      - Message ordering: ${orderingManager ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`      - Advanced partitioning: ${partitioningManager ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`      - Schema management: ${schemaManager ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`      - Message replay: ${replayManager ? '✅ Enabled' : '❌ Disabled'}`);

  // Show capabilities
  const capabilities = transport.capabilities;
  console.log(`   🚀 Transport capabilities:`);
  console.log(`      - Supports ordering: ${capabilities.supportsOrdering}`);
  console.log(`      - Supports partitioning: ${capabilities.supportsPartitioning}`);
  console.log(`      - Max partitions: ${capabilities.maxPartitions}`);
  console.log(`      - Max message size: ${(capabilities.maxMessageSize / 1024 / 1024).toFixed(2)}MB`);
  console.log();
}

/**
 * Run the complete example
 */
if (require.main === module) {
  enterpriseFeaturesExample().catch(console.error);
}

export { enterpriseFeaturesExample };
