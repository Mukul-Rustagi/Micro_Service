require("dotenv").config();

module.exports = {
  BASE_URL: process.env.BASE_URL || "http://localhost:5000",
  REDIS_HOST: process.env.REDIS_HOST || "127.0.0.1",
  REDIS_PORT: process.env.REDIS_PORT || 6379,
  PORT: process.env.PORT || 5000
}; 