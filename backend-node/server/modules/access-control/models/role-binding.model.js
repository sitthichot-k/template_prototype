'use strict';

/**
 * RoleBinding - assigns a role to a user, optionally within a scope.
 *
 * Modelled as its own collection rather than an array on the user because a
 * binding carries its own facts: who granted it, why, and when it expires.
 * "Editor, but only for the Finance department, until the end of the quarter"
 * is a first-class record here.
 */

const mongoose = require('mongoose');
const { createSchema } = require('../../../core/db/base-schema');

const schema = createSchema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true, index: true },

    // 'global' means everywhere. Any other value names a dimension the child
    // project defines - department, branch, tenant - with scopeId pointing at
    // the record.
    scope: { type: String, default: 'global' },
    scopeId: { type: mongoose.Schema.Types.ObjectId, default: null },

    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    grantedAt: { type: Date, default: Date.now },
    reason: { type: String, default: '' },

    // Time-boxed access. A background job revokes bindings past this date.
    expiresAt: { type: Date, default: null }
  },
  { collection: 'rolebindings' }
);

schema.index({ userId: 1, roleId: 1, scope: 1, scopeId: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { sparse: true });

schema.virtual('isExpired').get(function isExpired() {
  return Boolean(this.expiresAt && this.expiresAt.getTime() < Date.now());
});

module.exports = mongoose.models.RoleBinding || mongoose.model('RoleBinding', schema);
