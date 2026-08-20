'use strict';

/**
 * Redis client for caching, rate-limit counters and session invalidation.
 *
 * Degradation is deliberate: a cache miss caused by Redis being down must
 * never take the API down with it. Read helpers swallow errors and report a
 * miss; only operations whose correctness depends on Redis (rate limiting)
 * surface the failure.
 */

const Redis = require('ioredis');
const config = require('../../../config');
const logger = require('../../../config/logger').forModule('cache');

/** @type {import('ioredis').Redis|null} */
let client = null;
let healthy = false;

async function connect() {
  if (client) return client;

  client = new Redis(config.redis.url, {
    keyPrefix: config.redis.keyPrefix,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(times) {
      return Math.min(times * 200, 5000);
    }
  });

  client.on('ready', () => {
    healthy = true;
    logger.info('Redis connected');
  });
  client.on('end', () => {
    healthy = false;
    logger.warn('Redis connection closed');
  });
  client.on('error', (err) => {
    healthy = false;
    logger.error({ err }, 'Redis error');
  });

  await client.connect();
  return client;
}

async function disconnect() {
  if (!client) return;
  await client.quit();
  client = null;
  healthy = false;
}

function getClient() {
  return client;
}

function isHealthy() {
  return healthy;
}

async function get(key) {
  if (!healthy) return null;
  try {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ err, key }, 'Cache read failed - treating as miss');
    return null;
  }
}

async function set(key, value, ttlSeconds) {
  if (!healthy) return false;
  try {
    const payload = JSON.stringify(value);
    if (ttlSeconds) await client.set(key, payload, 'EX', ttlSeconds);
    else await client.set(key, payload);
    return true;
  } catch (err) {
    logger.warn({ err, key }, 'Cache write failed');
    return false;
  }
}

async function del(key) {
  if (!healthy) return false;
  try {
    await client.del(key);
    return true;
  } catch (err) {
    logger.warn({ err, key }, 'Cache delete failed');
    return false;
  }
}

/**
 * Deletes every key matching a pattern using SCAN.
 *
 * KEYS is O(n) and blocks the server, so it is never used - this matters
 * because permission invalidation runs on every role change.
 *
 * @param {string} pattern Pattern WITHOUT the configured key prefix.
 */
async function delByPattern(pattern) {
  if (!healthy) return 0;
  const fullPattern = `${config.redis.keyPrefix}${pattern}`;
  let cursor = '0';
  let removed = 0;

  try {
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', fullPattern, 'COUNT', 200);
      cursor = nextCursor;
      if (keys.length) {
        // ioredis prepends keyPrefix on write commands, so strip it from the
        // keys SCAN returned to avoid double-prefixing on DEL.
        const unprefixed = keys.map((k) => k.slice(config.redis.keyPrefix.length));
        removed += await client.del(...unprefixed);
      }
    } while (cursor !== '0');
    return removed;
  } catch (err) {
    logger.warn({ err, pattern }, 'Cache pattern delete failed');
    return removed;
  }
}

/**
 * Read-through cache helper.
 *
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<any>} producer
 */
async function remember(key, ttlSeconds, producer) {
  const cached = await get(key);
  if (cached !== null) return cached;
  const fresh = await producer();
  if (fresh !== null && fresh !== undefined) await set(key, fresh, ttlSeconds);
  return fresh;
}

module.exports = {
  connect,
  disconnect,
  getClient,
  isHealthy,
  get,
  set,
  del,
  delByPattern,
  remember
};
