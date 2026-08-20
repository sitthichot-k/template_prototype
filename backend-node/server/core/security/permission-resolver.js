'use strict';

/**
 * Computes a user's effective permissions.
 *
 * The model is RBAC with an ABAC overlay:
 *
 *   1. Roles grant `{ resource -> actions }`. A user's roles come from role
 *      bindings, which may be global or scoped to an organisational unit.
 *   2. Direct grants on the user add or remove individual actions, for the
 *      exceptions every organisation eventually needs.
 *   3. Policies evaluate conditions against the request context and can allow
 *      or deny. An explicit deny at any layer is final - this is the property
 *      that makes "revoke access to X" trustworthy.
 *
 * The result is cached in Redis keyed by user and permission version. Any
 * change that affects a user's access bumps their `permissionVersion`, which
 * invalidates the cache and every access token they hold, in one move.
 */

const mongoose = require('mongoose');
const cache = require('../db/cache');
const logger = require('../../../config/logger').forModule('permissions');

const CACHE_TTL_SECONDS = 300;
const WILDCARD = '*';

/**
 * Models are owned by the access-control module and registered during its
 * boot. Resolving them lazily keeps core independent of the module while
 * still failing loudly if the module was disabled.
 */
function model(name) {
  try {
    return mongoose.model(name);
  } catch {
    throw new Error(
      `Model "${name}" is not registered. The access-control module must be enabled for authorization to work.`
    );
  }
}

function cacheKey(userId, permissionVersion) {
  return `perm:${userId}:${permissionVersion}`;
}

/**
 * Where active policies come from.
 *
 * Injectable so that core does not hard-depend on the access-control module's
 * Policy collection: a deployment can source policies from elsewhere, and
 * tests can supply them without a database. The default reads the model the
 * access-control module registers.
 *
 * @type {() => Promise<object[]>}
 */
let policyLoader = async function defaultPolicyLoader() {
  return model('Policy').find({ isActive: true, deletedAt: null }).sort({ priority: -1 }).lean();
};

function setPolicyLoader(loader) {
  policyLoader = loader;
}

/**
 * Merges `{ resource: [actions] }` maps. Later grants add to earlier ones;
 * removal is never expressed here, only through explicit denies.
 */
function mergeGrants(target, grants) {
  for (const grant of grants || []) {
    if (!grant || !grant.resource) continue;
    const current = target[grant.resource] || new Set();
    for (const action of grant.actions || []) current.add(action);
    target[grant.resource] = current;
  }
  return target;
}

/**
 * Builds the raw permission map for a user, before policy evaluation.
 *
 * @param {string} userId
 * @returns {Promise<{superAdmin: boolean, allow: object, deny: object, roles: string[], scopes: object}>}
 */
async function buildPermissionMap(userId) {
  const User = model('User');
  const Role = model('Role');
  const RoleBinding = model('RoleBinding');

  const user = await User.findOne({ _id: userId, deletedAt: null })
    .select('status directGrants directDenies permissionVersion')
    .lean();

  if (!user) return { superAdmin: false, allow: {}, deny: {}, roles: [], scopes: {} };

  const bindings = await RoleBinding.find({ userId, deletedAt: null }).select('roleId scope scopeId').lean();
  const roleIds = bindings.map((b) => b.roleId);

  const roles = roleIds.length
    ? await Role.find({ _id: { $in: roleIds }, deletedAt: null, isActive: true })
        .select('code name isSuperAdmin grants')
        .lean()
    : [];

  // A super-admin role short-circuits everything below. Deliberately absolute:
  // a break-glass account must not be silently limited by a stale policy.
  const superAdmin = roles.some((role) => role.isSuperAdmin);

  const allow = {};
  for (const role of roles) mergeGrants(allow, role.grants);
  mergeGrants(allow, user.directGrants);

  const deny = {};
  mergeGrants(deny, user.directDenies);

  // Scope map: which organisational units each role was bound in.
  //
  // NOT an access control. Nothing in this template narrows a query by it, and
  // `can()` never consults it - a scoped binding grants exactly what a global
  // one grants. It is reported so a project can build scoping on top; until it
  // does, `assignRoles` refuses to create a scoped binding rather than let the
  // UI imply a limit the resolver does not apply.
  const scopes = {};
  for (const binding of bindings) {
    const key = binding.scope || 'global';
    if (!scopes[key]) scopes[key] = [];
    if (binding.scopeId) scopes[key].push(String(binding.scopeId));
  }

  return {
    superAdmin,
    allow: serializeMap(allow),
    deny: serializeMap(deny),
    roles: roles.map((r) => r.code),
    scopes
  };
}

