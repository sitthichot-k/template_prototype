'use strict';

/**
 * Persists one application-log row per API request.
 *
 * This is what turns "the log viewer" into something worth opening: without
 * it the screen only ever shows what modules chose to write by hand, and the
 * performance panel has nothing to aggregate.
 *
 * Three things are deliberate:
 *
 *   1. It runs on `finish`, so the status code, the duration and `req.auth`
 *      (populated by whichever route authenticated) are all final.
 *   2. Writes are not awaited. A log row must never add latency to, or fail,
 *      the request it describes.
 *   3. What it records is settings-driven and read per request, so an operator
 *      can turn traffic logging off - or down to errors only - on a system
 *      that is drowning, without a deploy.
 */

const settingsService = require('../../../core/settings/settings-service');
const stdoutLogger = require('../../../../config/logger').forModule('observability');
const logService = require('../services/log.service');
const { isRoutineFailure } = require('../../../core/http/error-handler');

/** Paths that would otherwise dominate the collection with no information. */
const DEFAULT_SKIP = ['/healthz', '/readyz', '/metrics', '/docs'];

/**
 * @param {number} statusCode
 * @param {import('express').Response} res  Carries the error code, if any.
 */
function levelFor(statusCode, res) {
  if (statusCode >= 500) return 'error';

  // A routine 401 - an expired access token, or permissions that changed under
  // a live session - is recorded, but not as a problem. At `warn` it would be
  // matched by the "Problems only" recording mode and by the log viewer's
  // problem filter, and counted in the dashboard's error rate: an application
  // behaving exactly as designed would read as one in trouble.
  if (isRoutineFailure(res)) return 'info';

  if (statusCode >= 400) return 'warn';
  return 'info';
}

/**
 * @param {string} mode  'all' | 'errors' | 'off'
 * @param {string} level
 */
function shouldRecord(mode, level) {
  if (mode === 'off') return false;
  if (mode === 'errors') return level === 'warn' || level === 'error';
  return true;
}

function requestLog(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    // Fire-and-forget by design; `record` swallows its own failures and this
    // catch is the backstop for anything thrown before it.
    persist(req, res, startedAt).catch((error) => {
      stdoutLogger.error({ err: error }, 'Request log failed');
    });
  });

  next();
}

async function persist(req, res, startedAt) {
  const path = req.originalUrl || req.url;
  if (DEFAULT_SKIP.some((skip) => path.startsWith(skip))) return;

  // A CORS preflight is a browser mechanic, not a user action.
  if (req.method === 'OPTIONS') return;

  const level = levelFor(res.statusCode, res);

  // Read live rather than cached at boot: the point of the switch is to be
  // usable during an incident.
  const mode = (await settingsService.get('observability.requestLogging')) || 'all';
  if (!shouldRecord(mode, level)) return;

  const durationMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);

  await logService.record({
    level,
    action: 'api.request',
    source: 'http',
    message: `${req.method} ${path} → ${res.statusCode}`,
    req,
    context: {
      statusCode: res.statusCode,
      durationMs
    }
  });
}

module.exports = { requestLog, DEFAULT_SKIP };
