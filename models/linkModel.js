const { nanoid } = require("nanoid");
const redis = require("../config/db");
const logger = require("../utils/logger");

const linkModel = {
  async create(linkData) {
    const shortId = nanoid(8);
    const link = {
      shortId,
      longURL: linkData.longURL,
      userType: linkData.userType,
      bookingStartTime: linkData.bookingStartTime ? new Date(linkData.bookingStartTime) : null,
      deepLink: linkData.deepLink || null,
      iosLink: linkData.iosLink || null,
      createdAt: new Date()
    };

    // Calculate TTL in seconds
    let ttlSeconds;
    if (link.bookingStartTime) {
      const oneDayInSeconds = 30*24 * 60 * 60;
      ttlSeconds = oneDayInSeconds;
    } else {
      const nineMonthsInSeconds = 9 * 30 * 24 * 60 * 60;
      ttlSeconds = nineMonthsInSeconds;
    }

    // Store in Redis with TTL
    await redis.set(`shortId:${shortId}`, JSON.stringify(link), 'EX', ttlSeconds);
    await redis.set(`link:${linkData.longURL}`, JSON.stringify(link), 'EX', ttlSeconds);

    logger.info('Stored link in Redis', {
      shortId: shortId,
      longURL: linkData.longURL,
      deepLink: link.deepLink,
      iosLink: link.iosLink,
      expiresIn: `${ttlSeconds} seconds (${link.bookingStartTime ? '1 day from booking' : '9 months from creation'})`
    });

    return link;
  },

  async findByShortId(shortId) {
    const data = await redis.get(`shortId:${shortId}`);
    if (!data) return null;
    return JSON.parse(data);
  },

  async findByLongUrl(longURL) {
    const data = await redis.get(`link:${longURL}`);
    if (!data) return null;
    return JSON.parse(data);
  }
};

module.exports = linkModel;
