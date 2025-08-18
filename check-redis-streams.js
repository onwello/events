import Redis from 'ioredis';

async function checkRedisStreams() {
  const redis = new Redis('redis://localhost:6379');
  try {
    console.log('Checking Redis streams...');
    const keys = await redis.keys('stream:*');
    console.log('Found streams:', keys);
    
    for (const key of keys) {
      const length = await redis.xlen(key);
      console.log(`Stream ${key}: ${length} messages`);
      
      // Check if consumer group exists
      try {
        const groups = await redis.xinfo('GROUPS', key);
        console.log(`  Consumer groups:`, groups);
      } catch (error) {
        console.log(`  No consumer groups found:`, error.message);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await redis.disconnect();
  }
}

checkRedisStreams().catch(console.error);
