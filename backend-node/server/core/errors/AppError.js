'use strict';

/**
 * The one error type the HTTP layer knows how to translate.
 *
 * Anything thrown that is not an AppError is treated as an unexpected fault:
 * it is logged with a stack trace and reported to the client as a generic 500
 * with no internal detail. That split is what keeps internal messages from
 * leaking into responses without every handler having to think about it.
 */

class AppError extends Error {
  /**
   * @param {object} params
   * @param {number} params.status      HTTP status code.
   * @param {string} params.code        Stable machine-readable code (SCREAMING_SNAKE).
   * @param {string} params.message     Message safe to show to the caller.
   * @param {object} [params.details]   Field-level detail, e.g. validation errors.
   * @param {Error}  [params.cause]     Underlying error, logged but never sent.
   * @param {boolean} [params.expose]   Whether `details` may reach the client.
   */
  constructor({ status, code, message, details, cause, expose = true }) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose;
    this.isOperational = true;
    if (cause) this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    const body = { code: this.code, message: this.message };
    if (this.expose && this.details) body.details = this.details;
    return body;
  }

  // --- Factories -------------------------------------------------------------
  // Named constructors keep status/code pairs consistent across every module.

  static badRequest(message = 'Invalid request.', details) {
    return new AppError({ status: 400, code: 'BAD_REQUEST', message, details });
  }

  static validation(details, message = 'Validation failed.') {
    return new AppError({ status: 422, code: 'VALIDATION_ERROR', message, details });
  }

  static unauthenticated(message = 'Authentication required.', code = 'UNAUTHENTICATED') {
    return new AppError({ status: 401, code, message });
  }

  static forbidden(message = 'You do not have permission to perform this action.', details) {
    return new AppError({ status: 403, code: 'FORBIDDEN', message, details });
  }

  static notFound(resource = 'Resource') {
    return new AppError({ status: 404, code: 'NOT_FOUND', message: `${resource} was not found.` });
  }

  static conflict(message = 'The resource is in a conflicting state.', details) {
    return new AppError({ status: 409, code: 'CONFLICT', message, details });
  }

  static tooManyRequests(message = 'Too many requests. Try again later.') {
    return new AppError({ status: 429, code: 'RATE_LIMITED', message });
  }

  static internal(message = 'An unexpected error occurred.', cause) {
    return new AppError({ status: 500, code: 'INTERNAL_ERROR', message, cause, expose: false });
  }

  static unavailable(message = 'A dependency is unavailable.', cause) {
    return new AppError({ status: 503, code: 'SERVICE_UNAVAILABLE', message, cause, expose: false });
  }
}

module.exports = AppError;
