'use strict';

/**
 * Permission catalogue - read-only by design.
 *
 * The catalogue is derived from module manifests, so there is no create or
 * update endpoint: changing what permissions exist is a code change that goes
 * through review, not a runtime action. This is what stops the permission
 * model from drifting away from what the code actually enforces.
 */

const asyncHandler = require('../../../core/http/async-handler');
const response = require('../../../core/http/response');
const permissionResolver = require('../../../core/security/permission-resolver');
const { loadPermissionMap } = require('../../../core/security/authenticate');

/** Full catalogue, grouped for the permission-matrix UI. */
const catalogue = asyncHandler(async (req, res) => {
  const registry = req.app.get('moduleRegistry');
  const permissions = registry.listPermissions();

  const groups = new Map();
  for (const permission of permissions) {
    if (!groups.has(permission.group)) groups.set(permission.group, []);
    groups.get(permission.group).push(permission);
  }

  return response.ok(res, {
    groups: Array.from(groups.entries()).map(([group, items]) => ({
      group,
      items: items.sort((a, b) => a.resource.localeCompare(b.resource))
    })),
    total: permissions.length
  });
});

/** The caller's own effective permissions - drives UI affordances. */
const mine = asyncHandler(async (req, res) => {
  const registry = req.app.get('moduleRegistry');
  const permissionMap = await loadPermissionMap(req);

  return response.ok(res, {
    superAdmin: permissionMap.superAdmin,
    roles: permissionMap.roles,
    scopes: permissionMap.scopes,
    permissions: permissionResolver.toClientShape(permissionMap, registry.listPermissions())
  });
});

module.exports = { catalogue, mine };
