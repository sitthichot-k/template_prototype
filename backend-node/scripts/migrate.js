'use strict';

/**
 * Migration runner.
 *
 *   npm run migrate            apply everything pending
 *   npm run migrate:status     show applied and pending
 *   npm run migrate:down       roll back the most recent migration
 *
 * Migrations live in ../../database/migrations as `NNN-description.js` and
 * export `{ up(db), down(db) }`. Applied names are recorded in a `migrations`
 * collection, so re-running is safe.
 *
 * Schema shape is Mongoose's job; migrations exist for the things it cannot
 * do: backfilling data, building an index without blocking writes, and
 * reshaping documents after a model change.
 */

const fs = require('fs');
const path = require('path');

const logger = require('../config/logger').forModule('migrate');
const database = require('../server/core/db/connection');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'database', 'migrations');
const COLLECTION = 'migrations';

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.js') && !name.startsWith('_'))
    .sort();
}

async function appliedNames(db) {
  const rows = await db.collection(COLLECTION).find({}).sort({ appliedAt: 1 }).toArray();
  return rows.map((row) => row.name);
}

async function up(db) {
  const files = listMigrationFiles();
  const applied = new Set(await appliedNames(db));
  const pending = files.filter((file) => !applied.has(file));

  if (!pending.length) {
    logger.info('No pending migrations');
    return;
  }

  for (const file of pending) {
    // eslint-disable-next-line global-require
    const migration = require(path.join(MIGRATIONS_DIR, file));
    const started = Date.now();

    logger.info({ migration: file }, 'Applying migration');
    await migration.up(db);

    await db.collection(COLLECTION).insertOne({
      name: file,
      appliedAt: new Date(),
      durationMs: Date.now() - started
    });

    logger.info({ migration: file, ms: Date.now() - started }, 'Migration applied');
  }

  logger.info({ count: pending.length }, 'Migrations complete');
}

async function down(db) {
  const rows = await db.collection(COLLECTION).find({}).sort({ appliedAt: -1 }).limit(1).toArray();
  if (!rows.length) {
    logger.info('Nothing to roll back');
    return;
  }

  const last = rows[0];
  // eslint-disable-next-line global-require
  const migration = require(path.join(MIGRATIONS_DIR, last.name));

  if (typeof migration.down !== 'function') {
    throw new Error(`Migration ${last.name} declares no down() - it cannot be rolled back.`);
  }

  logger.warn({ migration: last.name }, 'Rolling back migration');
  await migration.down(db);
  await db.collection(COLLECTION).deleteOne({ _id: last._id });
  logger.info({ migration: last.name }, 'Rollback complete');
}

async function status(db) {
  const files = listMigrationFiles();
  const applied = new Set(await appliedNames(db));

  /* eslint-disable no-console */
  console.log('\nMigrations\n');
  if (!files.length) console.log('  (none found in database/migrations)');
  for (const file of files) {
    console.log(`  ${applied.has(file) ? '[applied]' : '[pending]'}  ${file}`);
  }
  console.log('');
  /* eslint-enable no-console */
}

async function main() {
  const command = process.argv[2] || 'up';
  const connection = await database.connect();
  const db = connection.db;

  if (command === 'up') await up(db);
  else if (command === 'down') await down(db);
  else if (command === 'status') await status(db);
  else throw new Error(`Unknown command "${command}". Use up, down or status.`);
}

main()
  .then(async () => {
    await database.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.fatal({ err: error }, 'Migration run failed');
    await database.disconnect().catch(() => {});
    process.exit(1);
  });
