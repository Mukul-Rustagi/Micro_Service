const createError = (status, errorCode, message, details = {}) => {
    return {
      status,
      errorCode,
      message,
      details,
      timestamp: new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" }) // Berlin time
    };
  };
  
  // Standard Error Codes
  const ERROR_CODES = {
    // 400 - Bad Request
    BAD_REQUEST: (message = "Invalid request parameters.") => createError(400, "BAD_REQUEST", message),
    INVALID_INPUT: (field, reason) =>
      createError(400, "INVALID_INPUT", "The input provided is invalid.", { field, reason }),
    MISSING_PARAMETER: (param) => createError(400, "MISSING_PARAMETER", `Required parameter '${param}' is missing.`),
    VALIDATION_ERROR: (errors) => createError(400, "VALIDATION_ERROR", "Validation failed.", { errors }),
  
    // 401 - Unauthorized
    UNAUTHORIZED: () => createError(401, "UNAUTHORIZED", "Authentication is required."),
    TOKEN_EXPIRED: () => createError(401, "TOKEN_EXPIRED", "Your session has expired. Please log in again."),
    INVALID_CREDENTIALS: () => createError(401, "INVALID_CREDENTIALS", "Invalid email or password."),
  
    // 403 - Forbidden
    FORBIDDEN: () => createError(403, "FORBIDDEN", "You do not have permission to access this resource."),
    ACCESS_DENIED: () => createError(403, "ACCESS_DENIED", "Access denied for the requested resource."),
  
    // 404 - Not Found
    NOT_FOUND: (resource = "Resource") => createError(404, "NOT_FOUND", `${resource} not found.`),
    USER_NOT_FOUND: () => createError(404, "USER_NOT_FOUND", "User does not exist."),
    PAGE_NOT_FOUND: () => createError(404, "PAGE_NOT_FOUND", "The requested page was not found."),
  
    // 409 - Conflict
    CONFLICT: (message = "A conflict occurred.") => createError(409, "CONFLICT", message),
    EMAIL_ALREADY_EXISTS: () => createError(409, "EMAIL_ALREADY_EXISTS", "This email is already registered."),
    DUPLICATE_ENTRY: (field) => createError(409, "DUPLICATE_ENTRY", `Duplicate entry for '${field}'.`),
  
    // 422 - Unprocessable Entity
    UNPROCESSABLE_ENTITY: (message = "Unable to process the request.") =>
      createError(422, "UNPROCESSABLE_ENTITY", message),
  
    // 429 - Too Many Requests (Rate Limiting)
    RATE_LIMIT_EXCEEDED: () => createError(429, "RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later."),
  
    // 500 - Internal Server Error
    SERVER_ERROR: (message = "An internal server error occurred.") => createError(500, "SERVER_ERROR", message),
    DATABASE_ERROR: () => createError(500, "DATABASE_ERROR", "A database error occurred."),
    SERVICE_UNAVAILABLE: () =>
      createError(503, "SERVICE_UNAVAILABLE", "Service is currently unavailable. Please try again later."),
  
    // Custom Errors for Database, Connection, Timeout, and Access Denied
    DB_ERROR: (message) => createError(500, "DB_ERROR", message), // Database Error
    DB_CONNECTION_ERROR: (message) => createError(500, "DB_CONNECTION_ERROR", message), // Database Connection Error
    TIMEOUT_ERROR: (message) => createError(500, "TIMEOUT_ERROR", message), // Timeout Error
    PERMISSION_DENIED: (message) => createError(403, "PERMISSION_DENIED", message) // Access Denied
  };
  
  module.exports = ERROR_CODES;
  