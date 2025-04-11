const linkModel = require("../models/linkModel");
const redis = require("../config/db");
const logger = require("../utils/logger");
const ERROR_CODES = require("../utils/error/errorCodes");

module.exports = {
  createShortDeepLinkHandler: async (req, res, next) => {
    try {
      // Validate request body exists
      if (!req.body || typeof req.body !== 'object') {
        logger.error("Invalid request body");
        return next(ERROR_CODES.VALIDATION_ERROR("Invalid request body"));
      }

      // Safe destructuring with defaults
      const { longURL = '', userType = '', bookingStartTime = null } = req.body;
      
      logger.info("Starting createShortDeepLink", { longURL, userType, bookingStartTime });
      
      // Validate required fields
      if (!longURL || typeof longURL !== 'string' || longURL.trim() === "") {
        logger.error("URL is required and must be a non-empty string");
        return next(ERROR_CODES.VALIDATION_ERROR("URL is required and must be a non-empty string"));
      }

      // Validate URL format
      try {
        new URL(longURL);
      } catch (err) {
        logger.error("Invalid URL format", { longURL });
        return next(ERROR_CODES.VALIDATION_ERROR("Invalid URL format"));
      }

      // Validate userType if provided
      if (userType && !['customer', 'supplier', ''].includes(userType)) {
        logger.error("Invalid userType", { userType });
        return next(ERROR_CODES.VALIDATION_ERROR("Invalid userType"));
      }

      const now = new Date();
      logger.debug("Current time", { time: now.toISOString() });
      let bookingTime = null;
      let ttlSeconds;

      if (bookingStartTime) {
        logger.debug("Processing booking start time", { bookingStartTime });
        try {
          bookingTime = new Date(bookingStartTime);
          if (isNaN(bookingTime.getTime())) {
            logger.error("Invalid booking start time format");
            return next(ERROR_CODES.VALIDATION_ERROR("Invalid booking start time format"));
          }
        } catch (error) {
          logger.error("Error parsing booking start time", { error: error.message });
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
      let cachedLink;
      try {
        cachedLink = await redis.get(redisKey);
      } catch (error) {
        logger.error("Redis error", { error: error.message });
        // Continue with database lookup if Redis fails
      }

      if (cachedLink) {
        try {
          const existingLink = JSON.parse(cachedLink);
          logger.info("Existing link found in Redis", { link: existingLink });
          return res.json({
            shortURL: `${process.env.BASE_URL}/${existingLink.shortId}`,
            deepLink: existingLink.deepLink || null,
            iosLink: existingLink.iosLink || null
          });
        } catch (error) {
          logger.error("Error parsing Redis cache", { error: error.message });
          // Continue with database lookup if parsing fails
        }
      }

      logger.debug("Checking database for existing link");
      let existingLink;
      try {
        existingLink = await linkModel.findByLongUrl(longURL);
      } catch (error) {
        logger.error("Database error", { error: error.message });
        return next(ERROR_CODES.DATABASE_ERROR("Failed to check for existing link"));
      }

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
        try {
          let extractedPath = longURL.split("/").slice(3).join("/");
          let deepLink = userType === "customer"
            ? `rydeu://app/${extractedPath}`
            : `rydeu-supplier://app/${extractedPath}`;
          
          newLinkData.deepLink = deepLink;
          newLinkData.iosLink = deepLink;
          logger.debug("Added deep links", { deepLink, iosLink: deepLink });
        } catch (error) {
          logger.error("Error creating deep links", { error: error.message });
          // Continue without deep links if creation fails
        }
      }

      logger.debug("Creating new link in database");
      let newLink;
      try {
        newLink = await linkModel.create(newLinkData);
      } catch (error) {
        logger.error("Database creation error", { error: error.message });
        return next(ERROR_CODES.DATABASE_ERROR("Failed to create link"));
      }

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
  },

  redirectShortLink: async (req, res, next) => {
    try {
      // Validate request params
      if (!req.params || typeof req.params !== 'object') {
        logger.error("Invalid request parameters");
        return next(ERROR_CODES.VALIDATION_ERROR("Invalid request parameters"));
      }

      const { shortId = '' } = req.params;
      if (!shortId || typeof shortId !== 'string' || shortId.trim() === '') {
        logger.error("Invalid shortId", { shortId });
        return next(ERROR_CODES.VALIDATION_ERROR("Invalid shortId"));
      }

      const userAgent = req.get("User-Agent") || "";
      logger.info("Redirecting shortId", { shortId, userAgent });

      const redisKey = `shortId:${shortId}`;
      let cachedLink;
      try {
        cachedLink = await redis.get(redisKey);
      } catch (error) {
        logger.error("Redis error", { error: error.message });
        // Continue with database lookup if Redis fails
      }

      let link;
      if (cachedLink) {
        try {
          link = JSON.parse(cachedLink);
          logger.debug("Found link in Redis", { link });
        } catch (error) {
          logger.error("Error parsing Redis cache", { error: error.message });
          // Continue with database lookup if parsing fails
        }
      }

      if (!link) {
        try {
          link = await linkModel.findByShortId(shortId);
        } catch (error) {
          logger.error("Database error", { error: error.message });
          return next(ERROR_CODES.DATABASE_ERROR("Failed to find link"));
        }

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
  },
};
