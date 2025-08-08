const Redis = require('ioredis');
const { RedisStreamConsumer } = require('../dist/event-consumer/redis-streams-consumer');

async function debugConsumer() {
  const redis = new Redis({
    host: 'localhost',
    port: 6379
  });

  console.log('🔍 Debugging Consumer...\n');

  // Check stream length
  const streamLength = await redis.xlen('console');
  console.log(`📊 Console stream length: ${streamLength.toLocaleString()} messages`);

  if (streamLength === 0) {
    console.log('❌ No messages in console stream');
    await redis.quit();
    return;
  }

  // Create consumer group from beginning
  try {
    await redis.xgroup('CREATE', 'console', 'debug-group', '0', 'MKSTREAM');
    console.log('✅ Created consumer group from beginning');
  } catch (error) {
    console.log('⚠️  Group might exist, trying to reset...');
    try {
      await redis.xgroup('SETID', 'console', 'debug-group', '0');
      console.log('✅ Reset consumer group to beginning');
    } catch (resetError) {
      console.log(`❌ Could not reset group: ${resetError.message}`);
    }
  }

  // Check pending messages
  try {
    const pending = await redis.xpending('console', 'debug-group');
    console.log(`📋 Pending messages: ${pending[0]}`);
  } catch (error) {
    console.log('❌ No pending messages found');
  }

  // Create consumer
  let processedCount = 0;
  const consumer = new RedisStreamConsumer({
    redis: redis,
    stream: 'console',
    group: 'debug-group',
    consumer: 'debug-consumer',
    handlers: {
      'benchmark-service.TEST.user.created': async (body, header) => {
        processedCount++;
        console.log(`📨 Processed message ${processedCount}: ${header?.type}`);
        return true;
      },
      'benchmark-service.TEST.order.created': async (body, header) => {
        processedCount++;
        console.log(`📨 Processed message ${processedCount}: ${header?.type}`);
        return true;
      },
      'benchmark-service.TEST.payment.processed': async (body, header) => {
        processedCount++;
        console.log(`📨 Processed message ${processedCount}: ${header?.type}`);
        return true;
      }
    },
    blockMs: 1000,
    count: 10,
    validator: {
      validate: () => ({ valid: true }),
      getSchema: () => ({ parse: () => {} })
    },
    verbose: true
  });

  console.log('🚀 Starting consumer...');
  
  // Try a few polls
  for (let i = 0; i < 5; i++) {
    console.log(`\n🔄 Poll ${i + 1}:`);
    await consumer.pollAndHandle();
    console.log(`📊 Processed so far: ${processedCount}`);
    
    // Check remaining messages
    const remaining = await redis.xlen('console');
    console.log(`📈 Remaining messages: ${remaining.toLocaleString()}`);
    
    if (processedCount > 0) {
      console.log('✅ Consumer is working!');
      break;
    }
  }

  if (processedCount === 0) {
    console.log('❌ Consumer processed no messages');
  }

  consumer.stop();
  await redis.quit();
}

debugConsumer().catch(console.error);
