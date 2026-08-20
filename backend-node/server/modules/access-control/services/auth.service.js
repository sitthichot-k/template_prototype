'use strict';

/**
 * Authentication flows: login, refresh, logout.
 *
 * The provider decides *who* the person is; everything after that - mapping
 * the assertion onto a platform user, creating the session, issuing tokens -
 * is the same regardless of provider. That is what keeps adding SSO to a
 * child project a configuration change rather than a rewrite.
 */

const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const config = require('../../../../config');
const AppError = require('../../../core/errors/AppError');
const tokens = require('../../../core/security/tokens');
const cryptoUtil = require('../../../core/security/crypto');
const identity = require('../../../core/security/identity');
const permissionResolver = require('../../../core/security/permission-resolver');
const settingsService = require('../../../core/settings/settings-service');
const auditService = require('../../../core/audit/audit-service');
const logger = require('../../../../config/logger').forModule('auth-service');

/**
 * How many rotated-away token hashes a session remembers.
 *
 * The window in which a stolen refresh token is recognised as stolen rather
 * than merely invalid. Fifty rotations is several hours of an active client at
 * a fifteen-minute access-token TTL; past that a replay is still rejected, but
 * silently, without revoking the family.
 */
const RETIRED_TOKEN_HISTORY = 50;

/**
 * Authenticates and opens a session.
 *
 * @param {object} params
 * @param {string} params.provider
 * @param {object} params.credentials
 * @param {import('express').Request} params.req
 */
async function login({ provider = 'local', credentials, req }) {
  const adapter = identity.get(provider);
  const assertion = await adapter.authenticate(credentials, { req });

  const user = await resolveUser(assertion);

  if (user.status === 'suspended' || user.status === 'disabled') {
    await auditService.record({
      action: 'auth.login',
      category: 'auth',
      outcome: 'denied',
      actorId: String(user._id),
      metadata: { provider, reason: user.status },
      req
    });
    throw AppError.forbidden('This account is not active.');
  }
  if (user.status === 'pending') {
    throw AppError.forbidden('This account has not been activated yet.');
  }

  await assertMaintenanceAllows(user, { provider, req });

  const session = await createSession({ user, provider, req });
  const roles = await loadRoleCodes(user._id);

  const accessToken = tokens.issueAccessToken({
    userId: user._id,
    sessionId: session._id,
    roles,
    permissionVersion: user.permissionVersion || 0
  });

  await mongoose.model('User').updateOne(
    { _id: user._id },
    { $set: { lastLoginAt: new Date(), lastLoginIp: req.ip, failedLoginAttempts: 0, lockedUntil: null } }
  );

  await auditService.record({
    action: 'auth.login',
    category: 'auth',
    outcome: 'success',
    actorId: String(user._id),
    actorLabel: user.email,
    metadata: { provider, sessionId: String(session._id) },
    req
  });

  return {
    accessToken,
    refreshToken: session.__plainRefreshToken,
    expiresIn: config.auth.accessTokenTtl,
    user: publicUser(user, roles)
  };
}

/**
 * Enforces maintenance mode at the door.
 *
 * `general.maintenanceMode` is labelled "Blocks every non-administrator from
 * signing in", and it did no such thing: the only readers were `/platform/info`
 * and a banner component, so switching it on painted a stripe across the top
 * of the screen and let everyone in exactly as before. An operator taking the
 * system down for a migration had no reason to doubt it.
 *
 * "Administrator" is defined as whoever may edit `/settings/general` - the
 * people who can turn maintenance mode back off. Any narrower rule risks a
 * deployment where the switch is on and nobody who can reach the switch can
 * sign in.
 */
