'use strict';

/**
 * Break-glass recovery for the policy layer.
 *
 * A policy deny outranks the super-admin bypass. That is deliberate - it is
 * what lets a rule pin a break-glass account to a trusted network - but it
 * also means an active policy can deny everybody everything, and the screen
 * that would switch it off is behind the permission it just revoked. At that
 * point no account can fix it through the API, so the fix has to come from
 * outside the API. This is that door.
 *
 * `POST /policies` and `PATCH /policies/:id` refuse a rule that would lock out
 * its own author, so reaching for this script should be rare. It is still
 * needed: policy conditions are contextual, and a deny keyed to a date or a
 * network that is not today's passes that check and bites later, possibly to
 * an administrator who never saw the rule being written.
 *
 *   npm run policy:recover -- --list
 *   npm run policy:recover -- --deactivate <policyId>
 *   npm run policy:recover -- --deactivate-all
 *
 * Deactivating never deletes: the rule stays on the screen with its conditions
 * intact, so whoever wrote it can see what it did and correct it. Every run
 * drops the policy cache, so the effect is immediate rather than up to the
 * cache TTL later.
 *
 * Run it wherever the database is reachable - inside the API container is
 * usually simplest:
 *
 *   docker compose exec backend npm run policy:recover -- --list
 */

const mongoose = require('mongoose');

const logger = require('../config/logger').forModule('policy-recover');
const database = require('../server/core/db/connection');
const cache = require('../server/core/db/cache');
const ModuleRegistry = require('../server/core/kernel/module-registry');
const { loadModules } = require('../server/core/kernel/module-loader');
const permissionResolver = require('../server/core/security/permission-resolver');

/* eslint-disable no-console */

function usage() {
  console.log('');
  console.log('  Usage:');
  console.log('    npm run policy:recover -- --list');
  console.log('    npm run policy:recover -- --deactivate <policyId>');
  console.log('    npm run policy:recover -- --deactivate-all');
  console.log('');
}

function describe(policy) {
  const conditions = Object.entries(policy.conditions || {})
    .map(([field, rule]) => `${field} ${JSON.stringify(rule)}`)
    .join(', ');

  console.log(`    ${policy.name}`);
  console.log(`      id          ${policy._id}`);
  console.log(`      effect      ${policy.effect}  priority ${policy.priority}`);
  console.log(`      subjects    ${(policy.subjects || []).join(', ') || '(any)'}`);
  console.log(`      resources   ${(policy.resources || []).join(', ')}`);
  console.log(`      actions     ${(policy.actions || []).join(', ')}`);
  console.log(`      conditions  ${conditions || '(none)'}`);
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);
  const wantsList = args.includes('--list');
  const wantsAll = args.includes('--deactivate-all');
  const idIndex = args.indexOf('--deactivate');
  const targetId = idIndex === -1 ? null : args[idIndex + 1];

  if (!wantsList && !wantsAll && !targetId) {
    usage();
    process.exitCode = 1;
    return;
  }

  await database.connect();
  await cache.connect();

  // The Policy model belongs to the access-control module, so its manifest has
  // to register the schema before there is anything to query.
  const registry = new ModuleRegistry();
  const manifests = await loadModules(registry);
  for (const manifest of manifests) {
    if (manifest.models) await manifest.models();
  }

  const Policy = mongoose.model('Policy');
  const active = await Policy.find({ isActive: true, deletedAt: null }).sort({ priority: -1 }).lean();

  if (wantsList) {
    console.log('');
    if (!active.length) {
      console.log('  No active policies. Nothing here can be denying access.\n');
      return;
    }
    console.log(`  Active policies (${active.length}), highest priority first:\n`);
    for (const policy of active) describe(policy);
    return;
  }

  const targets = wantsAll ? active : active.filter((policy) => String(policy._id) === String(targetId));

  if (!targets.length) {
    console.log('');
    console.log(
      targetId
        ? `  No active policy with id ${targetId}. Run with --list to see what is active.`
        : '  No active policies to deactivate.'
    );
    console.log('');
    process.exitCode = wantsAll ? 0 : 1;
    return;
  }

  // `updatedBy` is left alone on purpose: nobody authenticated for this, and
  // recording an operator's shell as a user would put a false name in the
  // audit trail.
  const ids = targets.map((policy) => policy._id);
  await Policy.updateMany({ _id: { $in: ids } }, { $set: { isActive: false } });
  await permissionResolver.invalidatePolicies();

  console.log('');
  console.log(`  Deactivated ${targets.length} ${targets.length === 1 ? 'policy' : 'policies'}:`);
  for (const policy of targets) console.log(`    ${policy.name}  (${policy._id})`);
  console.log('');
  console.log('  The rules are kept with their conditions intact - correct them on the');
  console.log('  Policies screen, check them with the simulator, then activate again.');
  console.log('');
}

/* eslint-enable no-console */

main()
  .then(async () => {
    await cache.disconnect().catch(() => {});
    await database.disconnect().catch(() => {});
    process.exit(process.exitCode || 0);
  })
  .catch(async (error) => {
    logger.fatal({ err: error }, 'Policy recovery failed');
    await cache.disconnect().catch(() => {});
    await database.disconnect().catch(() => {});
    process.exit(1);
  });
