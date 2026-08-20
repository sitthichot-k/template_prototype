'use strict';

/**
 * Authentication endpoints.
 *
 * The refresh token travels in an httpOnly, SameSite cookie scoped to the
 * auth path - never in the response body for browser clients. Non-browser
 * clients may still read it from the body, which is why both are sent.
 */

const asyncHandler = require('../../../core/http/async-handler');
const response = require('../../../core/http/response');
const AppError = require('../../../core/errors/AppError');
const tokens = require('../../../core/security/tokens');
const identity = require('../../../core/security/identity');
const authService = require('../services/auth.service');

const login = asyncHandler(async (req, res) => {
  const { provider, identifier, password, code, state } = req.body;

  const credentials = provider === 'local' ? { identifier, password } : { code, state };
  const result = await authService.login({ provider, credentials, req });

  res.cookie(tokens.REFRESH_COOKIE_NAME, result.refreshToken, tokens.refreshCookieOptions());

  return response.ok(res, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    user: result.user
  });
});

const refresh = asyncHandler(async (req, res) => {
  // Cookie first: a browser client should never have to hold the token in JS.
  const refreshToken = req.signedCookies[tokens.REFRESH_COOKIE_NAME] || req.body.refreshToken;

  const result = await authService.refresh({ refreshToken, req });

  res.cookie(tokens.REFRESH_COOKIE_NAME, result.refreshToken, tokens.refreshCookieOptions());

  return response.ok(res, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    user: result.user
  });
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout({ sessionId: req.auth.sessionId, req });

  res.clearCookie(tokens.REFRESH_COOKIE_NAME, tokens.refreshCookieOptions());
  return response.noContent(res);
});

/** Signs the caller out of every device. */
const logoutAll = asyncHandler(async (req, res) => {
  const count = await authService.revokeAllForUser(req.auth.userId, 'logout');
  res.clearCookie(tokens.REFRESH_COOKIE_NAME, tokens.refreshCookieOptions());
  return response.ok(res, { revokedSessions: count });
});

/** Providers the login screen should offer. Public by design. */
const listProviders = asyncHandler(async (req, res) => {
  return response.ok(res, { providers: identity.listEnabled() });
});

/** Starts the OIDC redirect flow. */
const startSso = asyncHandler(async (req, res) => {
  const provider = identity.get('oidc');
  if (typeof provider.createAuthorizationUrl !== 'function') {
    throw AppError.badRequest('This provider does not support redirect login.');
  }
  const { url } = await provider.createAuthorizationUrl({ returnTo: req.query.returnTo });
  return response.ok(res, { url });
});

module.exports = { login, refresh, logout, logoutAll, listProviders, startSso };
