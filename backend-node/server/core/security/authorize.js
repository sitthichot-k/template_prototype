'use strict';

/**
 * Authorization middleware - decides *what* the caller may do.
 *
 * Usage in a module's routes:
 *
 *   const { authenticate } = require('.../authenticate');
 *   const { requirePermission } = require('.../authorize');
 *
 *   router.use(authenticate);
 *   router.get('/',    requirePermission('/security/users', 'view'),   ctrl.list);
 *   router.post('/',   requirePermission('/security/users', 'create'), ctrl.create);
 *
 * The `resource` string must exist in the permission catalogue, which is
 * built from module manifests. Guarding a route with a resource no module
 * declared is a boot-time error, not a silent always-deny - a typo in a
 * permission string is otherwise invisible until someone is wrongly locked
 * out (or wrongly let in).
 */

const AppError = require('../errors/AppError');
const asyncHandler = require('../http/async-handler');
const permissionResolver = require('./permission-resolver');
const { loadPermissionMap } = require('./authenticate');
const auditService = require('../audit/audit-service');
const logger = require('../../../config/logger').forModule('authz');

/**
 * @param {string|string[]} resource  Resource path, or several - holding the
 *                                    action on ANY of them is sufficient.
 * @param {string} action
 * @param {object} [options]
 * @param {(req) => object} [options.context]  Extra facts for policy conditions.
 * @param {boolean} [options.audit=false]      Record every denial as an audit event.
 */
function requirePermission(resource, action, options = {}) {
  const resources = Array.isArray(resource) ? resource : [resource];

  return asyncHandler(async (req, res, next) => {
    if (!req.auth) throw AppError.unauthenticated();

    const permissionMap = await loadPermissionMap(req);

    const context = Object.assign(
      {
        user: { id: req.auth.userId, roles: req.auth.roles },
        request: { ip: req.ip, method: req.method, path: req.path, at: new Date().toISOString() }
      },
      options.context ? options.context(req) : {}
    );

    for (const candidate of resources) {
      const decision = await permissionResolver.can({ permissionMap, resource: candidate, action, context });
      if (decision.allowed) {
        req.auth.decision = { resource: candidate, action, reason: decision.reason };
        return next();
      }
    }

    logger.warn(
      { userId: req.auth.userId, resources, action, path: req.originalUrl },
      'Authorization denied'
    );

    if (options.audit !== false) {
      auditService
        .record({
          action: 'authz.denied',
          category: 'security',
          outcome: 'denied',
          actorId: req.auth.userId,
          target: { type: 'resource', id: resources.join(',') },
          metadata: { action, method: req.method, path: req.originalUrl },
          req
        })
        .catch((err) => logger.error({ err }, 'Failed to record authorization denial'));
    }

    // The message names neither the resource nor the missing action: telling
    // a caller exactly which permission they lack maps the permission model
    // for them.
    throw AppError.forbidden();
  });
}

/**
 * Requires every listed `[resource, action]` pair. For operations that touch
 * several protected areas at once, e.g. assigning a role to a user.
 *
 * @param {Array<[string, string]>} pairs
 */
function requireAllPermissions(pairs) {
  return asyncHandler(async (req, res, next) => {
    if (!req.auth) throw AppError.unauthenticated();
    const permissionMap = await loadPermissionMap(req);

    for (const [resource, action] of pairs) {
      const decision = await permissionResolver.can({ permissionMap, resource, action });
      if (!decision.allowed) throw AppError.forbidden();
    }
    return next();
  });
}

/** Coarse role check. Prefer `requirePermission` - roles are an implementation detail. */
function requireRole(...roleCodes) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.auth) return next(AppError.unauthenticated());
    const held = req.auth.roles || [];
    if (!roleCodes.some((code) => held.includes(code))) return next(AppError.forbidden());
    return next();
  };
}

/**
 * Programmatic check for use inside a service, where the decision depends on
 * the record being operated on rather than the route alone.
 */
async function can(req, resource, action, extraContext = {}) {
  if (!req.auth) return false;
  const permissionMap = await loadPermissionMap(req);
  const decision = await permissionResolver.can({
    permissionMap,
    resource,
    action,
    context: Object.assign({ user: { id: req.auth.userId, roles: req.auth.roles } }, extraContext)
  });
  return decision.allowed;
}

/**
 * Boot-time validation: every resource guarding a route must exist in the
 * catalogue. Called by the access-control module's onReady hook.
 *
 * @param {import('../kernel/module-registry')} registry
 * @param {string[]} guardedResources
 */
function assertResourcesDeclared(registry, guardedResources) {
  const missing = guardedResources.filter((resource) => !registry.getPermission(resource));
  if (missing.length) {
    throw AppError.internal(
      `Routes are guarded by permission resources no module declares: ${missing.join(', ')}. ` +
        'Add them to the module manifest\'s `permissions` array.'
    );
  }
}

module.exports = {
  requirePermission,
  requireAllPermissions,
  requireRole,
  can,
  assertResourcesDeclared
};
