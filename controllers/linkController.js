const linkModel = require("../models/linkModel");
const redis = require("../config/db");
const logger = require("../utils/logger");
require("dotenv").config();

exports.createShortDeepLink = async (longURL, userType, bookingStartTime = null) => {
  try {
    logger.info("Starting createShortDeepLink", { longURL, userType, bookingStartTime });
    
    if (!longURL || longURL === "") {
      logger.error("URL is required");
      throw new Error("URL is required");
    }

    // Validate booking time first, before any database operations
    const now = new Date();
    logger.debug("Current time", { time: now.toISOString() });
    let bookingTime = null;
    let ttlSeconds;

    if (bookingStartTime) {
      logger.debug("Processing booking start time", { bookingStartTime });
      bookingTime = new Date(bookingStartTime);
      if (isNaN(bookingTime.getTime())) {
        logger.error("Invalid booking start time format");
        throw new Error("Invalid booking start time format");
      }
      
      // If booking time has passed, don't create the link
      if (bookingTime < now) {
        logger.error("Booking time is in the past", {
          bookingTime: bookingTime.toISOString(),
          currentTime: now.toISOString()
        });
        throw new Error(`Cannot create link - Booking start time (${bookingStartTime}) is in the past. Current time is ${now.toISOString()}`);
      }

      // Set TTL to 1 month after booking start time
      const expirationTime = new Date(bookingTime);
      expirationTime.setMonth(expirationTime.getMonth() + 1);
      ttlSeconds = Math.floor((expirationTime - now) / 1000);

      // Ensure TTL is positive
      if (ttlSeconds <= 0) {
        logger.error("TTL would be negative", {
          ttlSeconds,
          bookingTime: bookingTime.toISOString(),
          currentTime: now.toISOString()
        });
        throw new Error(`Cannot create link - Expiration time would be in the past. Booking time: ${bookingStartTime}, Current time: ${now.toISOString()}`);
      }

      logger.debug("TTL calculation", {
        bookingTime: bookingTime.toISOString(),
        expirationTime: expirationTime.toISOString(),
        ttlSeconds,
        currentTime: now.toISOString()
      });
    } else {
      // If no bookingStartTime, expire after 9 months from now
      ttlSeconds = 9 * 30 * 24 * 60 * 60; // 9 months in seconds
      logger.debug("Using default 9 months TTL", { ttlSeconds });
    }

    // Check Redis first
    logger.debug("Checking Redis for existing link");
    const redisKey = `link:${longURL}`;
    const cachedLink = await redis.get(redisKey);
    if (cachedLink) {
      const existingLink = JSON.parse(cachedLink);
      logger.info("Existing link found in Redis", { link: existingLink });
      return {
        shortURL: `${process.env.BASE_URL}/${existingLink.shortId}`,
        deepLink: existingLink.deepLink || null,
        iosLink: existingLink.iosLink || null
      };
    }
    logger.debug("No existing link found in Redis");

    // Check database if not in Redis
    logger.debug("Checking database for existing link");
    let existingLink = await linkModel.findByLongUrl(longURL);
    if (existingLink) {
      logger.info("Existing link found in DB", { link: existingLink });
      return {
        shortURL: `${process.env.BASE_URL}/${existingLink.shortId}`,
        deepLink: existingLink.deepLink || null,
        iosLink: existingLink.iosLink || null
      };
    }
    logger.debug("No existing link found in DB");

    logger.debug("Creating new link data");
    let newLinkData = {
      longURL,
      userType,
      bookingStartTime: bookingTime,
      deepLink: null,
      iosLink: null,
      createdAt: now
    };

    if (userType === "customer" || userType === "supplier") {
      let extractedPath = longURL.split("/").slice(3).join("/");
      let deepLink = userType === "customer"
        ? `rydeu://app/${extractedPath}`
        : `rydeu-supplier://app/${extractedPath}`;
      
      newLinkData.deepLink = deepLink;
      newLinkData.iosLink = deepLink;
      logger.debug("Added deep links", { deepLink, iosLink: deepLink });
    }

    logger.debug("Creating new link in database");
    const newLink = await linkModel.create(newLinkData);
    if (!newLink) {
      logger.error("Could not create link");
      throw new Error("Could not create link");
    }
    logger.info("New link created successfully", { link: newLink });
    
    const expirationDate = new Date(now.getTime() + (ttlSeconds * 1000));
    const response = {
      shortURL: `${process.env.BASE_URL}/${newLink.shortId}`,
      deepLink: newLink.deepLink || null,
      iosLink: newLink.iosLink || null,
      bookingStartTime: bookingTime ? bookingTime.toISOString() : null,
      expiresAt: expirationDate.toISOString(),
      ttl: {
        seconds: ttlSeconds,
        description: bookingTime ? '1 month after booking start' : '9 months from creation',
        calculatedFrom: bookingTime ? 'booking start time' : 'creation time'
      }
    };
    logger.info("Returning response", { response });
    return response;
  } catch (error) {
    logger.error("Error in createShortDeepLink", { error: error.message });
    throw error;
  }
};

exports.createShortDeepLinkHandler = async (req, res) => {
  try {
    logger.info("Starting createShortDeepLinkHandler", { body: req.body });
    const { longURL, userType, bookingStartTime } = req.body;
    const result = await exports.createShortDeepLink(longURL, userType, bookingStartTime);
    logger.info("Handler response", { result });
    return res.json(result);
  } catch (error) {
    logger.error("Error in createShortDeepLinkHandler", { error: error.message });
    return res.status(400).json({ error: error.message });
  }
};

exports.redirectShortLink = async (req, res) => {
  try {
    const { shortId } = req.params;
    const userAgent = req.get("User-Agent") || "";
    logger.info("Redirecting shortId", { shortId, userAgent });

    // Check Redis first
    const redisKey = `shortId:${shortId}`;
    const cachedLink = await redis.get(redisKey);
    let link;
    
    if (cachedLink) {
      link = JSON.parse(cachedLink);
      logger.debug("Found link in Redis", { link });
    } else {
      link = await linkModel.findByShortId(shortId);
      if (!link) {
        logger.warn("Short link not found", { shortId });
        return res.status(404).json({ error: "Short link not found or has expired" });
      }
      logger.debug("Found link in DB", { link });
    }

    const isAndroid = /android/i.test(userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(userAgent);
    const isMobileApp = /RydeuApp|RydeuSupplier/i.test(userAgent);

    let redirectURL = link.longURL;

    // Modified logic: only use deepLink when opened from app
    if ((link.userType === "customer" || link.userType === "supplier") && link.deepLink) {
      if (isMobileApp) {
        console.log("HI");
        logger.info("Redirecting to mobile app (deepLink)", { url: link.deepLink });
        return res.redirect(link.deepLink);
      } else if (isIOS && link.iosLink) {
        console.log("HI2");
        console.log(link.iosLink);
        redirectURL = link.iosLink;
        logger.info("Redirecting to iOS browser link", { url: redirectURL });
      } else if (isAndroid && link.deepLink) {
        console.log(link.deepLink);
        console.log("HI7");
        redirectURL = link.deepLink;
        logger.info("Redirecting to Android browser link", { url: redirectURL });
      } else {
        console.log("HI3");
        console.log(redirectURL);
        redirectURL = link.longURL;
        logger.info("Fallback to long URL", { url: redirectURL });
      }
    }

    logger.info("Redirecting to final URL", { url: redirectURL });
    return res.redirect(redirectURL);
  } catch (error) {
    logger.error("Error in redirectShortLink", { error: error.message });
    return res.status(500).json({ error: "Server error" });
  }
};
