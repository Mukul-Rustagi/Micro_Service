const linkModel = require("../models/linkModel");
const redis = require("../config/db");
require("dotenv").config();

exports.createShortDeepLink = async (longURL, userType, bookingStartTime = null) => {
  try {
    console.log("\n=== Starting createShortDeepLink ===");
    console.log("Input parameters:", { longURL, userType, bookingStartTime });
    
    if (!longURL || longURL === "") {
      console.log("Error: URL is required");
      throw new Error("URL is required");
    }

    // Validate booking time first, before any database operations
    const now = new Date();
    console.log("Current time:", now.toISOString());
    let bookingTime = null;
    let ttlSeconds;

    if (bookingStartTime) {
      console.log("Processing booking start time:", bookingStartTime);
      bookingTime = new Date(bookingStartTime);
      if (isNaN(bookingTime.getTime())) {
        console.log("Error: Invalid booking start time format");
        throw new Error("Invalid booking start time format");
      }
      
      // If booking time has passed, don't create the link
      if (bookingTime < now) {
        console.log("Error: Booking time is in the past", {
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
        console.log("Error: TTL would be negative", {
          ttlSeconds,
          bookingTime: bookingTime.toISOString(),
          currentTime: now.toISOString()
        });
        throw new Error(`Cannot create link - Expiration time would be in the past. Booking time: ${bookingStartTime}, Current time: ${now.toISOString()}`);
      }

      console.log("TTL calculation:", {
        bookingTime: bookingTime.toISOString(),
        expirationTime: expirationTime.toISOString(),
        ttlSeconds,
        currentTime: now.toISOString()
      });
    } else {
      // If no bookingStartTime, expire after 9 months from now
      ttlSeconds = 9 * 30 * 24 * 60 * 60; // 9 months in seconds
      console.log("No booking time provided, using default 9 months TTL:", ttlSeconds);
    }

    // Check Redis first
    console.log("Checking Redis for existing link...");
    const redisKey = `link:${longURL}`;
    const cachedLink = await redis.get(redisKey);
    if (cachedLink) {
      const existingLink = JSON.parse(cachedLink);
      console.log("Existing link found in Redis:", existingLink);
      return {
        shortURL: `${process.env.BASE_URL}/${existingLink.shortId}`,
        deepLink: existingLink.deepLink || null,
        iosLink: existingLink.iosLink || null
      };
    }
    console.log("No existing link found in Redis");

    // Check database if not in Redis
    console.log("Checking database for existing link...");
    let existingLink = await linkModel.findByLongUrl(longURL);
    if (existingLink) {
      console.log("Existing link found in DB:", existingLink);
      return {
        shortURL: `${process.env.BASE_URL}/${existingLink.shortId}`,
        deepLink: existingLink.deepLink || null,
        iosLink: existingLink.iosLink || null
      };
    }
    console.log("No existing link found in DB");

    console.log("Creating new link data...");
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
      console.log("Added deep links:", { deepLink, iosLink: deepLink });
    }

    console.log("Creating new link in database...");
    const newLink = await linkModel.create(newLinkData);
    if (!newLink) {
      console.log("Error: Could not create link");
      throw new Error("Could not create link");
    }
    console.log("New link created successfully:", newLink);
    
    // Store in Redis with TTL
    console.log("Storing in Redis with TTL:", ttlSeconds);
    const linkData = JSON.stringify(newLink);
    await redis.set(redisKey, linkData, 'EX', ttlSeconds);
    await redis.set(`shortId:${newLink.shortId}`, linkData, 'EX', ttlSeconds);
    console.log("Successfully stored in Redis");
    
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
    console.log("Returning response:", response);
    console.log("=== End createShortDeepLink ===\n");
    return response;
  } catch (error) {
    console.error("Error in createShortDeepLink:", error.message);
    throw error;
  }
};

// Route handler that uses the function
exports.createShortDeepLinkHandler = async (req, res) => {
  try {
    console.log("\n=== Starting createShortDeepLinkHandler ===");
    console.log("Request body:", req.body);
    const { longURL, userType, bookingStartTime } = req.body;
    const result = await exports.createShortDeepLink(longURL, userType, bookingStartTime);
    console.log("Handler response:", result);
    console.log("=== End createShortDeepLinkHandler ===\n");
    return res.json(result);
  } catch (error) {
    console.error("Error in createShortDeepLinkHandler:", error);
    return res.status(400).json({ error: error.message });
  }
};

exports.redirectShortLink = async (req, res) => {
  try {
    const { shortId } = req.params;
    const userAgent = req.get("User-Agent") || "";
    console.log("Redirecting shortId:", shortId);

    // Check Redis first
    const redisKey = `shortId:${shortId}`;
    const cachedLink = await redis.get(redisKey);
    let link;
    
    if (cachedLink) {
      link = JSON.parse(cachedLink);
      console.log("Found link in Redis:", link);
    } else {
      link = await linkModel.findByShortId(shortId);
      if (!link) {
        console.log("Short link not found:", shortId);
        return res.status(404).json({ error: "Short link not found or has expired" });
      }
      console.log("Found link in DB:", link);
    }

    const isAndroid = /android/i.test(userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(userAgent);
    const isMobileApp = /RydeuApp|RydeuSupplier/i.test(userAgent);

    let redirectURL = link.longURL;

    if ((link.userType === "customer" || link.userType === "supplier") && link.deepLink) {
      if (isMobileApp) {
        console.log("Redirecting to mobile app:", link.deepLink);
        return res.redirect(link.deepLink);
      } else if (isIOS && link.iosLink) {
        redirectURL = link.iosLink;
        console.log("Redirecting to iOS app:", redirectURL);
      } else if (isAndroid && link.deepLink) {
        redirectURL = link.deepLink;
        console.log("Redirecting to Android app:", redirectURL);
      }
    }

    console.log("Redirecting to:", redirectURL);
    return res.redirect(redirectURL);
  } catch (error) {
    console.error("Error in redirectShortLink:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
};
