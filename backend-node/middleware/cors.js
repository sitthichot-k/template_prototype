'use strict';

/**
 * CORS policy.
 *
 * The allowlist is explicit and comes from CORS_ORIGINS. In preproduction and
 * production the frontend is served same-origin through nginx, so the list is
 * usually empty of browser origins and exists only for tooling; config/index.js
 * refuses to start production with an unset value rather than defaulting to
 * something permissive.
 */

const cors = require('cors');
const config = require('../config');
const logger = require('../config/logger').forModule('cors');

const options = {
  origin(origin, callback) {
    // Same-origin, server-to-server and curl requests send no Origin header.
    if (!origin) return callback(null, true);

    if (config.http.corsOrigins.includes(origin)) return callback(null, true);

    // Local development accepts any loopback origin so a developer can run the
    // frontend on whichever port Vite picks.
    if (config.env.isLocal && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    logger.warn({ origin }, 'Blocked by CORS policy');
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Device-Id'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 600
};

module.exports = cors(options);
module.exports.options = options;
