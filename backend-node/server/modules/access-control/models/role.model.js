'use strict';

/**
 * Role - a named bundle of grants.
 *
 * Roles are the unit administrators actually think in. Grants inside a role
 * reference the permission catalogue that modules declare, so a role can only
 * ever contain permissions that really exist.
 */

const mongoose = require('mongoose');
const { createSchema } = require('../../../core/db/base-schema');

const grantSchema = new mongoose.Schema(
  {
    resource: { type: String, required: true },
    actions: { type: [String], required: true, default: [] }
  },
  { _id: false }
);

const schema = createSchema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z][A-Z0-9_]{1,40}$/, 'code must be UPPER_SNAKE_CASE']
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    // Bypasses every grant check. Reserved for the break-glass role; the API
    // refuses to create a second one.
    isSuperAdmin: { type: Boolean, default: false },

    // System roles are created by seeds and cannot be renamed or deleted
    // through the API, so a deployment always retains a way back in.
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },

    grants: { type: [grantSchema], default: [] },

    // Roles this role inherits every grant from. Resolved at assignment time,
    // not at check time, to keep the hot path flat.
    inherits: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }], default: [] },

    // Optional guard: this role may only be granted within these scopes.
    allowedScopes: { type: [String], default: ['global'] },

    priority: { type: Number, default: 100 }
  },
  { collection: 'roles' }
);

schema.index({ code: 1 }, { unique: true });
schema.index({ isActive: 1, deletedAt: 1 });

/** Total grant count, shown in the roles list. */
schema.virtual('grantCount').get(function grantCount() {
  return (this.grants || []).reduce((total, grant) => total + (grant.actions || []).length, 0);
});

module.exports = mongoose.models.Role || mongoose.model('Role', schema);
