const linkModel = require("../models/linkModel");
const redis = require("../config/db");
const logger = require("../utils/logger");
require("dotenv").config();
const ERROR_CODES = require("../utils/error/errorCodes");

exports.createShortDeepLinkHandler = async (req, res, next) => {
  try {
    const { longURL, userType, bookingStartTime } = req.body;
    logger.info("Starting createShortDeepLink", { longURL, userType, bookingStartTime });
    
    if (!longURL || longURL === "") {
      logger.error("URL is required");
      return next(ERROR_CODES.VALIDATION_ERROR("URL is required"));
    }

    const now = new Date();
    logger.debug("Current time", { time: now.toISOString() });
    let bookingTime = null;
    let ttlSeconds;

    if (bookingStartTime) {
      logger.debug("Processing booking start time", { bookingStartTime });
      bookingTime = new Date(bookingStartTime);
      if (isNaN(bookingTime.getTime())) {
        logger.error("Invalid booking start time format");
        return next(ERROR_CODES.VALIDATION_ERROR("Invalid booking start time format"));
      }
      
      if (bookingTime < now) {
        logger.error("Booking time is in the past", {
          bookingTime: bookingTime.toISOString(),
          currentTime: now.toISOString()
        });
        return next(ERROR_CODES.VALIDATION_ERROR(`Cannot create link - Booking start time (${bookingStartTime}) is in the past`));
      }

      const expirationTime = new Date(bookingTime);
      expirationTime.setMonth(expirationTime.getMonth() + 1);
      ttlSeconds = Math.floor((expirationTime - now) / 1000);

      if (ttlSeconds <= 0) {
        logger.error("TTL would be negative", {
          ttlSeconds,
          bookingTime: bookingTime.toISOString(),
          currentTime: now.toISOString()
        });
        return next(ERROR_CODES.VALIDATION_ERROR("Cannot create link - Expiration time would be in the past"));
      }
    } else {
      ttlSeconds = 9 * 30 * 24 * 60 * 60; // 9 months
      logger.debug("Using default 9 months TTL", { ttlSeconds });
    }

    logger.debug("Checking Redis for existing link");
    const redisKey = `link:${longURL}`;
    const cachedLink = await redis.get(redisKey);
    if (cachedLink) {
      const existingLink = JSON.parse(cachedLink);
      logger.info("Existing link found in Redis", { link: existingLink });
      return res.json({
        shortURL: `${process.env.BASE_URL}/${existingLink.shortId}`,
        deepLink: existingLink.deepLink || null,
        iosLink: existingLink.iosLink || null
      });
    }

    logger.debug("Checking database for existing link");
    let existingLink = await linkModel.findByLongUrl(longURL);
    if (existingLink) {
      logger.info("Existing link found in DB", { link: existingLink });
      return res.json({
        shortURL: `${process.env.BASE_URL}/${existingLink.shortId}`,
        deepLink: existingLink.deepLink || null,
        iosLink: existingLink.iosLink || null
      });
    }

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
      return next(ERROR_CODES.DATABASE_ERROR("Failed to create link"));
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
    return res.json(response);

  } catch (error) {
    logger.error("Error in createShortDeepLink", { error: error.message });
    return next(ERROR_CODES.SERVER_ERROR(error.message));
  }
};

exports.redirectShortLink = async (req, res, next) => {
  try {
    const { shortId } = req.params;
    const userAgent = req.get("User-Agent") || "";
    logger.info("Redirecting shortId", { shortId, userAgent });

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
        return next(ERROR_CODES.NOT_FOUND("Short link not found"));
      }
      logger.debug("Found link in DB", { link });
    }

    const isAndroid = /android/i.test(userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(userAgent);
    const isMobileApp = /RydeuApp|RydeuSupplier/i.test(userAgent);

    let deepLink = link.deepLink || '';
    let iosLink = link.iosLink || '';
    let webFallback = link.longURL;

    if (!webFallback) {
      logger.error("Missing required link data", { shortId });
      return next(ERROR_CODES.SERVER_ERROR("Missing required link data"));
    }

    if (isMobileApp && deepLink) {
      logger.info("Redirecting to app", { url: deepLink });
      return res.redirect(deepLink);
    } else if ((isAndroid || isIOS) && (link.userType === "customer" || link.userType === "supplier") && deepLink) {
      const appUrl = (isIOS && iosLink) ? iosLink : deepLink;
      logger.info("Sending smart banner with fallback", { appUrl, webFallback });
      res.send(`
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <script>
            window.location.href = "${appUrl}";
            setTimeout(function() {
              window.location.href = "${webFallback}";
            }, 1500);
          </script>
        </head>
        <body>
          <h3>Opening Rydeu${link.userType === "supplier" ? " Supplier" : ""}...</h3>
          <p>If the app doesn't open automatically, please wait or use the link below.</p>
          <a href="${webFallback}">Continue in browser</a>
        </body>
        </html>
      `);
    } else {
      logger.info("Redirecting to web URL", { url: webFallback });
      return res.redirect(webFallback);
    }
  } catch (error) {
    logger.error("Error in redirectShortLink", { error: error.message });
    return next(ERROR_CODES.SERVER_ERROR(error.message));
  }
};