async function assertMaintenanceAllows(user, { provider, req }) {
  const enabled = await settingsService.getOr('general.maintenanceMode', false);
  if (!enabled) return;

  const permissionMap = await permissionResolver.getPermissionMap(
    String(user._id),
    user.permissionVersion || 0
  );
  const decision = await permissionResolver.can({
    permissionMap,
    resource: '/settings/general',
    action: 'edit'
  });
  if (decision.allowed) return;

  await auditService.record({
    action: 'auth.login',
    category: 'auth',
    outcome: 'denied',
    actorId: String(user._id),
    actorLabel: user.email,
    metadata: { provider, reason: 'maintenance-mode' },
    req
  });

  const message = await settingsService.getOr(
    'general.maintenanceMessage',
    'The system is under maintenance. Please try again later.'
  );
  throw new AppError({ status: 503, code: 'MAINTENANCE_MODE', message });
}

/**
 * Maps an identity assertion onto a platform user.
 *
 * External providers never create accounts implicitly: a person must already
 * exist and be linkable by email. Auto-provisioning would let anyone with an
 * account at the identity provider into the application, which is almost
 * never what an enterprise deployment wants.
 */
async function resolveUser(assertion) {
  const User = mongoose.model('User');

  if (assertion.provider === 'local') {
    const user = await User.findById(assertion.subject);
    if (!user) throw AppError.unauthenticated('Invalid credentials.', 'INVALID_CREDENTIALS');
    return user;
  }

  const linked = await User.findOne({
    'identities.provider': assertion.provider,
    'identities.subject': assertion.subject,
    deletedAt: null
  });
  if (linked) {
    await User.updateOne(
      { _id: linked._id, 'identities.subject': assertion.subject },
      { $set: { 'identities.$.lastLoginAt': new Date() } }
    );
    return linked;
  }

  if (!assertion.email) {
    throw AppError.unauthenticated('The identity provider returned no email address.', 'IDENTITY_UNLINKED');
  }

  const byEmail = await User.findOne({ email: assertion.email.toLowerCase(), deletedAt: null });
  if (!byEmail) {
    logger.warn({ provider: assertion.provider, email: assertion.email }, 'Login for an unprovisioned account');
    throw AppError.forbidden('No account exists for this identity. Contact an administrator.');
  }

  // First successful SSO login links the external identity to the account.
  byEmail.identities.push({
    provider: assertion.provider,
    subject: assertion.subject,
    email: assertion.email,
    linkedAt: new Date(),
    lastLoginAt: new Date()
  });
  await byEmail.save();

  return byEmail;
}

async function createSession({ user, provider, req }) {
  const Session = mongoose.model('Session');
  const { token, tokenHash, expiresAt } = tokens.issueRefreshToken();

  const session = await Session.create({
    userId: user._id,
    refreshTokenHash: tokenHash,
    familyId: randomUUID(),
    provider,
    device: {
      id: String(req.headers['x-device-id'] || ''),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      ip: req.ip,
      platform: ''
    },
    expiresAt
  });

  // Returned once, never persisted in plaintext.
  session.__plainRefreshToken = token;
  return session;
}

/**
 * Rotates a refresh token.
 *
 * Reuse detection: the presented token must match the session's *current*
 * hash. A token that was already rotated means two parties hold it, so the
 * entire family is revoked and the user must sign in again.
 */
