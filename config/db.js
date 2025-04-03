const Redis = require("ioredis");
require("dotenv").config();

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  retryStrategy: (times) => {
    if (times >= 3) {
      console.error("Redis connection failed after 3 retries");
      return null;
    }
    const delay = Math.min(times * 1000, 5000);
    console.warn(`Retrying Redis connection in ${delay}ms (Attempt ${times})`);
    return delay;
  }
});

redis.on("connect", () => console.log("Connected to Redis"));
redis.on("error", (err) => console.error("Redis connection error:", err));

module.exports = redis;
