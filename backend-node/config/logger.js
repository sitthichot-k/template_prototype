'use strict';

/**
 * Structured logger.
 *
 * Redaction is configured here rather than at each call site: a field listed
 * below can never be logged by accident, no matter which module writes the
 * log line. Add project-specific paths through LOG_REDACT_EXTRA instead of
 * editing this list, so the baseline stays comparable across child projects.
 */

const pino = require('pino');
const config = require('./index');

const BASE_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.confirmPassword',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.clientSecret',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'refreshToken',
  'refreshTokenHash',
  'accessToken',
  'clientSecret',
  'secret',
  '*.password',
  '*.passwordHash',
  '*.secret',
  '*.token'
];

/**
 * Pretty output is for a human reading a terminal, so it drops everything the
 * message line already says. The full object - base bindings, the serialised
 * req/res, timings - is still emitted in JSON mode, which is what a log
 * aggregator consumes.
 *
 * Without this, one HTTP request printed a twelve-line block repeating the app
 * name, environment and version on every line, and a real error scrolled past
 * before you could see it.
 */
const transport = config.observability.logPretty
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        singleLine: true,
        // `module` is ignored as a field because messageFormat already prints
        // it as a prefix; without this every module line says it twice.
        ignore: 'pid,hostname,app,env,version,module,req,res,responseTime',
        messageFormat: '{if module}[{module}] {end}{msg}'
      }
    }
  : undefined;

const logger = pino({
  level: config.observability.logLevel,
  base: {
    app: config.project.code,
    env: config.env.appEnv,
    version: config.project.version
  },
  redact: {
    paths: BASE_REDACT_PATHS.concat(config.observability.logRedactExtra),
    censor: '[redacted]'
  },
  formatters: {
    level(label) {
      return { level: label };
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport
});

/**
 * Returns a child logger tagged with its origin, so every line can be traced
 * back to the module that produced it.
 *
 * @param {string} name
 * @param {object} [bindings]
 */
logger.forModule = function forModule(name, bindings) {
  return logger.child(Object.assign({ module: name }, bindings || {}));
};

module.exports = logger;
