const linkModel = require("../models/linkModel");
const redis = require("../config/db");

async function cleanupExpiredLinks() {
  try {
    console.log(`[${new Date().toISOString()}] Starting cleanup of expired links...`);
    const now = new Date();
    
    // Get all keys from Redis
    const keys = await redis.keys('shortId:*');
    console.log(`[${new Date().toISOString()}] Found ${keys.length} links to check`);
    
    let deletedCount = 0;
    let checkedCount = 0;
    
    for (const key of keys) {
      try {
        const data = await redis.get(key);
        if (data) {
          const link = JSON.parse(data);
          checkedCount++;
          
          const expirationTime = new Date(link.bookingStartTime);
          expirationTime.setMonth(expirationTime.getMonth() + 1);
          
          if (now > expirationTime) {
            console.log(`[${new Date().toISOString()}] Deleting expired link: ${link.shortId}`);
            console.log(`- Booking Start Time: ${link.bookingStartTime}`);
            console.log(`- Expiration Time: ${expirationTime}`);
            console.log(`- Current Time: ${now}`);
            
            await redis.del(key);
            await redis.del(`link:${link.longURL}`);
            await linkModel.deleteByShortId(link.shortId);
            deletedCount++;
          }
        }
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error processing key ${key}:`, error.message);
      }
    }
    
    console.log(`[${new Date().toISOString()}] Cleanup completed:`);
    console.log(`- Checked ${checkedCount} links`);
    console.log(`- Deleted ${deletedCount} expired links`);
    console.log(`- Next cleanup scheduled in 6 hours`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error in cleanup task:`, error.message);
  }
}

// Run cleanup every 6 hours
setInterval(cleanupExpiredLinks, 6 * 60 * 60 * 1000);

// Run immediately on startup
cleanupExpiredLinks();

module.exports = cleanupExpiredLinks; 