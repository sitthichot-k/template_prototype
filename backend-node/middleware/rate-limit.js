'use strict';

/**
 * Rate limiting.
 *
 * Counters live in Redis so the limit is shared across replicas - a per-process
 * limiter multiplies the real limit by the replica count, which silently
 * defeats the control in production.
 */

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default || require('rate-limit-redis');

const config = require('../config');
const cache = require('../server/core/db/cache');

function createStore(prefix) {
  return new RedisStore({
    prefix: `${config.redis.keyPrefix}rl:${prefix}:`,
    sendCommand: (...args) => {
      const client = cache.getClient();
      if (!client) throw new Error('Redis unavailable for rate limiting');
      return client.call(...args);
    }
  });
}

const sharedOptions = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
      requestId: req.id
    });
  }
};

/**
 * Rate limiters cannot be built when this file is loaded.
 *
 * RedisStore's constructor loads its increment script immediately, and
 * `server.js` requires the application - and through it this file - before it
 * awaits `cache.connect()`. Building eagerly crashed the process on boot with
 * "Redis unavailable for rate limiting".
 *
 * So construction is deferred. `initRateLimiters()` is called from
 * `middleware/index.js` during `apply(app)`, which runs after the Redis
 * connection is open. The wrapper below still builds on demand as a fallback,
 * but in the normal path the limiter already exists by the first request -
 * which also keeps express-rate-limit from reporting
 * ERR_ERL_CREATED_IN_REQUEST_HANDLER.
 */
const builders = new Map();
const built = new Map();

function defineLimiter(name, factory) {
  builders.set(name, factory);

  return function rateLimitMiddleware(req, res, next) {
    let limiter = built.get(name);
    if (!limiter) {
      limiter = factory();
      built.set(name, limiter);
    }
    return limiter(req, res, next);
  };
}

/** Builds every declared limiter. Safe to call more than once. */
function initRateLimiters() {
  for (const [name, factory] of builders) {
    if (!built.has(name)) built.set(name, factory());
  }
}

/** Broad protection against scraping and accidental request storms. */
const globalRateLimiter = defineLimiter('global', () =>
  rateLimit(
    Object.assign({}, sharedOptions, {
      windowMs: config.http.rateLimit.windowMs,
      max: config.http.rateLimit.max,
      store: createStore('global'),
      skip: (req) => req.path === '/healthz' || req.path === '/readyz'
    })
  )
);

/**
 * Tight limit for credential endpoints, keyed on IP *and* the submitted
 * identifier, so guessing at one account does not spend the budget of every
 * other person behind the same address.
 *
 * The field is `identifier` because that is what the login schema defines.
 * Reading `email`/`username` here - names the API has never accepted - made
 * the identifier always empty, collapsing the key to the address alone. The
 * limiter still worked, but it was limiting the wrong thing, and nothing about
 * a passing request showed it.
 *
 * What this limiter does *not* provide is protection for one account against
 * many addresses: a botnet gets a fresh bucket per address, whatever the key
 * contains. That property comes from account lockout in the local provider
 * (MAX_LOGIN_ATTEMPTS / LOCKOUT_DURATION_MINUTES), which counts on the account
 * and so cannot be spread across addresses at all.
 */
function authRateLimitKey(req) {
  const body = req.body || {};
  const identifier = body.identifier || '';
  return `${req.ip}|${String(identifier).trim().toLowerCase()}`;
}

const authRateLimiter = defineLimiter('auth', () =>
  rateLimit(
    Object.assign({}, sharedOptions, {
      windowMs: config.http.rateLimit.windowMs,
      max: config.http.rateLimit.authMax,
      store: createStore('auth'),
      keyGenerator: authRateLimitKey,
      skipSuccessfulRequests: true
    })
  )
);

/** Factory for module-specific limits (exports, report generation, ...). */
function createRateLimiter(prefix, { windowMs, max }) {
  return defineLimiter(`custom:${prefix}`, () =>
    rateLimit(
      Object.assign({}, sharedOptions, {
        windowMs,
        max,
        store: createStore(prefix)
      })
    )
  );
}

module.exports = { globalRateLimiter, authRateLimiter, authRateLimitKey, createRateLimiter, initRateLimiters };
