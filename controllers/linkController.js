const linkModel = require("../models/linkModel");
const redis = require("../config/db");
require("dotenv").config();

exports.createShortDeepLink = async (req, res) => {
  try {
    const { longURL, userType, bookingStartTime } = req.body;
    console.log("Creating short link for:", longURL);
    
    if (!longURL || longURL === "") {
      return res.status(400).json({ error: "URL is required" });
    }

    if (!bookingStartTime) {
      return res.status(400).json({ error: "Booking start time is required" });
    }

    // Validate bookingStartTime
    const bookingTime = new Date(bookingStartTime);
    if (isNaN(bookingTime.getTime())) {
      return res.status(400).json({ error: "Invalid booking start time format" });
    }

    // Check Redis first
    const redisKey = `link:${longURL}`;
    const cachedLink = await redis.get(redisKey);
    if (cachedLink) {
      const existingLink = JSON.parse(cachedLink);
      console.log("Existing link found in Redis:", existingLink);
      const response = {
        shortURL: `${process.env.BASE_URL}/${existingLink.shortId}`,
        deepLink: existingLink.deepLink || null,
        iosLink: existingLink.iosLink || null
      };
      return res.json(response);
    }

    // Check database if not in Redis
    let existingLink = await linkModel.findByLongUrl(longURL);
    if (existingLink) {
      console.log("Existing link found in DB:", existingLink);
      // Cache in Redis with default expiration if booking time is in the past
      const expirationTime = new Date(existingLink.bookingStartTime);
      expirationTime.setMonth(expirationTime.getMonth() + 1);
      const secondsUntilExpiration = Math.max(3600, Math.floor((expirationTime - new Date()) / 1000));
      
      await redis.set(redisKey, JSON.stringify(existingLink), 'EX', secondsUntilExpiration);
      
      const response = {
        shortURL: `${process.env.BASE_URL}/${existingLink.shortId}`,
        deepLink: existingLink.deepLink || null,
        iosLink: existingLink.iosLink || null
      };
      return res.json(response);
    }

    let newLinkData = {
      longURL,
      userType,
      bookingStartTime: bookingTime,
      deepLink: null,
      iosLink: null
    };

    if (userType === "customer" || userType === "supplier") {
      let extractedPath = longURL.split("/").slice(3).join("/");
      let deepLink = userType === "customer"
        ? `rydeu://app/${extractedPath}`
        : `rydeu-supplier://app/${extractedPath}`;
      
      newLinkData.deepLink = deepLink;
      newLinkData.iosLink = deepLink;
    }

    const newLink = await linkModel.create(newLinkData);
    console.log("New short link created:", newLink);
    
    // Calculate expiration time (1 month + bookingStartTime)
    const expirationTime = new Date(newLink.bookingStartTime);
    expirationTime.setMonth(expirationTime.getMonth() + 1);
    
    // Ensure expiration time is at least 1 hour from now
    const secondsUntilExpiration = Math.max(3600, Math.floor((expirationTime - new Date()) / 1000));
    
    // Cache new link in Redis with expiration
    await redis.set(redisKey, JSON.stringify(newLink), 'EX', secondsUntilExpiration);
    
    const response = {
      shortURL: `${process.env.BASE_URL}/${newLink.shortId}`,
      deepLink: newLink.deepLink || null,
      iosLink: newLink.iosLink || null
    };
    return res.json(response);
  } catch (error) {
    console.error("Error in createShortDeepLink:", error.message);
    return res.status(500).json({ error: "Server error" });
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
      if (link) {
        console.log("Found link in DB:", link);
        // Calculate expiration time (1 month + bookingStartTime)
        const expirationTime = new Date(link.bookingStartTime);
        expirationTime.setMonth(expirationTime.getMonth() + 1);
        
        // Ensure expiration time is at least 1 hour from now
        const secondsUntilExpiration = Math.max(3600, Math.floor((expirationTime - new Date()) / 1000));
        
        // Cache in Redis with expiration
        await redis.set(redisKey, JSON.stringify(link), 'EX', secondsUntilExpiration);
      }
    }

    if (!link) {
      console.log("Short link not found:", shortId);
      return res.status(404).json({ error: "Short link not found" });
    }

    // Check if link has expired
    const expirationTime = new Date(link.bookingStartTime);
    expirationTime.setMonth(expirationTime.getMonth() + 1);
    
    if (new Date() > expirationTime) {
      console.log("Link has expired:", shortId);
      // Delete from Redis and database
      await redis.del(redisKey);
      await linkModel.deleteByShortId(shortId);
      return res.status(404).json({ error: "Link has expired" });
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
