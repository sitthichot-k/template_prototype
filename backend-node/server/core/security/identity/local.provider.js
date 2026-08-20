'use strict';

/**
 * Local credentials provider - email/username plus password verified against
 * the platform's own user records.
 *
 * Handles lockout and the timing side channel. Both matter: without lockout,
 * a password is only as strong as the attacker's patience, and without the
 * dummy verification below, response time reveals whether an account exists.
 */

const mongoose = require('mongoose');
const config = require('../../../../config');
const AppError = require('../../errors/AppError');
const crypto = require('../crypto');
const settingsService = require('../../settings/settings-service');

// Verified against when no account matches, so a miss costs the same time as
// a hit. Argon2 hash of a random string generated at module load.
const DUMMY_HASH_PROMISE = crypto.hashPassword(crypto.randomToken(16));

module.exports = {
  id: 'local',
  name: 'Email and password',
  kind: 'credentials',

  isConfigured() {
    return true;
  },

  /**
   * @param {{identifier: string, password: string}} credentials
   * @returns {Promise<{provider: string, subject: string, email: string,
   *                    displayName: string, attributes: object, verified: boolean}>}
   */
  async authenticate(credentials) {
    const identifier = String(credentials.identifier || '').trim().toLowerCase();
    const password = String(credentials.password || '');

    if (!identifier || !password) {
      throw AppError.unauthenticated('Invalid credentials.', 'INVALID_CREDENTIALS');
    }

    const User = mongoose.model('User');
    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }],
      deletedAt: null
    }).select('+passwordHash email username displayName status failedLoginAttempts lockedUntil');

    if (!user) {
      await crypto.verifyPassword(await DUMMY_HASH_PROMISE, password);
      throw AppError.unauthenticated('Invalid credentials.', 'INVALID_CREDENTIALS');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppError({
        status: 423,
        code: 'ACCOUNT_LOCKED',
        message: 'This account is temporarily locked. Try again later.'
      });
    }

    const valid = await crypto.verifyPassword(user.passwordHash, password);

    if (!valid) {
      // Thresholds come from the settings screen so they can be tightened
      // without a redeploy, falling back to the environment values. They used
      // to read `config` only, which left the two lockout controls in the UI
      // decorative - an operator could set "3 attempts" and still get five.
      const [maxAttempts, lockoutMinutes] = await Promise.all([
        settingsService.getOr('security.login.maxAttempts', config.auth.password.maxLoginAttempts),
        settingsService.getOr('security.login.lockoutMinutes', config.auth.password.lockoutMinutes)
      ]);

      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= maxAttempts) {
        user.lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
        user.failedLoginAttempts = 0;
      }
      await user.save();
      throw AppError.unauthenticated('Invalid credentials.', 'INVALID_CREDENTIALS');
    }

    // Transparently upgrade a hash produced under older parameters.
    if (crypto.needsRehash(user.passwordHash)) {
      user.passwordHash = await crypto.hashPassword(password);
    }
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await user.save();

    return {
      provider: 'local',
      subject: String(user._id),
      email: user.email,
      displayName: user.displayName,
      attributes: {},
      verified: true
    };
  }
};
