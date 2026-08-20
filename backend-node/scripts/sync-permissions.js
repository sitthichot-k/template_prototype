'use strict';

/**
 * Standalone permission sync.
 *
 * The application already runs this on boot. This script exists for the case
 * where you need the answer without starting the API: a deploy pipeline that
 * wants to see which permissions a release adds or removes, or an operator
 * checking whether a disabled module has left roles granting things that no
 * longer exist.
 *
 *   npm run sync:permissions
 *   npm run sync:permissions -- --dry-run
 */

const logger = require('../config/logger').forModule('sync-permissions');
const database = require('../server/core/db/connection');
const cache = require('../server/core/db/cache');
const ModuleRegistry = require('../server/core/kernel/module-registry');
const { loadModules } = require('../server/core/kernel/module-loader');
const permissionSync = require('../server/modules/access-control/services/permission-sync.service');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await database.connect();
  await cache.connect();

  const registry = new ModuleRegistry();
  const manifests = await loadModules(registry);

  // Models must be registered before permission-sync can query them.
  for (const manifest of manifests) {
    if (manifest.models) await manifest.models();
  }

  const catalogue = registry.listPermissions();

  /* eslint-disable no-console */
  if (dryRun) {
    console.log(`\nPermission catalogue (${catalogue.length} resources)\n`);
    const byGroup = new Map();
    for (const entry of catalogue) {
      if (!byGroup.has(entry.group)) byGroup.set(entry.group, []);
      byGroup.get(entry.group).push(entry);
    }
    for (const [group, entries] of byGroup) {
      console.log(`  ${group}`);
      for (const entry of entries) {
        console.log(`    ${entry.resource.padEnd(32)} ${entry.actions.join(', ')}${entry.dangerous ? '  [dangerous]' : ''}`);
      }
      console.log('');
    }
    console.log('Dry run - nothing was written.\n');
    return;
  }

  const result = await permissionSync.sync(registry);

  console.log('');
  console.log(`  created  ${result.created}`);
  console.log(`  updated  ${result.updated}`);
  console.log(`  removed  ${result.removed}`);

  if (result.orphanedGrants.length) {
    console.log('\n  Roles still granting permissions that no loaded module declares:');
    for (const orphan of result.orphanedGrants) {
      console.log(`    ${orphan.code}: ${orphan.orphaned.join(', ')}`);
    }
    console.log('\n  This usually means a module was disabled. Re-enable it, or edit');
    console.log('  the affected roles to remove the stale grants.');
  }
  console.log('');
  /* eslint-enable no-console */
}

main()
  .then(async () => {
    await cache.disconnect();
    await database.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.fatal({ err: error }, 'Permission sync failed');
    await cache.disconnect().catch(() => {});
    await database.disconnect().catch(() => {});
    process.exit(1);
  });
