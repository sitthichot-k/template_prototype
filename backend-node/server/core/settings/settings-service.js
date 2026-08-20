'use strict';

/**
 * Runtime settings access.
 *
 * Resolution order, most specific first:  user -> organization -> global ->
 * descriptor default. A setting therefore always has a value, and a module
 * can read one without checking whether an administrator has ever visited the
 * settings page.
 *
 * Reads are cached; a write invalidates the affected keys immediately, so a
 * configuration change takes effect on the next request rather than on the
 * next deploy.
 */

const mongoose = require('mongoose');
const cache = require('../db/cache');
const crypto = require('../security/crypto');
const AppError = require('../errors/AppError');
const { buildValueSchema } = require('./setting-descriptor');
const logger = require('../../../config/logger').forModule('settings');

const CACHE_TTL_SECONDS = 600;
const GLOBAL_CACHE_KEY = 'settings:global';

/** @type {import('../kernel/module-registry')|null} */
let registry = null;

/** Called once by the settings module's onBoot hook. */
function bindRegistry(moduleRegistry) {
  registry = moduleRegistry;
}

function requireDescriptor(key) {
  if (!registry) throw AppError.internal('Settings registry is not initialised.');
  const descriptor = registry.getSetting(key);
  if (!descriptor) throw AppError.notFound(`Setting "${key}"`);
  return descriptor;
}

function scopeCacheKey(scope, scopeId) {
  return scope === 'global' ? GLOBAL_CACHE_KEY : `settings:${scope}:${scopeId}`;
}

/** Loads every stored value for one scope as `{ key: value }`. */
async function loadScope(scope, scopeId) {
  return cache.remember(scopeCacheKey(scope, scopeId), CACHE_TTL_SECONDS, async () => {
    const Setting = mongoose.model('Setting');
    const rows = await Setting.find({ scope, scopeId: scopeId || null }).select('key value isSecret').lean();

    const out = {};
    for (const row of rows) {
      out[row.key] = row.isSecret && crypto.isEncrypted(row.value) ? decryptSafely(row.key, row.value) : row.value;
    }
    return out;
  });
}

function decryptSafely(key, value) {
  try {
    return crypto.decrypt(value);
  } catch (error) {
    // Usually means ENCRYPTION_KEY was rotated without re-encrypting. Fail
    // closed for that one value rather than taking the whole read down.
    logger.error({ err: error, key }, 'Failed to decrypt setting - returning null');
    return null;
  }
}

/**
 * Reads a single setting.
 *
 * @param {string} key
 * @param {{scope?: string, scopeId?: string}} [context]
 */
async function get(key, context = {}) {
  const descriptor = requireDescriptor(key);

  if (context.userId && descriptor.scopes.includes('user')) {
    const userScope = await loadScope('user', context.userId);
    if (userScope[key] !== undefined) return userScope[key];
  }

  if (context.organizationId && descriptor.scopes.includes('organization')) {
    const orgScope = await loadScope('organization', context.organizationId);
    if (orgScope[key] !== undefined) return orgScope[key];
  }

  const globalScope = await loadScope('global', null);
  if (globalScope[key] !== undefined) return globalScope[key];

  return descriptor.default;
}

/**
 * Reads a setting, falling back to a supplied value rather than throwing.
 *
 * For the settings that tune a security control - password length, lockout
 * thresholds, idle timeout. Those live on the settings screen so an operator
 * can change them without a redeploy, but the code paths that read them run
 * during login and password changes, where the settings layer being
 * unavailable must not take authentication down with it. The fallback is the
 * environment value the deployment booted with, so an unreachable Redis or an
 * unbound registry degrades to the configured behaviour instead of an error.
 *
 * @param {string} key
 * @param {*} fallback              Usually the matching `config.*` value.
 * @param {object} [context]
 */
async function getOr(key, fallback, context = {}) {
  try {
    const value = await get(key, context);
    return value === undefined || value === null || value === '' ? fallback : value;
  } catch (error) {
    logger.warn({ err: error, key }, 'Setting unavailable - using the configured default');
    return fallback;
  }
}

/**
 * Reads every setting in a group, resolved. This is what a module should use
 * at the start of an operation rather than calling `get` in a loop.
 */
async function getGroup(group, context = {}) {
  const descriptors = registry.listSettings().filter((d) => d.group === group);
  const result = {};
  for (const descriptor of descriptors) {
    result[descriptor.key] = await get(descriptor.key, context);
  }
  return result;
}

