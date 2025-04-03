const { nanoid } = require("nanoid");
const redis = require("../config/db");

class LinkModel {
  async create(linkData) {
    // First, check and delete any expired links
    await this.deleteExpiredLinks();

    const shortId = nanoid(8);
    const link = {
      shortId,
      longURL: linkData.longURL,
      userType: linkData.userType,
      bookingStartTime: new Date(linkData.bookingStartTime),
      deepLink: linkData.deepLink || null,
      iosLink: linkData.iosLink || null,
      createdAt: new Date()
    };

    // Store in Redis with expiration
    const expirationTime = new Date(link.bookingStartTime);
    expirationTime.setMonth(expirationTime.getMonth() + 1);
    const secondsUntilExpiration = Math.max(3600, Math.floor((expirationTime - new Date()) / 1000));

    // Store in Redis with expiration
    await redis.set(`shortId:${shortId}`, JSON.stringify(link), 'EX', secondsUntilExpiration);
    await redis.set(`link:${linkData.longURL}`, JSON.stringify(link), 'EX', secondsUntilExpiration);

    console.log('Stored in Redis:', {
      shortId: shortId,
      longURL: linkData.longURL,
      deepLink: link.deepLink,
      iosLink: link.iosLink
    });

    return link;
  }

  async findByShortId(shortId) {
    const data = await redis.get(`shortId:${shortId}`);
    if (!data) return null;

    const link = JSON.parse(data);
    // Check if link has expired
    const expirationTime = new Date(link.bookingStartTime);
    expirationTime.setMonth(expirationTime.getMonth() + 1);
    
    if (new Date() > expirationTime) {
      await this.deleteByShortId(shortId);
      return null;
    }
    
    return link;
  }

  async findByLongUrl(longURL) {
    const data = await redis.get(`link:${longURL}`);
    if (!data) return null;

    const link = JSON.parse(data);
    // Check if link has expired
    const expirationTime = new Date(link.bookingStartTime);
    expirationTime.setMonth(expirationTime.getMonth() + 1);
    
    if (new Date() > expirationTime) {
      await this.deleteByShortId(link.shortId);
      return null;
    }
    
    return link;
  }

  async deleteByShortId(shortId) {
    const link = await this.findByShortId(shortId);
    if (link) {
      // Delete from Redis
      await redis.del(`shortId:${shortId}`);
      await redis.del(`link:${link.longURL}`);
      console.log(`Deleted expired link: ${shortId}`);
    }
    return link;
  }

  async deleteExpiredLinks() {
    try {
      const keys = await redis.keys('shortId:*');
      const now = new Date();
      let deletedCount = 0;
      
      for (const key of keys) {
        try {
          const data = await redis.get(key);
          if (data) {
            const link = JSON.parse(data);
            const expirationTime = new Date(link.bookingStartTime);
            expirationTime.setMonth(expirationTime.getMonth() + 1);
            
            if (now > expirationTime) {
              console.log(`Deleting expired link: ${link.shortId}`);
              console.log(`- Booking Start Time: ${link.bookingStartTime}`);
              console.log(`- Expiration Time: ${expirationTime}`);
              console.log(`- Current Time: ${now}`);
              
              await redis.del(key);
              await redis.del(`link:${link.longURL}`);
              deletedCount++;
            }
          }
        } catch (error) {
          console.error(`Error processing key ${key}:`, error.message);
        }
      }
      
      if (deletedCount > 0) {
        console.log(`Deleted ${deletedCount} expired links`);
      }
    } catch (error) {
      console.error("Error in deleteExpiredLinks:", error.message);
    }
  }
}

module.exports = new LinkModel();
