'use strict';

/**
 * Setting - one stored override.
 *
 * Only overrides are stored. A setting left at its declared default has no
 * row here at all, which keeps the collection small and makes "what has
 * actually been changed in this deployment" a single query.
 *
 * The descriptor (type, label, constraints, permission) lives in the module
 * manifest, not here - see core/settings/setting-descriptor.js.
 */

const mongoose = require('mongoose');
const { createSchema } = require('../../../core/db/base-schema');

const schema = createSchema(
  {
    key: { type: String, required: true, trim: true, index: true },

    // Where the override applies. Resolution runs user -> organization ->
    // global -> descriptor default.
    scope: { type: String, enum: ['global', 'organization', 'user'], default: 'global' },
    scopeId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // Mixed because a setting's type is declared by its descriptor, not here.
    // Validation happens on write against that descriptor.
    value: { type: mongoose.Schema.Types.Mixed, default: null },

    // Mirrors the descriptor so a reader knows the stored value is ciphertext
    // without having to resolve the descriptor first.
    isSecret: { type: Boolean, default: false },
    type: { type: String, default: 'string' },
    group: { type: String, default: '', index: true }
  },
  { collection: 'settings', softDelete: false }
);

schema.index({ key: 1, scope: 1, scopeId: 1 }, { unique: true });

module.exports = mongoose.models.Setting || mongoose.model('Setting', schema);
