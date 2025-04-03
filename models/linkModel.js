const { nanoid } = require("nanoid");
const redis = require("../config/db");

class LinkModel {
  async create(linkData) {
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
    const redisData = JSON.stringify(link);
    await redis.set(`shortId:${shortId}`, redisData, 'EX', secondsUntilExpiration);
    await redis.set(`link:${linkData.longURL}`, redisData, 'EX', secondsUntilExpiration);

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
            await this.deleteByShortId(link.shortId);
            deletedCount++;
          }
        }
      } catch (error) {
        console.error(`Error processing key ${key}:`, error.message);
      }
    }
    
    console.log(`Cleanup completed. Deleted ${deletedCount} expired links.`);
    return deletedCount;
  }
}

module.exports = new LinkModel();
