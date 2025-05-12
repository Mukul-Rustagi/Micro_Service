require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// FILE IMPORTS
const redis = require("./config/db");
const linkRoutes = require("./routes/linkRoutes");
const logger = require("./utils/logger");

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Redis Connection Check
redis.on("connect", () => {
  logger.info("Connected to Redis");
});

redis.on("error", (err) => {
  logger.error("Redis connection error:", { error: err.message });
});

// Serve static files from .well-known directory
app.use("/.well-known", express.static(path.join(__dirname, "public/.well-known")));

// Serve apple-app-site-association with correct Content-Type for iOS
app.get("/.well-known/apple-app-site-association", (req, res) => {
  const filePath = path.join(__dirname, "public", ".well-known", "apple-app-site-association");

  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "inline"); // Prevent download
    res.sendFile(filePath);
  } else {
    logger.error("apple-app-site-association not found");
    res.status(404).json({ error: "apple-app-site-association not found" });
  }
});

// Load Routes
app.use("/", linkRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error("Internal server error", { error: err.message });
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.get('/deep-link-handler', (req, res) => {
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Redirecting...</title>
<script>
            setTimeout(function () {
                window.location = "https://staging.rydeu.com/";
            }, 1500);
            window.location = "rydeu://app";
</script>
</head>
<body>
<p>Trying to open the app...</p>
</body>
</html>
    `;
 
    res.status(200).send(htmlContent);
});
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

 

