'use strict';

/**
 * Terminal error middleware.
 *
 * Translates every failure into the standard envelope and decides what the
 * caller is allowed to see. The rule enforced here: an error the application
 * raised deliberately (AppError) may describe itself; anything else becomes
 * an opaque 500, because an unexpected error's message frequently contains
 * driver internals, connection strings, or record contents.
 */

const mongoose = require('mongoose');
const AppError = require('../errors/AppError');
const response = require('./response');
const logger = require('../../../config/logger');
const config = require('../../../config');

/**
 * Maps well-known third-party errors onto AppError so the rest of the
 * pipeline only ever deals with one type.
 */
function normalize(error) {
  if (error instanceof AppError) return error;

  // Mongoose schema validation
  if (error instanceof mongoose.Error.ValidationError) {
    const details = {};
    for (const [path, err] of Object.entries(error.errors)) {
      details[path] = [err.message];
    }
    return AppError.validation(details, 'The submitted data is invalid.');
  }

  // Malformed ObjectId in a path parameter
  if (error instanceof mongoose.Error.CastError) {
    return AppError.badRequest(`Invalid value for "${error.path}".`);
  }

  // Unique index violation. The index name is safe to surface; the duplicated
  // value is not, since it may be a personal identifier.
  if (error && error.code === 11000) {
    const fields = Object.keys(error.keyPattern || {});
    return AppError.conflict('A record with these values already exists.', {
      fields: fields.length ? fields : undefined
    });
  }

  // Body parser
  if (error && error.type === 'entity.parse.failed') {
    return AppError.badRequest('Request body is not valid JSON.');
  }
  if (error && error.type === 'entity.too.large') {
    return new AppError({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' });
  }

  // JWT
  if (error && error.name === 'TokenExpiredError') {
    return AppError.unauthenticated('Session expired.', 'TOKEN_EXPIRED');
  }
  if (error && error.name === 'JsonWebTokenError') {
    return AppError.unauthenticated('Invalid token.', 'TOKEN_INVALID');
  }

  return AppError.internal('An unexpected error occurred.', error);
}

/**
 * 401s that are the protocol working, not a security event.
 *
 * A 15-minute access token means every session that stays open produces one of
 * these roughly four times an hour, times however many requests were in flight
 * - and the client renews and retries without the user seeing anything. Logged
 * at `warn` they drown the 401s that do mean something: a forged token, a
 * revoked session still being used, a deleted account with a live token.
 *
 * The cost is not disk. It is that "Problems only" in the log viewer fills
 * with routine traffic, the dashboard's error rate reads high while nothing is
 * wrong, and people stop reading warnings - which is the failure that makes
 * every other warning useless.
 *
 * Still recorded at `info`, so the sequence is there when investigating.
 */
const ROUTINE_AUTH_CODES = new Set([
  // The access token reached its TTL. The client refreshes and retries.
  'TOKEN_EXPIRED',
  // A role or grant changed, so outstanding tokens were invalidated on
  // purpose. The client re-bootstraps. This is the mechanism succeeding.
  'PERMISSIONS_CHANGED'
]);

/**
 * Whether a failed response was routine rather than notable.
 *
 * Exported because the two request loggers classify on `res.statusCode` alone
 * and cannot see the error code. The handler publishes it on `res.locals` and
 * they ask here, so all three agree on what counts as a problem - otherwise
 * quietening one leaves the same request shouting from the other two.
 */
function isRoutineFailure(res) {
  return ROUTINE_AUTH_CODES.has(res.locals && res.locals.errorCode);
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
function errorHandler(error, req, res, next) {
  const appError = normalize(error);
  const requestId = req.id;

  // Published for the request loggers, which run on `finish` and only have the
  // status code to go on.
  res.locals.errorCode = appError.code;

  const logPayload = {
    err: appError.cause || error,
    requestId,
    status: appError.status,
    code: appError.code,
    method: req.method,
    path: req.originalUrl,
    userId: req.auth && req.auth.userId
  };

  if (appError.status >= 500) {
    logger.error(logPayload, appError.message);
  } else if ((appError.status === 401 || appError.status === 403) && !ROUTINE_AUTH_CODES.has(appError.code)) {
    // Authorization failures are security signals, not noise.
    logger.warn(logPayload, appError.message);
  } else {
    logger.info(logPayload, appError.message);
  }

  // Never surface an internal message outside local development.
  const clientMessage =
    appError.status >= 500 && !config.env.isLocal ? 'An unexpected error occurred.' : appError.message;

  return response.failure(res, {
    status: appError.status,
    code: appError.code,
    message: clientMessage,
    details: appError.expose ? appError.details : undefined,
    requestId
  });
}

function notFoundHandler(req, res, next) {
  return next(
    new AppError({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`
    })
  );
}

module.exports = { errorHandler, notFoundHandler, normalize, isRoutineFailure, ROUTINE_AUTH_CODES };