/**
 * Resolved values for every declared setting, **excluding secrets**.
 *
 * This is the bulk read, and a bulk read is the wrong place to hand out a
 * credential: its callers are endpoints that serve whole payloads to a client,
 * so anything included here reaches everyone those endpoints answer. It
 * previously returned secrets decrypted alongside everything else, which put
 * the SMTP password in the bootstrap payload of every signed-in user.
 *
 * A secret is still readable - through `get(key)`, one key at a time, from
 * code that has a specific reason to want it (the mailer wanting the SMTP
 * password). That is the difference between a deliberate read and a spill.
 */
async function getAll(context = {}) {
  const result = {};
  for (const descriptor of registry.listSettings()) {
    if (descriptor.secret) continue;
    result[descriptor.key] = await get(descriptor.key, context);
  }
  return result;
}

/**
 * Writes a setting.
 *
 * @param {string} key
 * @param {*} value
 * @param {object} options
 * @param {string} [options.scope='global']
 * @param {string} [options.scopeId]
 * @param {string} [options.actorId]
 * @returns {Promise<{key: string, previous: *, value: *, restartRequired: boolean}>}
 */
async function set(key, value, options = {}) {
  const descriptor = requireDescriptor(key);
  const scope = options.scope || 'global';
  const scopeId = options.scopeId || null;

  if (descriptor.readOnly) {
    throw AppError.forbidden(`Setting "${key}" is read-only.`);
  }
  if (!descriptor.scopes.includes(scope)) {
    throw AppError.badRequest(`Setting "${key}" cannot be set at scope "${scope}".`);
  }

  const { value: validated, error } = buildValueSchema(descriptor).validate(value);
  if (error) {
    throw AppError.validation({ [key]: [error.message] }, `Invalid value for "${descriptor.label}".`);
  }

  const previous = await get(key, { scope, scopeId });

  const Setting = mongoose.model('Setting');
  const stored = descriptor.secret ? crypto.encrypt(validated) : validated;

  await Setting.findOneAndUpdate(
    { key, scope, scopeId },
    {
      $set: {
        key,
        scope,
        scopeId,
        value: stored,
        isSecret: descriptor.secret,
        type: descriptor.type,
        group: descriptor.group,
        updatedBy: options.actorId || null
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await cache.del(scopeCacheKey(scope, scopeId));

  logger.info({ key, scope, scopeId, actorId: options.actorId }, 'Setting updated');

  return {
    key,
    previous: descriptor.secret ? '[redacted]' : previous,
    value: descriptor.secret ? '[redacted]' : validated,
    restartRequired: descriptor.restartRequired
  };
}

/** Removes an override so the value falls back to the next scope down. */
async function reset(key, options = {}) {
  const descriptor = requireDescriptor(key);
  const scope = options.scope || 'global';
  const scopeId = options.scopeId || null;

  await mongoose.model('Setting').deleteOne({ key, scope, scopeId });
  await cache.del(scopeCacheKey(scope, scopeId));

  return { key, value: descriptor.default };
}

/**
 * Descriptors plus current values, shaped for the settings UI. Secret values
 * are reported as set/unset only - the plaintext never leaves the server.
 */
async function describeForUi(context = {}) {
  const descriptors = registry.listSettings();
  const groups = new Map();

  for (const descriptor of descriptors) {
    const raw = await get(descriptor.key, context);
    const entry = Object.assign({}, descriptor, {
      value: descriptor.secret ? undefined : raw,
      isSet: raw !== undefined && raw !== null && raw !== '',
      moduleId: descriptor.moduleId
    });

    if (!groups.has(descriptor.group)) {
      groups.set(descriptor.group, { group: descriptor.group, sections: new Map() });
    }
    const groupEntry = groups.get(descriptor.group);
    const sectionKey = descriptor.section || 'general';
    if (!groupEntry.sections.has(sectionKey)) groupEntry.sections.set(sectionKey, []);
    groupEntry.sections.get(sectionKey).push(entry);
  }

  return Array.from(groups.values()).map((groupEntry) => ({
    group: groupEntry.group,
    sections: Array.from(groupEntry.sections.entries()).map(([section, items]) => ({
      section,
      items: items.sort((a, b) => a.order - b.order)
    }))
  }));
}

async function invalidateAll() {
  await cache.delByPattern('settings:*');
}

module.exports = {
  bindRegistry,
  get,
  getOr,
  getGroup,
  getAll,
  set,
  reset,
  describeForUi,
  invalidateAll
};
