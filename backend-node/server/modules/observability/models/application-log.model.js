'use strict';

/**
 * ApplicationLog - the operational log the UI can read.
 *
 * Deliberately separate from AuditLog. They answer different questions and
 * mixing them ruins both:
 *
 *   AuditLog       "who changed this record, and what did it look like before"
 *                  Low volume, compliance-relevant, kept for a year.
 *   ApplicationLog "what has the system been doing, and what went wrong"
 *                  High volume (a row per request), useful for days.
 *
 * Putting request traffic in the audit trail would bury the twenty entries a
 * year-end review actually needs under a million routine GETs, and forcing
 * audit retention onto request logs would cost a great deal of storage for
 * data nobody reads after a week.
 *
 * Retention is a TTL index rather than a scheduled job: Mongo expires the
 * documents itself, so it keeps working even when the process is down and
 * needs no scheduler to exist.
 *
 * ---------------------------------------------------------------------------
 * There is no `debug` level here, and that is not an omission.
 * ---------------------------------------------------------------------------
 * This collection is also separate from the *process* log - the pino stream on
 * stdout that the container shows, whose verbosity is `LOG_LEVEL` per tier
 * (debug locally, warn in production). Debug output is developer detail: high
 * volume, valuable while you are watching it, worthless a day later. It
 * belongs in the stream a developer is tailing, not in a collection every
 * request writes to and an administrator reads through a UI.
 *
 * `debug` used to sit in this enum and in the viewer's filter regardless, so
 * the screen offered a level nothing could ever produce - a tile pinned at
 * zero and a filter that always returned "Nothing was logged in this window",
 * next to a container log visibly full of DEBUG lines. The two are different
 * systems; the levels now say so.
 */

const mongoose = require('mongoose');
const { createSchema } = require('../../../core/db/base-schema');

const LEVELS = ['info', 'warn', 'error'];

const schema = createSchema(
  {
    level: { type: String, enum: LEVELS, default: 'info', index: true },

    // Dotted verb: `api.request`, `auth.login.failed`, `job.retention.run`.
    action: { type: String, required: true, index: true },
    message: { type: String, default: '' },

    // Which module emitted it, so one noisy subsystem can be filtered out.
    source: { type: String, default: '', index: true },

    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // Denormalised so the line stays readable after the account is gone.
    actorLabel: { type: String, default: '' },

    context: {
      requestId: { type: String, default: '' },
      ip: { type: String, default: '' },
      userAgent: { type: String, default: '' },
      method: { type: String, default: '' },
      path: { type: String, default: '' },
      statusCode: { type: Number, default: null },
      durationMs: { type: Number, default: null }
    },

    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Deliberately NOT `index: true`. That builds `{ occurredAt: 1 }`, which is
    // the exact key the TTL index needs - and Mongo rejects a second index on
    // the same key with different options (IndexOptionsConflict), so retention
    // silently failed to install. The ascending index is owned by
    // `ensureRetentionIndex`; sorting is served by the descending one below.
    occurredAt: { type: Date, default: Date.now }
  },
  { collection: 'applicationlogs', softDelete: false, audit: false }
);

// The list screen sorts newest-first and filters by level; these two cover it.
schema.index({ occurredAt: -1 });
schema.index({ level: 1, occurredAt: -1 });
// Every performance aggregate matches on action + a time window.
schema.index({ action: 1, occurredAt: -1 });

const ApplicationLog = mongoose.models.ApplicationLog || mongoose.model('ApplicationLog', schema);

module.exports = ApplicationLog;
module.exports.LEVELS = LEVELS;
