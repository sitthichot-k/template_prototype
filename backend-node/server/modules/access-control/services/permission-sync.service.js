'use strict';

/**
 * Projects the in-memory permission catalogue into MongoDB.
 *
 * Runs on every boot. Code is the source of truth: a permission exists
 * because a module declares it, and this keeps the queryable copy honest
 * without anyone maintaining a second list.
 *
 * Roles that reference a permission which has disappeared are reported rather
 * than silently repaired - a vanished permission usually means a module was
 * disabled by mistake, and quietly stripping grants would hide that.
 */

const mongoose = require('mongoose');
const logger = require('../../../../config/logger').forModule('permission-sync');

/**
 * @param {import('../../../core/kernel/module-registry')} registry
 * @returns {Promise<{created: number, updated: number, removed: number, orphanedGrants: object[]}>}
 */
async function sync(registry) {
  const Permission = mongoose.model('Permission');
  const catalogue = registry.listPermissions();
  const syncVersion = Date.now();

  let created = 0;
  let updated = 0;

  for (const entry of catalogue) {
    const result = await Permission.findOneAndUpdate(
      { resource: entry.resource },
      {
        $set: {
          resource: entry.resource,
          label: entry.label,
          description: entry.description,
          group: entry.group,
          actions: entry.actions,
          dangerous: entry.dangerous,
          contributedBy: entry.contributedBy,
          syncVersion
        }
      },
      { upsert: true, new: false, setDefaultsOnInsert: true }
    );
    if (result) updated += 1;
    else created += 1;
  }

  // Anything the current boot did not touch belongs to a module that is no
  // longer loaded.
  const stale = await Permission.find({ syncVersion: { $ne: syncVersion } }).select('resource').lean();
  const staleResources = stale.map((row) => row.resource);
  if (staleResources.length) {
    await Permission.deleteMany({ resource: { $in: staleResources } });
  }

  const orphanedGrants = staleResources.length ? await findOrphanedGrants(staleResources) : [];

  if (orphanedGrants.length) {
    logger.warn(
      { count: orphanedGrants.length, resources: staleResources },
      'Roles still grant permissions that no loaded module declares'
    );
  }

  logger.info(
    { created, updated, removed: staleResources.length, total: catalogue.length },
    'Permission catalogue synchronised'
  );

  return { created, updated, removed: staleResources.length, orphanedGrants };
}

/** Roles whose grants point at resources that no longer exist. */
async function findOrphanedGrants(staleResources) {
  const Role = mongoose.model('Role');
  const roles = await Role.find({ 'grants.resource': { $in: staleResources }, deletedAt: null })
    .select('code name grants')
    .lean();

  return roles.map((role) => ({
    roleId: String(role._id),
    code: role.code,
    orphaned: role.grants.filter((grant) => staleResources.includes(grant.resource)).map((g) => g.resource)
  }));
}

/**
 * Validates that every grant in a role names a real resource and a real
 * action. Used when a role is created or updated so an invalid grant is
 * rejected at the API rather than discovered during an access check.
 *
 * @param {import('../../../core/kernel/module-registry')} registry
 * @param {Array<{resource: string, actions: string[]}>} grants
 */
function validateGrants(registry, grants) {
  const problems = [];

  for (const grant of grants || []) {
    const permission = registry.getPermission(grant.resource);
    if (!permission) {
      problems.push(`Unknown resource "${grant.resource}".`);
      continue;
    }
    for (const action of grant.actions || []) {
      if (action !== '*' && !permission.actions.includes(action)) {
        problems.push(`Action "${action}" is not valid for "${grant.resource}".`);
      }
    }
  }

  return problems;
}

module.exports = { sync, validateGrants, findOrphanedGrants };
