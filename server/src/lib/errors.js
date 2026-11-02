/** An error that maps directly onto the API's JSON error format. */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const errors = {
  badRequest: (code, message, details) => new AppError(400, code, message, details),
  unauthorized: (code, message) => new AppError(401, code, message),
  forbidden: (code, message) => new AppError(403, code, message),
  notFound: (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message),
  conflict: (code, message) => new AppError(409, code, message),
};

/** Postgres SQLSTATE codes we translate into API errors. */
const PG = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
};

module.exports = { AppError, errors, PG };