async function refresh({ refreshToken, req }) {
  if (!refreshToken) throw AppError.unauthenticated('Missing refresh token.', 'REFRESH_MISSING');

  const Session = mongoose.model('Session');
  const presentedHash = cryptoUtil.hashToken(refreshToken);

  // `retiredTokenHashes` is `select: false`, so it must be asked for by name -
  // without it the document loads with the field undefined and saving would
  // replace the whole history with the single hash retired by this rotation.
  const session = await Session.findOne({ refreshTokenHash: presentedHash }).select(
    '+refreshTokenHash +retiredTokenHashes'
  );

  if (!session) {
    // Either a forged token or one already rotated away. If it belonged to a
    // known family, that family is compromised.
    //
    // Both fields are searched: `retiredTokenHashes` holds the full retained
    // history, `rotatedFrom` covers sessions issued before that field existed.
    const rotated = await Session.findOne({
      $or: [{ retiredTokenHashes: presentedHash }, { rotatedFrom: presentedHash }]
    }).select('familyId userId');
    if (rotated) {
      await revokeFamily(rotated.familyId, 'reuse-detected');
      await auditService.record({
        action: 'auth.refresh.reuse-detected',
        category: 'security',
        outcome: 'denied',
        actorId: String(rotated.userId),
        metadata: { familyId: rotated.familyId },
        req
      });
    }
    throw AppError.unauthenticated('Invalid refresh token.', 'REFRESH_INVALID');
  }

  if (session.revokedAt) {
    await revokeFamily(session.familyId, 'reuse-detected');
    throw AppError.unauthenticated('Session was revoked.', 'SESSION_REVOKED');
  }
  if (session.expiresAt.getTime() < Date.now()) {
    throw AppError.unauthenticated('Session expired.', 'SESSION_EXPIRED');
  }

  // Settings-driven, with the environment value as the fallback: the "Idle
  // timeout" control on the settings screen previously changed nothing.
  const idleTimeoutMinutes = await settingsService.getOr(
    'security.session.idleTimeoutMinutes',
    config.auth.session.idleTimeoutMinutes
  );
  const idleLimitMs = idleTimeoutMinutes * 60 * 1000;
  if (session.lastSeenAt && Date.now() - session.lastSeenAt.getTime() > idleLimitMs) {
    await revokeSession(session._id, 'expired');
    throw AppError.unauthenticated('Session timed out through inactivity.', 'SESSION_IDLE_TIMEOUT');
  }

  const User = mongoose.model('User');
  const user = await User.findOne({ _id: session.userId, deletedAt: null });
  if (!user || user.status !== 'active') {
    await revokeSession(session._id, 'admin');
    throw AppError.unauthenticated('Account is not active.', 'ACCOUNT_INACTIVE');
  }

  const next = tokens.issueRefreshToken();
  session.rotatedFrom = presentedHash;
  session.retiredTokenHashes = [presentedHash]
    .concat(session.retiredTokenHashes || [])
    .slice(0, RETIRED_TOKEN_HISTORY);
  session.refreshTokenHash = next.tokenHash;
  session.rotationCount += 1;
  session.expiresAt = next.expiresAt;
  session.lastSeenAt = new Date();
  await session.save();

  const roles = await loadRoleCodes(user._id);

  return {
    accessToken: tokens.issueAccessToken({
      userId: user._id,
      sessionId: session._id,
      roles,
      permissionVersion: user.permissionVersion || 0
    }),
    refreshToken: next.token,
    expiresIn: config.auth.accessTokenTtl,
    user: publicUser(user, roles)
  };
}

async function logout({ sessionId, req }) {
  await revokeSession(sessionId, 'logout');
  await auditService.record({
    action: 'auth.logout',
    category: 'auth',
    actorId: req.auth && req.auth.userId,
    metadata: { sessionId: String(sessionId) },
    req
  });
}

async function revokeSession(sessionId, reason) {
  await mongoose
    .model('Session')
    .updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

async function revokeFamily(familyId, reason) {
  await mongoose
    .model('Session')
    .updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

/** Signs the user out of every device. Used on password change and by admins. */
async function revokeAllForUser(userId, reason = 'admin') {
  const result = await mongoose
    .model('Session')
    .updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  await permissionResolver.invalidateUser(userId);
  return result.modifiedCount || 0;
}

async function loadRoleCodes(userId) {
  const bindings = await mongoose.model('RoleBinding').find({ userId, deletedAt: null }).select('roleId').lean();
  if (!bindings.length) return [];
  const roles = await mongoose
    .model('Role')
    .find({ _id: { $in: bindings.map((b) => b.roleId) }, isActive: true, deletedAt: null })
    .select('code')
    .lean();
  return roles.map((role) => role.code);
}

/** The subset of a user record that is safe to return to the client. */
function publicUser(user, roles) {
  return {
    id: String(user._id),
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    roles: roles || [],
    mustChangePassword: Boolean(user.mustChangePassword),
    mfaEnabled: Boolean(user.mfa && user.mfa.enabled),
    profile: user.profile || {}
  };
}

module.exports = {
  login,
  refresh,
  logout,
  revokeSession,
  revokeFamily,
  revokeAllForUser,
  loadRoleCodes,
  publicUser
};
