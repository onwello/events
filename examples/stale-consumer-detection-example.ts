#!/usr/bin/env ts-node

/**
 * Stale Consumer Detection Example
 * 
 * This example demonstrates how to use the stale consumer detection
 * feature to automatically clean up abandoned consumers in Redis Streams.
 */

import Redis from 'ioredis';
import { EnhancedRedisStreamsTransport } from '../dist/plugins/redis/transport/enhanced-redis-streams-transport';

async function main() {
  console.log('🚀 Starting Stale Consumer Detection Example\n');

  // Create Redis connection
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3
  });

  try {
    // Create transport with stale consumer detection enabled
    const transport = new EnhancedRedisStreamsTransport(redis, {
      staleConsumerDetection: {
        enabled: true,
        heartbeatInterval: 10000,        // 10 seconds (for demo)
        staleThreshold: 30000,           // 30 seconds (for demo)
        cleanupInterval: 60000,          // 1 minute (for demo)
        maxStaleConsumers: 50,
        enableHeartbeat: true,
        enablePingPong: true,
        cleanupStrategy: 'conservative',
        preserveConsumerHistory: true
      }
    });

    console.log('✅ Transport created with stale consumer detection enabled');
    console.log('📊 Configuration:');
    console.log(`   - Heartbeat Interval: 10s`);
    console.log(`   - Stale Threshold: 30s`);
    console.log(`   - Cleanup Interval: 1m`);
    console.log(`   - Cleanup Strategy: conservative\n`);

    // Connect to Redis
    await transport.connect();
    console.log('🔗 Connected to Redis');

    // Get initial status
    const initialStatus = await transport.getExtendedStatus();
    console.log('📈 Initial Status:', JSON.stringify(initialStatus, null, 2));

    // Subscribe to a test stream
    const handler = (message: any, metadata: any) => {
      console.log(`📨 Received message: ${JSON.stringify(message)}`);
    };

    await transport.subscribe('test-stream', handler, {
      groupId: 'demo-group',
      consumerId: 'demo-consumer-1'
    });

    console.log('👂 Subscribed to test-stream with consumer demo-consumer-1');

    // Simulate some activity
    await transport.publish('test-stream', {
      id: '1',
      header: { type: 'test.event', timestamp: new Date().toISOString() },
      body: { message: 'Hello from stale consumer detection demo!' }
    });

    console.log('📤 Published test message');

    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check consumer health
    const health = await transport.getConsumerHealth('test-stream', 'demo-group');
    console.log('\n🏥 Consumer Health:', JSON.stringify(health, null, 2));

    // Get stale consumer metrics
    const metrics = await transport.getStaleConsumerMetrics();
    console.log('\n📊 Stale Consumer Metrics:', JSON.stringify(metrics, null, 2));

    // Simulate a stale consumer by creating another consumer and then "abandoning" it
    console.log('\n🔄 Simulating stale consumer scenario...');
    
    // Create a second consumer
    await transport.subscribe('test-stream', handler, {
      groupId: 'demo-group',
      consumerId: 'demo-consumer-2'
    });

    console.log('👂 Created second consumer: demo-consumer-2');

    // Wait for the stale threshold to be exceeded
    console.log(`⏳ Waiting ${initialStatus.staleConsumerDetection?.metrics?.staleThreshold || 30000}ms for consumer to become stale...`);
    await new Promise(resolve => setTimeout(resolve, 35000));

    // Check health again
    const healthAfter = await transport.getConsumerHealth('test-stream', 'demo-group');
    console.log('\n🏥 Consumer Health After Wait:', JSON.stringify(healthAfter, null, 2));

    // Manually trigger cleanup
    console.log('\n🧹 Manually triggering stale consumer cleanup...');
    await transport.triggerStaleConsumerCleanup();

    // Wait a bit for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check final metrics
    const finalMetrics = await transport.getStaleConsumerMetrics();
    console.log('\n📊 Final Stale Consumer Metrics:', JSON.stringify(finalMetrics, null, 2));

    // Get final status
    const finalStatus = await transport.getExtendedStatus();
    console.log('\n📈 Final Status:', JSON.stringify(finalStatus, null, 2));

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await transport.unsubscribe('test-stream');
    await transport.disconnect();
    await redis.quit();

    console.log('\n✅ Example completed successfully!');
    console.log('\n💡 Key Takeaways:');
    console.log('   - Stale consumer detection automatically monitors consumer health');
    console.log('   - Heartbeat mechanism ensures active consumers are tracked');
    console.log('   - Ping-pong health checks verify real-time responsiveness');
    console.log('   - Configurable cleanup strategies provide flexibility');
    console.log('   - Comprehensive metrics enable monitoring and alerting');

  } catch (error) {
    console.error('❌ Error in example:', error);
    
    // Cleanup on error
    try {
      await redis.quit();
    } catch (cleanupError) {
      console.error('Failed to cleanup Redis connection:', cleanupError);
    }
    
    process.exit(1);
  }
}

// Production configuration example
function getProductionConfig() {
  return {
    staleConsumerDetection: {
      enabled: true,
      heartbeatInterval: 30000,        // 30 seconds
      staleThreshold: 120000,          // 2 minutes
      cleanupInterval: 300000,         // 5 minutes
      maxStaleConsumers: 100,
      enableHeartbeat: true,
      enablePingPong: true,
      cleanupStrategy: 'conservative' as const,
      preserveConsumerHistory: true
    }
  };
}

// Development configuration example
function getDevelopmentConfig() {
  return {
    staleConsumerDetection: {
      enabled: true,
      heartbeatInterval: 15000,        // 15 seconds
      staleThreshold: 60000,           // 1 minute
      cleanupInterval: 120000,         // 2 minutes
      maxStaleConsumers: 50,
      enableHeartbeat: true,
      enablePingPong: true,
      cleanupStrategy: 'aggressive' as const,
      preserveConsumerHistory: false
    }
  };
}

// Monitoring example
async function monitorConsumerHealth(transport: EnhancedRedisStreamsTransport) {
  console.log('🔍 Starting consumer health monitoring...');
  
  const monitorInterval = setInterval(async () => {
    try {
      const metrics = await transport.getStaleConsumerMetrics();
      const status = await transport.getExtendedStatus();
      
      console.log('\n📊 Health Check:', new Date().toISOString());
      console.log(`   Total Consumers: ${metrics?.totalConsumers || 0}`);
      console.log(`   Healthy: ${metrics?.healthyConsumers || 0}`);
      console.log(`   Stale: ${metrics?.staleConsumers || 0}`);
      console.log(`   Dead: ${metrics?.deadConsumers || 0}`);
      console.log(`   Last Cleanup: ${metrics?.lastCleanupAt || 'Never'}`);
      
      // Alert if too many stale consumers
      if (metrics && metrics.staleConsumers > 10) {
        console.log('⚠️  WARNING: High number of stale consumers detected!');
      }
      
    } catch (error) {
      console.error('❌ Error in health monitoring:', error);
    }
  }, 30000); // Check every 30 seconds
  
  return monitorInterval;
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}

export { main, getProductionConfig, getDevelopmentConfig, monitorConsumerHealth };
