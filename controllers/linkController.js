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

      const allowedUserTypes = ['customer', 'supplier', 'organization', ''];
      if (userType && !allowedUserTypes.includes(userType)) {
        logger.error("Invalid userType", { userType });
        return next(ERROR_CODES.VALIDATION_ERROR("Invalid userType"));
      }

      const now = new Date();
      let bookingTime = null;
      let ttlSeconds;

      if (bookingStartTime) {
        try {
          bookingTime = new Date(bookingStartTime);
          if (isNaN(bookingTime.getTime())) {
            return next(ERROR_CODES.VALIDATION_ERROR("Invalid booking start time format"));
          }
        } catch (error) {
          return next(ERROR_CODES.VALIDATION_ERROR("Invalid booking start time format"));
        }

        if (bookingTime < now) {
          return next(ERROR_CODES.VALIDATION_ERROR(`Cannot create link - Booking start time (${bookingStartTime}) is in the past`));
        }

        const expirationTime = new Date(bookingTime);
        const ttlDays = parseInt(process.env.BOOKING_TTL_DAYS);
        expirationTime.setDate(expirationTime.getDate() + ttlDays);
        ttlSeconds = Math.floor((expirationTime - now) / 1000);

        if (ttlSeconds <= 0) {
          return next(ERROR_CODES.VALIDATION_ERROR("Cannot create link - Expiration time would be in the past"));
        }
      } else {
        const defaultMonths = parseInt(process.env.DEFAULT_TTL_MONTHS);
        ttlSeconds = defaultMonths * 30 * 24 * 60 * 60;
      }

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
          return res.json({
            shortURL: `${process.env.BASE_URL}/${existingLink.shortId}`,
            deepLink: existingLink.deepLink || null,
            iosLink: existingLink.iosLink || null
          });
        } catch (error) {
          logger.error("Error parsing Redis cache", { error: error.message });
        }
      }

      let existingLink;
      try {
        existingLink = await linkModel.findByLongUrl(longURL);
      } catch (error) {
        return next(ERROR_CODES.DATABASE_ERROR("Failed to check for existing link"));
      }

      if (existingLink) {
        return res.json({
          shortURL: `${process.env.BASE_URL}/${existingLink.shortId}`,
          deepLink: existingLink.deepLink || null,
          iosLink: existingLink.iosLink || null
        });
      }

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
        } catch (error) {
          logger.error("Error creating deep links", { error: error.message });
        }
      }

      let newLink;
      try {
        newLink = await linkModel.create(newLinkData);
      } catch (error) {
        return next(ERROR_CODES.DATABASE_ERROR("Failed to create link"));
      }

      if (!newLink) {
        return next(ERROR_CODES.DATABASE_ERROR("Failed to create link"));
      }

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

      return res.json(response);

    } catch (error) {
      logger.error("Error in createShortDeepLink", { error: error.message });
      return next(ERROR_CODES.SERVER_ERROR(error.message));
    }
  },

  redirectShortLink: async (req, res, next) => {
    try {
      const { shortId = '' } = req.params;
      if (!shortId || typeof shortId !== 'string' || shortId.trim() === '') {
        return next(ERROR_CODES.VALIDATION_ERROR("Invalid shortId"));
      }

      const userAgent = req.get("User-Agent") || "";
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
        } catch (error) {
          logger.error("Error parsing Redis cache", { error: error.message });
        }
      }

      if (!link) {
        try {
          link = await linkModel.findByShortId(shortId);
          if (!link) {
            return res.status(404).send(`
              <html>
              <head>
                <title>Link Not Found</title>
                <style>
                  body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                  h1 { color: #333; }
                  p { color: #666; }
                </style>
              </head>
              <body>
                <h1>404 - Link Not Found</h1>
                <p>The requested link has expired or does not exist.</p>
              </body>
              </html>
            `);
          }
        } catch (error) {
          logger.error("Database error", { error: error.message });
          return res.status(404).send(`
            <html>
            <head>
              <title>Link Not Found</title>
              <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                h1 { color: #333; }
                p { color: #666; }
              </style>
            </head>
            <body>
              <h1>404 - Link Not Found</h1>
              <p>The requested link has expired or does not exist.</p>
            </body>
            </html>
          `);
        }
      }

      const isAndroid = /android/i.test(userAgent);
      const isIOS = /iphone|ipad|ipod/i.test(userAgent);
      const isMobileApp = /RydeuApp|RydeuSupplier/i.test(userAgent);

      let deepLink = link.deepLink || '';
      let iosLink = link.iosLink || '';
      let webFallback = link.longURL;

      if (!webFallback) {
        return res.status(404).send(`
          <html>
          <head>
            <title>Link Not Found</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              h1 { color: #333; }
              p { color: #666; }
            </style>
          </head>
          <body>
            <h1>404 - Link Not Found</h1>
            <p>The requested link has expired or does not exist.</p>
          </body>
          </html>
        `);
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
              }, 1500);
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
              }, 1500);
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
  }
};
