'use strict';

/**
 * AuditLog - append-only record of consequential actions.
 *
 * `strict: throw` plus the absence of any update path in the service layer is
 * what makes "append-only" more than a comment: application code has no way
 * to alter an entry once written.
 */

const mongoose = require('mongoose');
const { createSchema } = require('../../../core/db/base-schema');

const schema = createSchema(
  {
    // Dotted verb: `user.created`, `role.updated`, `auth.login`, `authz.denied`.
    action: { type: String, required: true, index: true },
    category: {
      type: String,
      enum: ['auth', 'security', 'data', 'configuration', 'system'],
      required: true,
      index: true
    },
    outcome: { type: String, enum: ['success', 'failure', 'denied'], default: 'success', index: true },

    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // Denormalised so the entry stays readable after the account is deleted.
    actorLabel: { type: String, default: 'system' },

    target: {
      type: { type: String, default: '' },
      id: { type: String, default: '' },
      label: { type: String, default: '' }
    },

    // Field-level before/after, produced by audit-service.diff.
    changes: { type: mongoose.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    context: {
      ip: { type: String, default: '' },
      userAgent: { type: String, default: '' },
      requestId: { type: String, default: '' },
      method: { type: String, default: '' },
      path: { type: String, default: '' }
    },

    occurredAt: { type: Date, default: Date.now, index: true }
  },
  { collection: 'auditlogs', softDelete: false, audit: false }
);

schema.index({ occurredAt: -1 });
schema.index({ actorId: 1, occurredAt: -1 });
schema.index({ 'target.type': 1, 'target.id': 1, occurredAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', schema);
