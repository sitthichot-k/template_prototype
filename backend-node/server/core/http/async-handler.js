'use strict';

/**
 * Wraps an async route handler so a rejected promise reaches the Express
 * error middleware instead of becoming an unhandled rejection.
 *
 * Express 4 does not await handlers. Without this wrapper, a `throw` inside
 * an async controller silently hangs the request. Every async handler in the
 * platform must be wrapped - `npm run verify:modules` checks for it.
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: Function) => Promise<any>} handler
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
