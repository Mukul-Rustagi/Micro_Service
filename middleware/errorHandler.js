const logger = require("../utils/logger");

module.exports = (err, req, res, next) => {
  const ERROR_CODES = require("../util/error/errorCodes");

  const errorResponse = err.status
    ? err
    : {
        ...ERROR_CODES.SERVER_ERROR(),
        details: { error: err.message || "Unknown error" }
      };

  //  Ensures the message is logged properly
  logger.error(errorResponse.message, { error: JSON.stringify(errorResponse) });

  res.status(errorResponse.status).json(errorResponse);
};