function serializeMap(map) {
  const out = {};
  for (const [resource, actions] of Object.entries(map)) out[resource] = Array.from(actions);
  return out;
}

/**
 * Returns the cached (or freshly computed) permission map for a user.
 *
 * @param {string} userId
 * @param {number} permissionVersion
 */
async function getPermissionMap(userId, permissionVersion) {
  const key = cacheKey(userId, permissionVersion);
  return cache.remember(key, CACHE_TTL_SECONDS, () => buildPermissionMap(userId));
}

/**
 * Matches a resource against a grant key, supporting a trailing wildcard.
 * `/security/*` grants `/security/users` but never `/settings/general`.
 */
function resourceMatches(grantKey, resource) {
  if (grantKey === WILDCARD) return true;
  if (grantKey === resource) return true;
  if (grantKey.endsWith('/*')) return resource.startsWith(grantKey.slice(0, -1));
  return false;
}

function mapHasAction(map, resource, action) {
  for (const [grantKey, actions] of Object.entries(map)) {
    if (!resourceMatches(grantKey, resource)) continue;
    if (actions.includes(WILDCARD) || actions.includes(action)) return true;
  }
  return false;
}

/**
 * The single authorization decision point.
 *
 * @param {object} params
 * @param {object} params.permissionMap  From `getPermissionMap`.
 * @param {string} params.resource
 * @param {string} params.action
 * @param {object} [params.context]      Request context for policy evaluation.
 * @param {object[]} [params.policies]   Evaluate against this policy set instead
 *                                       of the stored one. For asking what a
 *                                       rule *would* decide before it is saved.
 * @returns {Promise<{allowed: boolean, reason: string}>}
 */
async function can({ permissionMap, resource, action, context = {}, policies = null }) {
  if (!permissionMap) return { allowed: false, reason: 'NO_PERMISSION_MAP' };

  // 1. Explicit deny always wins, even over super-admin, because a deny is
  //    the mechanism used to lock a compromised account out of a resource.
  if (mapHasAction(permissionMap.deny, resource, action)) {
    return { allowed: false, reason: 'EXPLICIT_DENY' };
  }

  // 2. Policy layer (ABAC). Evaluated before the role grant so a conditional
  //    deny (out of hours, wrong network) can override a static allow.
  const policyDecision = await evaluatePolicies({ permissionMap, resource, action, context, policies });
  if (policyDecision === 'deny') return { allowed: false, reason: 'POLICY_DENY' };

  // 3. Super admin.
  if (permissionMap.superAdmin) return { allowed: true, reason: 'SUPER_ADMIN' };

  // 4. Role and direct grants.
  if (mapHasAction(permissionMap.allow, resource, action)) {
    return { allowed: true, reason: 'GRANTED' };
  }

  // 5. A policy may grant access no role covers.
  if (policyDecision === 'allow') return { allowed: true, reason: 'POLICY_ALLOW' };

  return { allowed: false, reason: 'NOT_GRANTED' };
}

/**
 * Evaluates active policies. Returns 'allow', 'deny' or null (no opinion).
 * Policies are cached because they change rarely and are read on every call.
 *
 * A caller may supply the set to evaluate instead, which is how a write can be
 * asked what it would decide before it is committed. Such a set is the
 * caller's to order by descending priority - the stored path gets that from
 * the loader's sort.
 */
