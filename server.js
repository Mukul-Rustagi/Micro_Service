require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// FILE IMPORTS
const redis = require("./config/db");
const linkRoutes = require("./routes/linkRoutes");

// Import cleanup task
require("./utils/cleanupTask");

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Redis Connection Check
redis.on("connect", () => {
  console.log("Connected to Redis");
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err);
});

// Serve static files from .well-known directory
app.use("/.well-known", express.static(path.join(__dirname, "public/.well-known")));

// Serve apple-app-site-association with correct Content-Type for iOS
app.get("/.well-known/apple-app-site-association", (req, res) => {
  const filePath = path.join(__dirname, "public", ".well-known", "apple-app-site-association");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Type", "application/json"); // iOS requires JSON content-type
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: "apple-app-site-association not found" });
  }
});

// Load Routes (Make sure this is after serving static files)
app.use("/", linkRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`Error: ${err.message}`);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});