'use strict';

/**
 * OpenID Connect provider - authorization-code flow with PKCE.
 *
 * Covers corporate SSO (Keycloak, Entra ID, Google Workspace, an in-house IAM)
 * without the platform ever handling the user's password. The provider returns
 * an identity assertion; mapping that assertion onto a platform user, and
 * deciding what they may do, stays with the access-control module.
 *
 * Enable by adding `oidc` to IDENTITY_PROVIDERS and setting the OIDC_* values.
 */

const crypto = require('crypto');
const axios = require('axios');

const config = require('../../../../config');
const AppError = require('../../errors/AppError');
const cache = require('../../db/cache');
const logger = require('../../../../config/logger').forModule('oidc');

const DISCOVERY_CACHE_KEY = 'oidc:discovery';
const DISCOVERY_TTL_SECONDS = 3600;
const STATE_TTL_SECONDS = 600;

async function discover() {
  return cache.remember(DISCOVERY_CACHE_KEY, DISCOVERY_TTL_SECONDS, async () => {
    const url = `${config.oidc.issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const { data } = await axios.get(url, { timeout: 8000 });
    return data;
  });
}

function base64url(buffer) {
  return buffer.toString('base64url');
}

/** A single leading slash, and no second one - `//evil.example` is a URL. */
function safeReturnTo(value) {
  const candidate = String(value || '');
  return /^\/(?!\/)[^\s\\]*$/.test(candidate) ? candidate : '/';
}

module.exports = {
  id: 'oidc',
  name: 'Single sign-on',
  kind: 'redirect',

  isConfigured() {
    return Boolean(config.oidc.issuerUrl && config.oidc.clientId && config.oidc.redirectUri);
  },

  /**
   * Step 1: build the URL the browser is sent to.
   *
   * PKCE is mandatory, not optional: without it, an intercepted authorization
   * code is enough to complete the exchange.
   */
  async createAuthorizationUrl({ returnTo } = {}) {
    if (!this.isConfigured()) throw AppError.badRequest('OIDC is not configured.');

    const metadata = await discover();
    const state = base64url(crypto.randomBytes(24));
    const nonce = base64url(crypto.randomBytes(24));
    const codeVerifier = base64url(crypto.randomBytes(48));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

    // `returnTo` comes off the query string and is handed back to whoever
    // completes the login, so it is exactly the shape an open redirect takes.
    // Only a site-relative path survives: anything with a scheme, a host, or a
    // protocol-relative `//` prefix is dropped for the default. Validated at
    // the point it enters rather than where it is consumed, because the code
    // that consumes it has not been written yet.
    await cache.set(
      `oidc:state:${state}`,
      { nonce, codeVerifier, returnTo: safeReturnTo(returnTo) },
      STATE_TTL_SECONDS
    );

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.oidc.clientId,
      redirect_uri: config.oidc.redirectUri,
      scope: config.oidc.scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    return { url: `${metadata.authorization_endpoint}?${params.toString()}`, state };
  },

  /**
   * Step 2: exchange the code for tokens and return the identity assertion.
   *
   * @param {{code: string, state: string}} credentials
   */
  async authenticate({ code, state }) {
    if (!this.isConfigured()) throw AppError.badRequest('OIDC is not configured.');
    if (!code || !state) throw AppError.badRequest('Missing authorization code or state.');

    const stored = await cache.get(`oidc:state:${state}`);
    if (!stored) {
      // Either a replay, a CSRF attempt, or the user took longer than the TTL.
      throw AppError.unauthenticated('Login request expired or invalid. Please start again.', 'OIDC_STATE_INVALID');
    }
    await cache.del(`oidc:state:${state}`);

    const metadata = await discover();

    let tokenResponse;
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.oidc.redirectUri,
        client_id: config.oidc.clientId,
        code_verifier: stored.codeVerifier
      });
      if (config.oidc.clientSecret) body.set('client_secret', config.oidc.clientSecret);

      const response = await axios.post(metadata.token_endpoint, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      });
      tokenResponse = response.data;
    } catch (error) {
      logger.error({ err: error }, 'OIDC token exchange failed');
      throw AppError.unauthenticated('Single sign-on failed.', 'OIDC_EXCHANGE_FAILED');
    }

    // userinfo is used rather than decoding the id_token locally so that
    // claim freshness and signature validation are the provider's job.
    let profile;
    try {
      const response = await axios.get(metadata.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        timeout: 8000
      });
      profile = response.data;
    } catch (error) {
      logger.error({ err: error }, 'OIDC userinfo request failed');
      throw AppError.unauthenticated('Could not read the single sign-on profile.', 'OIDC_PROFILE_FAILED');
    }

    if (!profile.sub) {
      throw AppError.unauthenticated('Single sign-on profile is missing a subject.', 'OIDC_PROFILE_INVALID');
    }

    return {
      provider: 'oidc',
      subject: String(profile.sub),
      email: profile.email ? String(profile.email).toLowerCase() : '',
      displayName: profile.name || profile.preferred_username || profile.email || String(profile.sub),
      attributes: {
        emailVerified: Boolean(profile.email_verified),
        groups: profile.groups || [],
        department: profile.department || ''
      },
      verified: Boolean(profile.email_verified),
      returnTo: stored.returnTo
    };
  }
};
