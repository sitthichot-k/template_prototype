'use strict';

/**
 * Seed runner.
 *
 * Boots the kernel without opening a port, then runs each module's declared
 * seeds in registration order. Seeds must be idempotent - this is expected to
 * run on every deploy, not once.
 *
 *   npm run seed
 *   npm run seed -- --only access-control
 */

const config = require('../config');
const logger = require('../config/logger').forModule('seed');
const database = require('../server/core/db/connection');
const cache = require('../server/core/db/cache');
const ModuleRegistry = require('../server/core/kernel/module-registry');
const { loadModules } = require('../server/core/kernel/module-loader');
const settingsService = require('../server/core/settings/settings-service');

function parseArgs(argv) {
  const args = { only: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only') args.only = argv[i + 1];
  }
  return args;
}

/**
 * A stand-in for the Express application, for boot hooks running under `seed`.
 *
 * Seeds boot the kernel without an HTTP server, so a hook that registers
 * middleware has nothing to register it against. Rather than teach every hook
 * to detect that, the stub answers the small surface a hook may legitimately
 * touch outside a request cycle:
 *
 *   set()     - an app setting nothing will read
 *   use()     - middleware with no server to attach to
 *   locals    - a real object, because a hook may write defaults into it
 *
 * Everything else is deliberately absent. A hook reaching for `listen`,
 * `route` or a verb method during a seed is a design error, and it should
 * surface as a loud TypeError here rather than be swallowed by a permissive
 * catch-all stub and rediscovered in production.
 */
function createSeedAppStub() {
  return {
    set() {},
    use() {},
    locals: {}
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  logger.info({ env: config.env.appEnv }, 'Seed run starting');

  await database.connect();
  await cache.connect();

  const registry = new ModuleRegistry();
  const manifests = await loadModules(registry);

  // The settings service reads descriptors from the registry, and seeds may
  // read a setting, so bind it before anything runs.
  settingsService.bindRegistry(registry);

  // Boot hooks own permission synchronisation, which seeds depend on: the
  // ADMINISTRATOR role is built from the permission catalogue.
  for (const manifest of manifests) {
    if (manifest.hooks && manifest.hooks.onBoot) {
      await manifest.hooks.onBoot({
        registry,
        config,
        logger,
        app: createSeedAppStub()
      });
    }
  }

  const seeds = registry.listSeeds();
  const selected = args.only ? seeds.filter((seed) => seed.moduleId === args.only) : seeds;

  if (!selected.length) {
    logger.warn({ only: args.only }, 'No seeds matched');
  }

  for (const seed of selected) {
    const started = Date.now();
    try {
      const result = await seed.handler({ registry, config, logger });
      logger.info(
        { module: seed.moduleId, seed: seed.id, ms: Date.now() - started, result },
        'Seed completed'
      );
    } catch (error) {
      logger.error({ err: error, module: seed.moduleId, seed: seed.id }, 'Seed failed');
      throw error;
    }
  }

  logger.info({ count: selected.length }, 'Seed run complete');
}

main()
  .then(async () => {
    await cache.disconnect();
    await database.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.fatal({ err: error }, 'Seed run failed');
    await cache.disconnect().catch(() => {});
    await database.disconnect().catch(() => {});
    process.exit(1);
  });
