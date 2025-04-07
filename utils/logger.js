const winston = require("winston");
const path = require("path");

const { combine, timestamp, printf } = winston.format;

// Function to extract function name and file path
const getStackInfo = () => {
  try {
    const stack = new Error().stack.split("\n");
    let stackLine = stack.find((line) => line.includes("(") && !line.includes(__filename));
    if (!stackLine) return { function: "unknown", file: "unknown" };

    const match = stackLine.match(/\((.*):(\d+):(\d+)\)/);
    const fullPath = match ? match[1] : "unknown";
    const fileName = path.relative(process.cwd(), fullPath).replace(/^src\//, "");

    const functionNameMatch = stackLine.match(/at (\S+) /);
    const functionName = functionNameMatch ? functionNameMatch[1] : "anonymous";

    return { function: functionName, file: fileName };
  } catch (error) {
    return { function: "unknown", file: "unknown" };
  }
};

// Custom log format
const logFormat = printf(({ timestamp, level, message, ...meta }) => {
  const { function: functionName, file } = meta;
  delete meta.function;
  delete meta.file;
  const metaString = Object.keys(meta).length ? JSON.stringify(meta) : "";
  return `[${timestamp}] [${level.toUpperCase()}] [${file}] [${functionName}] ${message} ${metaString}`;
});

// Create logger
const logger = winston.createLogger({
  format: combine(timestamp(), logFormat),
  transports: [new winston.transports.Console()]
});

// Add file logging for 'stage' or 'production'
if (process.env.NODE_ENV === "stage" || process.env.NODE_ENV === "production") {
  logger.add(new winston.transports.File({ filename: "error.log", level: "error" }));
  logger.add(new winston.transports.File({ filename: "combined.log" }));
}

// Unified log function
const log = (level, message, meta = {}) => {
  const { function: functionName, file } = getStackInfo();
  logger.log(level, message, { function: functionName, file, ...meta });
};

// Morgan stream
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

// Export logging functions
module.exports = {
  info: (msg, meta) => log("info", msg, meta),
  error: (msg, meta) => log("error", msg, meta),
  warn: (msg, meta) => log("warn", msg, meta),
  debug: (msg, meta) => log("debug", msg, meta),
  addTransport: (transport) => logger.add(transport),
  stream: logger.stream
};