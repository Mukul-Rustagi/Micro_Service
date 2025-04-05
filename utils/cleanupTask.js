const redis = require("../config/db");
const { calculateExpirationTime } = require("./linkUtils");

async function cleanupExpiredLinks() {
  try {
    console.log(`[${new Date().toISOString()}] Checking for expired links...`);
    const now = new Date();
    
    // Get all keys from Redis
    const keys = await redis.keys('shortId:*');
    console.log(`[${new Date().toISOString()}] Found ${keys.length} links to check`);
    
    let expiredCount = 0;
    let checkedCount = 0;
    
    for (const key of keys) {
      try {
        const data = await redis.get(key);
        if (data) {
          const link = JSON.parse(data);
          checkedCount++;
          
          const expirationTime = calculateExpirationTime(link);
          
          if (now > expirationTime) {
            console.log(`[${new Date().toISOString()}] Found expired link: ${link.shortId}`);
            console.log(`- ${link.bookingStartTime ? 'Booking Start Time' : 'Creation Time'}: ${link.bookingStartTime || link.createdAt}`);
            console.log(`- Expiration Time: ${expirationTime}`);
            console.log(`- Current Time: ${now}`);
            expiredCount++;
          }
        }
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error processing key ${key}:`, error.message);
      }
    }
    
    if (expiredCount > 0) {
      console.log(`[${new Date().toISOString()}] Check completed:`);
      console.log(`- Checked ${checkedCount} links`);
      console.log(`- Found ${expiredCount} expired links (Redis will handle automatic deletion)`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error in cleanup task:`, error.message);
  }
}

// Run cleanup every 6 hours
setInterval(cleanupExpiredLinks, 6 * 60 * 60 * 1000);

// Run immediately on startup
cleanupExpiredLinks();

module.exports = cleanupExpiredLinks; 