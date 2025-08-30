import { EnhancedRedisStreamsTransport } from '../plugins/redis/transport/enhanced-redis-streams-transport';
import { Redis } from 'ioredis';

/**
 * Example demonstrating the new single-subscribe approach
 * that automatically detects patterns vs exact event types
 */

async function demonstrateSingleSubscribe() {
  console.log('🚀 Demonstrating Single Subscribe with Auto Pattern Detection\n');

  // Create Redis connection
  const redis = new Redis({
    host: 'localhost',
    port: 6379,
    db: 4, // Use different DB for examples
    lazyConnect: true
  });

  await redis.connect();
  await redis.flushdb();

  try {
    // Create transport
    const transport = new EnhancedRedisStreamsTransport(redis, {
      streamPrefix: 'stream:',
      groupId: 'example-group',
      consumerId: 'example-consumer',
      enableMetrics: false
    });

    await transport.connect();

    // Example 1: Exact Event Type Subscription (no wildcards)
    console.log('📌 Example 1: Exact Event Type Subscription');
    console.log('   Subscribing to: location.user.invite.created');
    
    await transport.subscribe('location-events', 
      (message, metadata) => {
        console.log(`   ✅ Received exact match: ${message.header.type}`);
      }, 
      {}, 
      'location.user.invite.created'
    );

    // Example 2: Pattern Subscription (with wildcards) - Auto-detected!
    console.log('\n🔍 Example 2: Pattern Subscription (Auto-detected)');
    console.log('   Subscribing to: location.user.invite.*');
    
    await transport.subscribe('location-events', 
      (message, metadata) => {
        console.log(`   ✅ Received pattern match: ${message.header.type}`);
      }
      // No need to specify eventType - pattern is auto-detected from 'location.user.invite.*'
    );

    // Example 3: Complex Pattern - Auto-detected!
    console.log('\n🌟 Example 3: Complex Pattern (Auto-detected)');
    console.log('   Subscribing to: *.user.*.updated');
    
    await transport.subscribe('location-events', 
      (message, metadata) => {
        console.log(`   ✅ Received complex pattern match: ${message.header.type}`);
      }
      // No need to specify eventType - pattern is auto-detected from '*.user.*.updated'
    );

    // Example 4: Mixed Subscriptions on Same Stream
    console.log('\n🔄 Example 4: Mixed Subscriptions on Same Stream');
    console.log('   Subscribing to: location.user.profile.updated (exact)');
    
    await transport.subscribe('location-events', 
      (message, metadata) => {
        console.log(`   ✅ Received profile update: ${message.header.type}`);
      }, 
      {}, 
      'location.user.profile.updated'
    );

    // Now publish some messages to demonstrate filtering
    console.log('\n📤 Publishing test messages...\n');

    // Message 1: Should match exact subscription (Example 1)
    await transport.publish('location-events', {
      header: { type: 'location.user.invite.created' },
      body: { data: 'Invite created' }
    });

    // Message 2: Should match pattern subscription (Example 2)
    await transport.publish('location-events', {
      header: { type: 'location.user.invite.status.updated' },
      body: { data: 'Invite status updated' }
    });

    // Message 3: Should match complex pattern (Example 3)
    await transport.publish('location-events', {
      header: { type: 'eu.de.user.profile.updated' },
      body: { data: 'EU user profile updated' }
    });

    // Message 4: Should match exact subscription (Example 4)
    await transport.publish('location-events', {
      header: { type: 'location.user.profile.updated' },
      body: { data: 'Profile updated' }
    });

    // Message 5: Should NOT match any subscription
    await transport.publish('location-events', {
      header: { type: 'location.order.created' },
      body: { data: 'Order created' }
    });

    console.log('\n⏳ Waiting for messages to be processed...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\n📊 Summary:');
    console.log('   • Single subscribe method handles both exact and pattern subscriptions');
    console.log('   • Patterns are automatically detected by presence of * wildcards');
    console.log('   • No need to choose between subscribe() and subscribePattern()');
    console.log('   • Client code is simpler and more intuitive');
    console.log('   • All subscriptions work on the same stream efficiently');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await redis.disconnect();
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  demonstrateSingleSubscribe().catch(console.error);
}

export { demonstrateSingleSubscribe };
