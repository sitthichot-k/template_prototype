'use strict';

/**
 * JWT issuing and verification.
 *
 * Design: a short-lived stateless access token plus a long-lived opaque
 * refresh token bound to a Session document.
 *
 *  - The access token is never checked against the database, so the hot path
 *    stays fast. Its TTL is the maximum window a revoked user stays active.
 *  - The refresh token is stored hashed and rotated on every use, so a stolen
 *    refresh token is detectable: presenting an already-rotated token means
 *    theft, and the whole session family is revoked.
 */

const jwt = require('jsonwebtoken');
const config = require('../../../config');
const AppError = require('../errors/AppError');
const { randomToken, hashToken } = require('./crypto');

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.sessionId
 * @param {string[]} [params.roles]   Role codes, for coarse checks only.
 * @param {number} [params.permissionVersion]
 */
function issueAccessToken({ userId, sessionId, roles = [], permissionVersion = 0 }) {
  const payload = {
    sub: String(userId),
    sid: String(sessionId),
    roles,
    // Bumped whenever the user's effective permissions change. The authorize
    // middleware compares it against the current value so a permission change
    // takes effect immediately, without waiting for the token to expire.
    pv: permissionVersion,
    typ: 'access'
  };

  return jwt.sign(payload, config.auth.accessSecret, {
    expiresIn: config.auth.accessTokenTtl,
    issuer: config.auth.issuer,
    audience: config.auth.audience,
    algorithm: 'HS256'
  });
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.auth.accessSecret, {
    issuer: config.auth.issuer,
    audience: config.auth.audience,
    algorithms: ['HS256']
  });
  if (payload.typ !== 'access') {
    throw AppError.unauthenticated('Wrong token type.', 'TOKEN_INVALID');
  }
  return payload;
}

/**
 * Creates a refresh token. Only the hash is persisted; the plaintext is
 * returned once and never recoverable afterwards.
 */
function issueRefreshToken() {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + config.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  return { token, tokenHash: hashToken(token), expiresAt };
}

/** Cookie options for the refresh token. httpOnly keeps it out of reach of XSS. */
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    domain: config.cookie.domain || undefined,
    // Scoped to the refresh endpoint so it is not attached to every API call.
    path: `${config.http.apiPrefix}/auth`,
    maxAge: config.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    signed: true
  };
}

const REFRESH_COOKIE_NAME = 'rt';

module.exports = {
  issueAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  refreshCookieOptions,
  REFRESH_COOKIE_NAME
};
