const linkModel = require("../models/linkModel");
const redis = require("../config/db");
const logger = require("../utils/logger");
const ERROR_CODES = require("../utils/error/errorCodes");

module.exports = {
  createShortDeepLinkHandler: async (req, res, next) => {
    try {
      if (!req.body || typeof req.body !== 'object') {
        logger.error("Invalid request body");
        return next(ERROR_CODES.VALIDATION_ERROR("Invalid request body"));
      }

      const { longURL = '', userType = '', bookingStartTime = null } = req.body;
      logger.info("Starting createShortDeepLink", { longURL, userType, bookingStartTime });

      if (!longURL || typeof longURL !== 'string' || longURL.trim() === "") {
        logger.error("URL is required and must be a non-empty string");
        return next(ERROR_CODES.VALIDATION_ERROR("URL is required and must be a non-empty string"));
      }

      try {
        new URL(longURL);
      } catch (err) {
        logger.error("Invalid URL format", { longURL });
        return next(ERROR_CODES.VALIDATION_ERROR("Invalid URL format"));
      }

      if (userType && !['customer', 'supplier', 'organization', ''].includes(userType)) {
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
        }
      } else if (userType === "organization" || userType === "") {
        logger.debug("UserType is organization or empty, skipping deep link creation");
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
      }

      let link;
      if (cachedLink) {
        try {
          link = JSON.parse(cachedLink);
          logger.debug("Found link in Redis", { link });
        } catch (error) {
          logger.error("Error parsing Redis cache", { error: error.message });
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

      if (isMobileApp) {
        return res.redirect(deepLink);
      } else if (isAndroid) {
        res.send(`
          <html>
          <head>
            <meta http-equiv="refresh" content="0; url=${deepLink}">
            <script>
              setTimeout(function() {
                window.location.href = "${webFallback}";
              }, 1000);
            </script>
          </head>
          <body>
            If the app does not open, <a href="${webFallback}">click here</a>.
          </body>
          </html>
        `);
      } else if (isIOS) {
        res.send(`
          <html>
          <head>
            <meta http-equiv="refresh" content="0; url=${iosLink}">
            <script>
              setTimeout(function() {
                window.location.href = "${webFallback}";
              }, 1000);
            </script>
          </head>
          <body>
            If the app does not open, <a href="${webFallback}">click here</a>.
          </body>
          </html>
        `);
      } else {
        return res.redirect(webFallback);
      }
    } catch (error) {
      logger.error("Error in redirectShortLink", { error: error.message });
      return next(ERROR_CODES.SERVER_ERROR(error.message));
    }
  },
};