async function evaluatePolicies({ permissionMap, resource, action, context, policies = null }) {
  let active = policies;

  if (!active) {
    try {
      active = await cache.remember('policies:active', CACHE_TTL_SECONDS, policyLoader);
    } catch (error) {
      // A policy store failure must not silently widen access.
      logger.error({ err: error }, 'Policy evaluation failed - denying by default');
      return 'deny';
    }
  }

  if (!active || !active.length) return null;

  for (const policy of active) {
    const resourceMatch = (policy.resources || []).some((r) => resourceMatches(r, resource));
    if (!resourceMatch) continue;

    const actionMatch = (policy.actions || []).includes(WILDCARD) || (policy.actions || []).includes(action);
    if (!actionMatch) continue;

    const subjectMatch =
      !policy.subjects ||
      !policy.subjects.length ||
      policy.subjects.some((code) => permissionMap.roles.includes(code));
    if (!subjectMatch) continue;

    if (matchesConditions(policy.conditions, context)) {
      return policy.effect === 'deny' ? 'deny' : 'allow';
    }
  }

  return null;
}

/**
 * Condition evaluation.
 *
 * Deliberately a small fixed operator set rather than an expression language:
 * an authorization rule that can run arbitrary code is an authorization rule
 * nobody can audit.
 */
// A flat operator table. Splitting it into helpers would scatter the
// authorization rule across several files for no gain in readability.
// eslint-disable-next-line complexity
function matchesConditions(conditions, context) {
  if (!conditions || !Object.keys(conditions).length) return true;

  for (const [field, rule] of Object.entries(conditions)) {
    const actual = readPath(context, field);

    if (rule === null || typeof rule !== 'object') {
      if (actual !== rule) return false;
      continue;
    }
    if (rule.eq !== undefined && actual !== rule.eq) return false;
    if (rule.ne !== undefined && actual === rule.ne) return false;
    if (rule.in !== undefined && !rule.in.includes(actual)) return false;
    if (rule.nin !== undefined && rule.nin.includes(actual)) return false;
    if (rule.gt !== undefined && !(actual > rule.gt)) return false;
    if (rule.gte !== undefined && !(actual >= rule.gte)) return false;
    if (rule.lt !== undefined && !(actual < rule.lt)) return false;
    if (rule.lte !== undefined && !(actual <= rule.lte)) return false;
    if (rule.exists !== undefined && (actual !== undefined) !== rule.exists) return false;
  }
  return true;
}

function readPath(source, dottedPath) {
  return String(dottedPath)
    .split('.')
    .reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), source);
}

/**
 * Flattens the permission map into the `{ resource: [actions] }` shape the
 * frontends consume to show or hide UI affordances.
 *
 * The UI check is convenience only - the API check above is the control.
 *
 * **Policies are deliberately not evaluated here.** A policy decision depends
 * on the request context (address, time), and this payload is built once at
 * bootstrap, where no such request exists. So the two can legitimately
 * disagree: a conditional deny may hide nothing, and a conditional allow
 * grants something the UI never offers. That is acceptable precisely because
 * `can()` runs on every request and is the only decision that binds - but it
 * is also why an *unconditional* policy is rejected by the validator, since
 * that disagreement would then be permanent rather than contextual.
 */
function toClientShape(permissionMap, catalogue) {
  if (!permissionMap) return {};
  if (permissionMap.superAdmin) {
    const all = {};
    for (const entry of catalogue) all[entry.resource] = entry.actions.slice();
    return all;
  }

  const result = {};
  for (const entry of catalogue) {
    const granted = entry.actions.filter(
      (action) =>
        mapHasAction(permissionMap.allow, entry.resource, action) &&
        !mapHasAction(permissionMap.deny, entry.resource, action)
    );
    if (granted.length) result[entry.resource] = granted;
  }
  return result;
}

/** Drops every cached map for a user, across all permission versions. */
async function invalidateUser(userId) {
  await cache.delByPattern(`perm:${userId}:*`);
}

async function invalidatePolicies() {
  await cache.del('policies:active');
}

module.exports = {
  buildPermissionMap,
  getPermissionMap,
  setPolicyLoader,
  can,
  toClientShape,
  invalidateUser,
  invalidatePolicies,
  resourceMatches,
  matchesConditions,
  WILDCARD
};
