'use strict';

/**
 * Policy - the attribute-based layer above roles.
 *
 * Roles answer "what may this person do". Policies answer "under what
 * circumstances", which is where rules like "no exports outside office hours"
 * or "admin actions only from the office network" belong. Expressing those as
 * roles would multiply the role list beyond anyone's ability to review it.
 *
 * Conditions use the small fixed operator set implemented in
 * core/security/permission-resolver - deliberately not a scripting language.
 */

const mongoose = require('mongoose');
const { createSchema } = require('../../../core/db/base-schema');

const schema = createSchema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    effect: { type: String, enum: ['allow', 'deny'], required: true },

    // Role codes this policy applies to. Empty means every user.
    subjects: { type: [String], default: [] },

    // Resource paths, supporting a trailing wildcard: '/security/*'.
    resources: { type: [String], required: true, default: [] },
    // Actions, or ['*'] for all.
    actions: { type: [String], required: true, default: [] },

    /**
     * Condition map evaluated against the request context.
     *
     * The context is assembled in `core/security/authorize.js` and contains
     * exactly these fields - a condition on anything else reads `undefined`
     * and silently never matches:
     *
     *   user.id, user.roles
     *   request.ip, request.method, request.path, request.at
     *
     * Operators are the fixed set in `core/security/permission-resolver`:
     * eq, ne, in, nin, gt, gte, lt, lte, exists. They compare values exactly.
     * `in` is array membership, **not** CIDR or pattern matching, so an IP
     * rule must list addresses literally.
     *
     * At least one condition is required; see the validator for why.
     *
     * @example
     *   // Only from these exact addresses.
     *   { 'request.ip': { nin: ['203.0.113.10', '203.0.113.11'] } }
     *
     *   // A date window. ISO-8601 UTC strings compare chronologically as
     *   // text, and `request.at` is always produced by toISOString().
     *   { 'request.at': { gte: '2026-12-24T00:00:00.000Z', lte: '2027-01-02T23:59:59.999Z' } }
     *
     * To match on a role, use `subjects` rather than a condition on
     * `user.roles`: the operators compare scalars, and `user.roles` is an
     * array.
     */
    conditions: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Higher priority is evaluated first; the first matching policy decides.
    priority: { type: Number, default: 100 },
    isActive: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false }
  },
  { collection: 'policies' }
);

schema.index({ isActive: 1, priority: -1 });

module.exports = mongoose.models.Policy || mongoose.model('Policy', schema);
