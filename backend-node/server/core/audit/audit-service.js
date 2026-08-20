'use strict';

/**
 * Append-only audit trail.
 *
 * Records who did what, to which record, from where, and whether it
 * succeeded. Two rules shape the design:
 *
 *   1. Writing an audit entry must never fail the operation it describes.
 *      A failed write is logged loudly, but the user's action still lands.
 *   2. Entries are never updated or deleted by application code. Retention is
 *      enforced by a TTL policy the compliance settings own.
 */

const mongoose = require('mongoose');
const logger = require('../../../config/logger').forModule('audit');

/** Values that must never be written into an audit payload. */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'secret',
  'apikey',
  'authorization'
]);

function sanitize(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[redacted]' : sanitize(item, depth + 1);
  }
  return out;
}

/**
 * Computes a minimal before/after diff so an audit entry stays readable and
 * does not duplicate the whole record on every edit.
 */
function diff(before, after) {
  const changes = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const from = before ? before[key] : undefined;
    const to = after ? after[key] : undefined;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[key] = { from: sanitize(from), to: sanitize(to) };
  }
  return changes;
}

/**
 * Describes the request an action arrived on, for the audit `context`.
 *
 * Tolerant of a partial request object: callers outside Express - a job runner
 * replaying work, a test - may pass something request-shaped rather than a
 * real one, and losing the whole entry over a missing header would defeat the
 * purpose of recording it.
 */
function describeRequest(req) {
  const headers = req.headers || {};
  return {
    ip: req.ip || '',
    userAgent: String(headers['user-agent'] || '').slice(0, 300),
    requestId: req.id || '',
    method: req.method || '',
    path: req.originalUrl || ''
  };
}

/**
 * @param {object} entry
 * @param {string} entry.action     Dotted verb, e.g. `user.created`, `auth.login`.
 * @param {string} entry.category   security | data | configuration | auth | system
 * @param {'success'|'failure'|'denied'} [entry.outcome='success']
 * @param {string} [entry.actorId]
 * @param {{type: string, id: string, label?: string}} [entry.target]
 * @param {object} [entry.metadata]
 * @param {object} [entry.changes]  Output of `diff`.
 * @param {import('express').Request} [entry.req]  Source of ip/userAgent/requestId.
 */
async function record(entry) {
  try {
    const AuditLog = mongoose.model('AuditLog');
    const req = entry.req;

    // `target` and `context` are nested paths in the schema, not subdocuments.
    // Mongoose rejects a primitive assigned to one - `null` included - with
    // ObjectExpectedError, so the key is omitted instead and the schema's own
    // defaults describe "no target" and "no request". Every caller outside a
    // request cycle depends on this: a seed, a migration or a scheduled job
    // has no `req`, and because this function swallows its own failures, the
    // entries they wrote were being lost without a trace.
    const document = {
      action: entry.action,
      category: entry.category || 'data',
      outcome: entry.outcome || 'success',
      actorId: entry.actorId || (req && req.auth && req.auth.userId) || null,
      actorLabel: entry.actorLabel || (req && req.auth && req.auth.email) || 'system',
      metadata: sanitize(entry.metadata || {}),
      changes: entry.changes || null,
      occurredAt: new Date()
    };

    if (entry.target) document.target = entry.target;
    if (req) document.context = describeRequest(req);

    await AuditLog.create(document);
  } catch (error) {
    // Never propagate: losing an audit line is bad, losing the user's work
    // because of it is worse. The error itself is still captured in the logs.
    logger.error({ err: error, action: entry.action }, 'Failed to write audit entry');
  }
}

/**
 * Convenience wrapper for the common "record changed" case.
 *
 * @example
 *   await auditService.recordChange({
 *     action: 'role.updated', category: 'security',
 *     target: { type: 'role', id: role.id, label: role.code },
 *     before, after, req
 *   });
 */
async function recordChange({ action, category, target, before, after, req, metadata }) {
  const changes = diff(sanitize(before), sanitize(after));
  if (!Object.keys(changes).length) return;
  await record({ action, category, target, changes, metadata, req });
}

module.exports = { record, recordChange, diff, sanitize, describeRequest };
