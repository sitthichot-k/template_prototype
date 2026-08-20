'use strict';

/**
 * Session - one authenticated device.
 *
 * The refresh token is stored only as a SHA-256 hash. Retired hashes are kept
 * so theft is detectable: presenting a token that was already rotated means
 * two parties hold it, so the whole family is revoked rather than the single
 * token.
 */

const mongoose = require('mongoose');
const { createSchema } = require('../../../core/db/base-schema');

const schema = createSchema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    refreshTokenHash: { type: String, default: null, select: false },
    // Identifies the chain of rotations that began at one login.
    familyId: { type: String, required: true, index: true },

    // The hash retired by the most recent rotation. Superseded by
    // `retiredTokenHashes` and kept only so sessions issued before that field
    // existed still detect one generation of reuse.
    rotatedFrom: { type: String, default: null },

    /**
     * Hashes this session has rotated away from, newest first.
     *
     * `rotatedFrom` alone was a single slot, overwritten on every refresh, so
     * only the immediately previous token was ever recognised. A token stolen
     * and then used after the victim had refreshed twice matched nothing, was
     * rejected as merely invalid, and the family was never revoked - which is
     * precisely the case the mechanism exists to catch.
     *
     * Bounded, because an unbounded list is a write-amplification bug waiting
     * on a long-lived session. Beyond the window a replayed token is still
     * refused; it just is not escalated to revoking the family.
     */
    retiredTokenHashes: { type: [String], default: [], select: false, index: true },
    rotationCount: { type: Number, default: 0 },

    provider: { type: String, default: 'local' },

    device: {
      id: { type: String, default: '' },
      userAgent: { type: String, default: '' },
      ip: { type: String, default: '' },
      platform: { type: String, default: '' }
    },

    issuedAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },

    revokedAt: { type: Date, default: null },
    revokedReason: {
      type: String,
      enum: ['logout', 'rotation', 'admin', 'expired', 'reuse-detected', 'password-changed', null],
      default: null
    }
  },
  { collection: 'sessions', softDelete: false, hidden: ['refreshTokenHash'] }
);

schema.index({ refreshTokenHash: 1 }, { unique: true, sparse: true });
// Mongo removes the document once expiresAt passes, so revoked and stale
// sessions do not accumulate.
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ userId: 1, revokedAt: 1 });

schema.virtual('isActive').get(function isActive() {
  return !this.revokedAt && this.expiresAt.getTime() > Date.now();
});

module.exports = mongoose.models.Session || mongoose.model('Session', schema);
