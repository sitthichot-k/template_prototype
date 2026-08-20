'use strict';

/**
 * Permission catalogue.
 *
 * This collection is a projection of the module manifests, not a source of
 * truth: `sync-permissions` rewrites it on every boot. It exists so the admin
 * UI can browse and search permissions, and so a role's grants can be
 * validated against something queryable.
 *
 * Editing a row here has no effect on authorization - change the module
 * manifest instead.
 */

const mongoose = require('mongoose');
const { createSchema } = require('../../../core/db/base-schema');

const schema = createSchema(
  {
    resource: { type: String, required: true, trim: true },
    label: { type: String, required: true },
    description: { type: String, default: '' },
    group: { type: String, required: true, index: true },
    actions: { type: [String], required: true, default: [] },

    // Flagged in the UI so an administrator granting it is warned, e.g.
    // permanent delete or permission management itself.
    dangerous: { type: Boolean, default: false },

    // Which module(s) declared it. Used to show what breaks if a module is
    // disabled, and to prune rows for modules that no longer exist.
    contributedBy: { type: [String], default: [] },

    // Bumped by each sync; rows carrying an older value are stale and removed.
    syncVersion: { type: Number, default: 0 }
  },
  { collection: 'permissions', softDelete: false, audit: false }
);

schema.index({ resource: 1 }, { unique: true });
schema.index({ group: 1, resource: 1 });

module.exports = mongoose.models.Permission || mongoose.model('Permission', schema);
