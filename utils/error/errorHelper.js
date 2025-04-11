const ERROR_CODES = require("./errorCodes");
const {
  ValidationError,
  UniqueConstraintError,
  DatabaseError,
  ConnectionError,
  TimeoutError,
  AccessDeniedError
} = require("sequelize");

const logger = require("../logger");

module.exports = {
  handleAxiosError: (error, next) => {
    logger.error("Axios Error:", { error: error.message });

    if (error.response) {
      const { status, data } = error.response;

      const errorMap = {
        400: ERROR_CODES.BAD_REQUEST(data.message),
        401: ERROR_CODES.UNAUTHORIZED(),
        403: ERROR_CODES.FORBIDDEN(),
        404: ERROR_CODES.NOT_FOUND("Resource"),
        409: ERROR_CODES.CONFLICT(),
        422: ERROR_CODES.UNPROCESSABLE_ENTITY(),
        429: ERROR_CODES.RATE_LIMIT_EXCEEDED(),
        500: ERROR_CODES.SERVER_ERROR(data?.message || "Internal Server Error"),
        503: ERROR_CODES.SERVICE_UNAVAILABLE()
      };

      return next(errorMap[status] || ERROR_CODES.SERVER_ERROR(data?.message));
    }

    if (error.request) {
      return next(ERROR_CODES.SERVICE_UNAVAILABLE());
    }

    return next(ERROR_CODES.SERVER_ERROR(error.message));
  },
  handleDbError: (error, entity = "record") => {
    console.log(error);
    if (error instanceof ValidationError) {
      return ERROR_CODES.VALIDATION_ERROR(error.errors.map((e) => e.message));
    }

    if (error instanceof UniqueConstraintError) {
      const field = error?.errors?.[0]?.path || entity;
      return ERROR_CODES.DUPLICATE_ENTRY(field);
    }

    if (error instanceof DatabaseError) {
      return ERROR_CODES.DB_ERROR(`Database error in ${entity}.`);
    }

    if (error instanceof ConnectionError) {
      return ERROR_CODES.DB_CONNECTION_ERROR("Database connection failed.");
    }

    if (error instanceof TimeoutError) {
      return ERROR_CODES.TIMEOUT_ERROR("Database query timed out.");
    }

    if (error instanceof AccessDeniedError) {
      return ERROR_CODES.PERMISSION_DENIED("Access denied to the database.");
    }

    return ERROR_CODES.SERVER_ERROR("Something went wrong.");
  }
};
