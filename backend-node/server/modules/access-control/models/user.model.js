'use strict';

/**
 * User - the platform's own record of a person.
 *
 * Holds identity linkage, lifecycle state and the exception grants that sit
 * on top of roles. It deliberately does NOT hold the effective permission
 * set: that is derived (see core/security/permission-resolver) so there is
 * exactly one place the answer comes from.
 */

const mongoose = require('mongoose');
const { createSchema } = require('../../../core/db/base-schema');

const grantSchema = new mongoose.Schema(
  {
    resource: { type: String, required: true },
    actions: { type: [String], required: true, default: [] },
    reason: { type: String, default: '' },
    expiresAt: { type: Date, default: null }
  },
  { _id: false }
);

/** Link to an account at an external identity provider. */
const identitySchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    subject: { type: String, required: true },
    email: { type: String, default: '' },
    linkedAt: { type: Date, default: Date.now },
    lastLoginAt: { type: Date, default: null }
  },
  { _id: false }
);

const schema = createSchema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },
    username: { type: String, trim: true, default: null },
    displayName: { type: String, required: true, trim: true },

    // `select: false` so the hash is never returned by an ordinary query -
    // callers that genuinely need it must ask for it explicitly.
    passwordHash: { type: String, default: null, select: false },
    passwordChangedAt: { type: Date, default: null },
    passwordHistory: { type: [String], default: [], select: false },
    mustChangePassword: { type: Boolean, default: false },

    identities: { type: [identitySchema], default: [] },

    status: {
      type: String,
      enum: ['pending', 'active', 'suspended', 'disabled'],
      default: 'pending',
      index: true
    },

    // Bumped on any change to this user's effective access. The value is
    // embedded in issued access tokens, so incrementing it invalidates every
    // outstanding token for this user at once.
    permissionVersion: { type: Number, default: 0 },

    directGrants: { type: [grantSchema], default: [] },
    directDenies: { type: [grantSchema], default: [] },

    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: '' },

    // Reserved for multi-factor authentication, which is NOT implemented: no
    // enrolment endpoint exists and `login()` never asks for a second factor,
    // so `enabled` is always false and nothing consults it. Kept as the shape
    // enrolment will fill - do not build a check on it until the verification
    // step exists, or the check will pass for everyone.
    mfa: {
      enabled: { type: Boolean, default: false },
      method: { type: String, enum: ['none', 'totp', 'email'], default: 'none' },
      secret: { type: String, default: null, select: false },
      verifiedAt: { type: Date, default: null }
    },

    profile: {
      avatarUrl: { type: String, default: '' },
      phone: { type: String, default: '' },
      locale: { type: String, default: 'th' },
      timezone: { type: String, default: 'Asia/Bangkok' },
      department: { type: String, default: '' },
      position: { type: String, default: '' }
    },

    // Extension point: a child project adds its own fields here rather than
    // forking the schema, which keeps template upgrades mergeable.
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  {
    collection: 'users',
    hidden: ['passwordHash', 'passwordHistory', 'mfa.secret']
  }
);

schema.index({ email: 1 }, { unique: true });
// Partial, not sparse. A sparse index only skips documents where the key is
// absent, and `username` defaults to null - so every user without one shared
// the same indexed value and the second such account was rejected as a
// duplicate. Restricting the index to actual strings is the correct form.
schema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } } }
);
schema.index({ 'identities.provider': 1, 'identities.subject': 1 });
schema.index({ status: 1, deletedAt: 1 });

schema.virtual('isLocked').get(function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
});

/** Call after any change that affects this user's access. */
schema.methods.bumpPermissionVersion = function bumpPermissionVersion() {
  this.permissionVersion = (this.permissionVersion || 0) + 1;
  return this;
};

module.exports = mongoose.models.User || mongoose.model('User', schema);
