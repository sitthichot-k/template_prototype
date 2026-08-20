'use strict';

/**
 * Platform middleware stack, applied to every request before any module sees
 * it. Order is significant and documented inline.
 */

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const { randomUUID } = require('crypto');

const config = require('../config');
const logger = require('../config/logger');
const corsMiddleware = require('./cors');
const { globalRateLimiter, initRateLimiters } = require('./rate-limit');
const { isRoutineFailure } = require('../server/core/http/error-handler');

function apply(app) {
  // 1. Correlation id first, so every later log line and error response can
  //    carry it. Accepts an upstream id from the edge proxy when present -
  //    but the header arrives from whoever sent the request, not necessarily
  //    from the proxy, and it is echoed into every log line and response. So
  //    it is constrained to the shape an id actually has; anything else is
  //    replaced rather than rejected, since a malformed correlation id is not
  //    worth failing a request over.
  app.use((req, res, next) => {
    const supplied = String(req.headers['x-request-id'] || '');
    req.id = /^[\w.-]{1,128}$/.test(supplied) ? supplied : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  // 2. Security headers. CSP is disabled here because this process serves an
  //    API, not HTML - the frontend container owns the page CSP.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      hsts: config.env.isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' }
    })
  );

  // 3. CORS before body parsing so a rejected preflight costs nothing.
  app.use(corsMiddleware);

  // 4. Parsing. The limit is deliberately low; file uploads go through the
  //    storage module's multipart route, not the JSON parser.
  app.use(express.json({ limit: config.http.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: config.http.bodyLimit }));
  app.use(cookieParser(config.cookie.secret));

  app.use(compression());

  // 5. Request logging. Health probes are excluded or they dominate the logs.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: {
        ignore: (req) => req.url === '/healthz' || req.url === '/readyz'
      },
      customLogLevel(req, res, err) {
        if (err || res.statusCode >= 500) return 'error';
        // An expired access token is the protocol working, not a problem: the
        // client refreshes and retries without the user noticing. Logging it
        // at `warn` put four of these an hour, per open session, in front of
        // the 401s that do mean something.
        if (isRoutineFailure(res)) return 'info';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },

      // `originalUrl`, not `url`. Express rewrites `req.url` to be relative to
      // the mount point while a router handles the request and only restores
      // it afterwards - and these run on `finish`, before the restore. Using
      // `req.url` logged the roles endpoint as `GET /?limit=200` instead of
      // `GET /api/v1/roles?limit=200`, which makes the log useless for working
      // out which endpoint was actually called.
      customSuccessMessage(req, res, responseTime) {
        return `${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${responseTime}ms`;
      },
      customErrorMessage(req, res, err) {
        return `${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${err.message}`;
      },

      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.originalUrl || req.url,
            ip: req.remoteAddress
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        }
      }
    })
  );

  // 6. Global rate limit. Endpoint-specific limits are layered on top by the
  //    modules that need them (login, password reset).
  //
  //    Built here rather than at module load: the Redis-backed store needs a
  //    live connection, and `apply()` is the first point after `cache.connect()`
  //    where that is guaranteed.
  initRateLimiters();
  app.use(globalRateLimiter);

  // 7. Request timeout so a stalled upstream cannot pin a worker forever.
  app.use((req, res, next) => {
    res.setTimeout(config.http.requestTimeoutMs, () => {
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: { code: 'REQUEST_TIMEOUT', message: 'The request took too long to process.' },
          requestId: req.id
        });
      }
    });
    next();
  });
}

module.exports = { apply };
