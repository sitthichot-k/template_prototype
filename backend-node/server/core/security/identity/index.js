'use strict';

/**
 * Identity provider registry.
 *
 * The platform owns its own user records and its own authorization; an
 * external provider only ever answers "who is this person". That separation
 * is what lets a child project start on local credentials and later adopt
 * corporate SSO without any change to roles, permissions or audit.
 *
 * Adding a provider is a two-step change: implement the interface below and
 * add its id to IDENTITY_PROVIDERS.
 *
 * Provider interface:
 *   id            {string}
 *   name          {string}
 *   authenticate(credentials, context) -> Promise<IdentityAssertion>
 *   isConfigured() -> boolean
 *
 * IdentityAssertion:
 *   { provider, subject, email, displayName, attributes, verified }
 */

const config = require('../../../../config');
const AppError = require('../../errors/AppError');
const logger = require('../../../../config/logger').forModule('identity');

const providers = new Map();

function register(provider) {
  if (!provider || !provider.id) throw new Error('Identity provider must expose an id.');
  providers.set(provider.id, provider);
}

function get(id) {
  const provider = providers.get(id);
  if (!provider) {
    throw AppError.badRequest(`Unknown identity provider "${id}".`);
  }
  if (!config.auth.providers.includes(id)) {
    throw AppError.badRequest(`Identity provider "${id}" is not enabled for this deployment.`);
  }
  return provider;
}

/** Providers that are both enabled and correctly configured. */
function listEnabled() {
  return config.auth.providers
    .map((id) => providers.get(id))
    .filter(Boolean)
    .filter((provider) => {
      const ready = provider.isConfigured();
      if (!ready) logger.warn({ provider: provider.id }, 'Identity provider enabled but not configured - skipping');
      return ready;
    })
    .map((provider) => ({ id: provider.id, name: provider.name, kind: provider.kind || 'credentials' }));
}

// Built-in providers. `local` is always registered; the rest activate only
// when listed in IDENTITY_PROVIDERS.
register(require('./local.provider'));
register(require('./oidc.provider'));

module.exports = { register, get, listEnabled, providers };
