const Redis = require("ioredis");
require("dotenv").config();
const logger = require("../utils/logger");

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  retryStrategy: (times) => {
    if (times >= 3) {
      logger.error("Redis connection failed after 3 retries");
      return null;
    }
    const delay = Math.min(times * 1000, 5000);
    logger.warn(`Retrying Redis connection in ${delay}ms`, { attempt: times });
    return delay;
  }
});

module.exports = redis;