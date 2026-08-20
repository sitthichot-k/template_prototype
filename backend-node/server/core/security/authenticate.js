'use strict';

/**
 * Authentication middleware - establishes *who* the caller is.
 *
 * On success it populates `req.auth`:
 *
 *   { userId, sessionId, roles, permissionVersion, permissionMap }
 *
 * Authorization (*what* they may do) is a separate concern handled by
 * `authorize.js`. Keeping them apart means a route can require a valid
 * identity without also naming a permission.
 */

const mongoose = require('mongoose');
const AppError = require('../errors/AppError');
const asyncHandler = require('../http/async-handler');
const tokens = require('./tokens');
const permissionResolver = require('./permission-resolver');
const logger = require('../../../config/logger').forModule('auth');

function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!/^Bearer$/i.test(scheme) || !value) return null;
  return value.trim();
}

/**
 * Requires a valid access token.
 *
 * Two database-backed checks run on top of JWT verification, because a
 * stateless token alone cannot express revocation:
 *
 *   - the session must still exist and not be revoked (logout, admin kill)
 *   - the token's permission version must match the user's current one
 *     (any role or grant change invalidates outstanding tokens immediately)
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw AppError.unauthenticated('Missing bearer token.', 'TOKEN_MISSING');
  }

  const payload = tokens.verifyAccessToken(token);

  const Session = mongoose.model('Session');
  const session = await Session.findOne({ _id: payload.sid, revokedAt: null })
    .select('userId expiresAt lastSeenAt')
    .lean();

  if (!session) {
    throw AppError.unauthenticated('Session is no longer valid.', 'SESSION_REVOKED');
  }
  if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
    throw AppError.unauthenticated('Session expired.', 'SESSION_EXPIRED');
  }

  const User = mongoose.model('User');
  const user = await User.findOne({ _id: payload.sub, deletedAt: null })
    .select('status permissionVersion email displayName')
    .lean();

  if (!user) {
    throw AppError.unauthenticated('Account no longer exists.', 'ACCOUNT_MISSING');
  }
  if (user.status !== 'active') {
    throw AppError.forbidden('This account is not active.');
  }

  if ((user.permissionVersion || 0) !== (payload.pv || 0)) {
    // The client should refresh; the new token carries the current version.
    throw AppError.unauthenticated('Permissions changed - please refresh.', 'PERMISSIONS_CHANGED');
  }

  req.auth = {
    userId: String(user._id),
    sessionId: String(payload.sid),
    roles: payload.roles || [],
    permissionVersion: user.permissionVersion || 0,
    email: user.email,
    displayName: user.displayName,
    permissionMap: null // resolved lazily by authorize()
  };

  // Idle-timeout tracking. Fire-and-forget: a failed touch must not fail the
  // request, and the write is throttled to at most once a minute per session.
  const lastSeen = session.lastSeenAt ? session.lastSeenAt.getTime() : 0;
  if (Date.now() - lastSeen > 60000) {
    Session.updateOne({ _id: payload.sid }, { $set: { lastSeenAt: new Date() } })
      .exec()
      .catch((err) => logger.warn({ err, sessionId: payload.sid }, 'Failed to update session lastSeenAt'));
  }

  return next();
});

/**
 * Populates `req.auth` when a valid token is present but never rejects.
 * For endpoints whose response varies for signed-in users but which remain
 * publicly reachable.
 */
const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  if (!extractBearerToken(req)) return next();
  try {
    return await new Promise((resolve, reject) => {
      authenticate(req, res, (err) => (err ? reject(err) : resolve(next())));
    });
  } catch {
    return next();
  }
});

/** Loads and memoises the caller's permission map on the request. */
async function loadPermissionMap(req) {
  if (!req.auth) throw AppError.unauthenticated();
  if (!req.auth.permissionMap) {
    req.auth.permissionMap = await permissionResolver.getPermissionMap(
      req.auth.userId,
      req.auth.permissionVersion
    );
  }
  return req.auth.permissionMap;
}

module.exports = { authenticate, optionalAuthenticate, loadPermissionMap, extractBearerToken };
