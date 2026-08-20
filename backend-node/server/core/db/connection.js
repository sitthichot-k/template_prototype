'use strict';

/**
 * MongoDB connection lifecycle.
 *
 * Owns exactly one mongoose connection for the process. Modules never call
 * `mongoose.connect` - they declare models and the kernel guarantees the
 * connection is open before any module boots.
 */

const mongoose = require('mongoose');
const config = require('../../../config');
const logger = require('../../../config/logger').forModule('db');

// Reject queries that reference a field absent from the schema instead of
// silently matching nothing - a common source of "why is this list empty".
mongoose.set('strictQuery', true);
// Fail fast instead of buffering a query for 10s against a downed database.
mongoose.set('bufferCommands', false);

let connected = false;

async function connect() {
  if (connected) return mongoose.connection;

  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));

  await mongoose.connect(config.mongo.uri, config.mongo.options);
  connected = true;

  // Index builds are expensive and can block writes. Let them run at boot in
  // the lower tiers; in production they are applied by a migration so a
  // deployment never triggers an unplanned build.
  mongoose.set('autoIndex', !config.env.isProduction);

  return mongoose.connection;
}

async function disconnect() {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
  logger.info('MongoDB connection closed');
}

function isHealthy() {
  return mongoose.connection.readyState === 1;
}

/**
 * Runs `fn` inside a transaction when the deployment supports them (replica
 * set or sharded cluster), and directly otherwise. Standalone MongoDB - the
 * usual local setup - has no transaction support, so this keeps the same
 * service code working in both places.
 *
 * @param {(session: import('mongoose').ClientSession|null) => Promise<any>} fn
 */
async function withTransaction(fn) {
  const supportsTransactions = Boolean(
    mongoose.connection.db &&
      mongoose.connection.client &&
      mongoose.connection.client.topology &&
      mongoose.connection.client.topology.hasSessionSupport &&
      mongoose.connection.client.topology.hasSessionSupport()
  );

  if (!supportsTransactions) {
    logger.debug('Transactions unavailable on this topology - executing without one');
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { connect, disconnect, isHealthy, withTransaction, mongoose };
