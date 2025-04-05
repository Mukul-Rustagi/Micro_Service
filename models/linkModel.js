const { nanoid } = require("nanoid");
const redis = require("../config/db");
const { calculateExpirationTime, getSecondsUntilExpiration } = require("../utils/linkUtils");

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

    // Calculate expiration and store in Redis
    const expirationTime = calculateExpirationTime(link);
    const secondsUntilExpiration = getSecondsUntilExpiration(expirationTime);

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
    const expirationTime = calculateExpirationTime(link);
    
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
    const expirationTime = calculateExpirationTime(link);
    
    if (new Date() > expirationTime) {
      await this.deleteByShortId(link.shortId);
      return null;
    }
    
    return link;
  }

  async deleteByShortId(shortId) {
    const link = await this.findByShortId(shortId);
    if (link) {
      await redis.del(`shortId:${shortId}`);
      await redis.del(`link:${link.longURL}`);
      console.log(`Deleted link: ${shortId}`);
    }
    return link;
  }
}

module.exports = new LinkModel();
