'use strict';

/**
 * Application log: writing, querying and deriving metrics from it.
 *
 * The one rule that shapes everything here: **logging must never break the
 * thing it is describing**. Every write is fire-and-forget and every failure
 * is swallowed into the stdout logger. A database hiccup degrades visibility;
 * it must not turn a working request into a 500.
 *
 * The performance figures are derived from the `api.request` rows rather than
 * from a separate metrics store. One source of truth means the number on the
 * dashboard and the row in the log viewer can never disagree - and a request
 * you can see in the list is a request that counted.
 */

const mongoose = require('mongoose');

const stdoutLogger = require('../../../../config/logger').forModule('observability');
const { sanitize } = require('../../../core/audit/audit-service');

/** Same window stickyNote uses: long enough to show a working day's shape. */
const PERFORMANCE_WINDOW_HOURS = 24;

function model() {
  return mongoose.model('ApplicationLog');
}

/**
 * Writes one entry. Never throws.
 *
 * @param {object} entry
 * @param {'info'|'warn'|'error'} [entry.level='info']  Debug detail goes to stdout, not here.
 * @param {string} entry.action        Dotted verb, e.g. `api.request`.
 * @param {string} [entry.message]
 * @param {string} [entry.source]      Emitting module id.
 * @param {object} [entry.meta]        Free-form; sanitised before storage.
 * @param {object} [entry.context]     Request facts (see the model).
 * @param {import('express').Request} [entry.req]  Fills actor + context.
 */
async function record(entry) {
  try {
    const req = entry.req;

    await model().create({
      level: entry.level || 'info',
      action: entry.action,
      message: entry.message || '',
      source: entry.source || '',
      actorId: entry.actorId || (req && req.auth && req.auth.userId) || null,
      actorLabel: entry.actorLabel || (req && req.auth && req.auth.email) || 'system',
      // Reuses the audit sanitiser so a password can never reach this
      // collection either - there is exactly one list of forbidden keys.
      meta: sanitize(entry.meta || {}),
      context: Object.assign(
        req
          ? {
              requestId: req.id,
              ip: req.ip,
              userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
              method: req.method,
              path: req.originalUrl
            }
          : {},
        entry.context || {}
      ),
      occurredAt: new Date()
    });
  } catch (error) {
    // Deliberately only stdout: trying to log a logging failure into the log
    // is how you get an infinite loop at three in the morning.
    stdoutLogger.error({ err: error, action: entry.action }, 'Failed to write application log');
  }
}

/**
 * Paginated, filtered list.
 *
 * @param {object} query  page, limit, level, action, source, actorId, q, from, to
 */
async function list(query = {}) {
  const filter = buildFilter(query);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25));

  const [items, total] = await Promise.all([
    model()
      .find(filter)
      .sort({ occurredAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    model().countDocuments(filter)
  ]);

  return {
    items: items.map(present),
    page,
    limit,
    total
  };
}

function present(doc) {
  return {
    id: String(doc._id),
    level: doc.level,
    action: doc.action,
    message: doc.message,
    source: doc.source,
    actorId: doc.actorId ? String(doc.actorId) : null,
    actorLabel: doc.actorLabel,
    context: doc.context || {},
    meta: doc.meta || {},
    occurredAt: doc.occurredAt
  };
}

function buildFilter(query) {
  const filter = {};

  if (query.level) filter.level = query.level;
  if (query.source) filter.source = query.source;
  if (query.actorId) filter.actorId = query.actorId;

  // Prefix match, so `auth.` returns every authentication event.
  if (query.action) filter.action = new RegExp(`^${escapeRegex(String(query.action))}`);

  if (query.from || query.to) {
    filter.occurredAt = {};
    if (query.from) filter.occurredAt.$gte = new Date(query.from);
    if (query.to) filter.occurredAt.$lte = new Date(query.to);
  }

  if (query.q) {
    const term = new RegExp(escapeRegex(String(query.q)), 'i');
    // Not a text index: these collections are large and short-lived, and a
    // text index would cost more on every write than it saves on the
    // occasional admin search.
    filter.$or = [{ message: term }, { action: term }, { actorLabel: term }, { 'context.path': term }];
  }

  return filter;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Counts per level within a window - drives the log screen's summary strip. */
async function summary({ hours = 24 } = {}) {
  const since = new Date(Date.now() - hours * 3600 * 1000);

  const [levels, actions] = await Promise.all([
    model().aggregate([
      { $match: { occurredAt: { $gte: since } } },
      { $group: { _id: '$level', count: { $sum: 1 } } }
    ]),
    model().aggregate([
      { $match: { occurredAt: { $gte: since }, level: { $in: ['warn', 'error'] } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ])
  ]);

  const byLevel = { debug: 0, info: 0, warn: 0, error: 0 };
  for (const row of levels) byLevel[row._id] = row.count;

  return {
    since,
    windowHours: hours,
    byLevel,
    total: Object.values(byLevel).reduce((sum, n) => sum + n, 0),
    topProblems: actions.map((row) => ({ action: row._id, count: row.count }))
  };
}

/* --- Performance ------------------------------------------------------------ */

const STATUS_CLASS = {
  $switch: {
    branches: [
      { case: { $lt: ['$context.statusCode', 300] }, then: '2xx' },
      { case: { $lt: ['$context.statusCode', 400] }, then: '3xx' },
      { case: { $lt: ['$context.statusCode', 500] }, then: '4xx' }
    ],
    default: '5xx'
  }
};

const endpointStages = [
  {
    $group: {
      _id: { method: '$context.method', path: '$context.path' },
      count: { $sum: 1 },
      avgMs: { $avg: '$context.durationMs' }
    }
  }
];

const endpointProjection = {
  $project: {
    _id: 0,
    method: '$_id.method',
    path: '$_id.path',
    count: 1,
    avgMs: { $round: ['$avgMs', 0] }
  }
};

/**
 * Traffic, latency and error shape over the last day, derived from the
 * `api.request` entries.
 */
async function performance({ hours = PERFORMANCE_WINDOW_HOURS } = {}) {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const match = { action: 'api.request', occurredAt: { $gte: since } };

  const [totals, percentiles, byHourRaw, statusRaw, topEndpoints, slowest] = await Promise.all([
    model().aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          errors: { $sum: { $cond: [{ $gte: ['$context.statusCode', 400] }, 1, 0] } },
          serverErrors: { $sum: { $cond: [{ $gte: ['$context.statusCode', 500] }, 1, 0] } },
          avgMs: { $avg: '$context.durationMs' },
          maxMs: { $max: '$context.durationMs' }
        }
      }
    ]),

    // `$percentile` needs MongoDB 7. The template pins 7.0, but a child
    // project may point at something older, and a p95 is not worth failing the
    // whole panel over - so this one is allowed to come back empty.
    model()
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            values: {
              $percentile: { input: '$context.durationMs', p: [0.5, 0.95, 0.99], method: 'approximate' }
            }
          }
        }
      ])
      .catch(() => []),

    model().aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%dT%H', date: '$occurredAt' } },
          count: { $sum: 1 }
        }
      }
    ]),
    model().aggregate([{ $match: match }, { $group: { _id: STATUS_CLASS, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    model().aggregate([{ $match: match }, ...endpointStages, { $sort: { count: -1 } }, { $limit: 8 }, endpointProjection]),
    model().aggregate([
      { $match: match },
      ...endpointStages,
      // A single slow call is noise; three of them is a pattern.
      { $match: { count: { $gte: 3 } } },
      { $sort: { avgMs: -1 } },
      { $limit: 8 },
      endpointProjection
    ])
  ]);

  const summaryRow = totals[0];
  const total = summaryRow?.total || 0;

  return {
    windowHours: hours,
    since,
    requests: total,
    errorRate: total ? Number(((100 * summaryRow.errors) / total).toFixed(1)) : 0,
    serverErrorRate: total ? Number(((100 * summaryRow.serverErrors) / total).toFixed(1)) : 0,
    latency: {
      avg: Math.round(summaryRow?.avgMs || 0),
      max: Math.round(summaryRow?.maxMs || 0),
      // null rather than 0 when unavailable: "we did not measure this" and
      // "it took no time" must not look the same on a dashboard.
      p50: roundOrNull(percentiles[0]?.values?.[0]),
      p95: roundOrNull(percentiles[0]?.values?.[1]),
      p99: roundOrNull(percentiles[0]?.values?.[2])
    },
    throughput: zeroFilledHours(byHourRaw, hours),
    statusBreakdown: statusRaw.map((row) => ({ klass: row._id, count: row.count })),
    topEndpoints,
    slowest,
    process: processMetrics()
  };
}

function roundOrNull(value) {
  return value == null ? null : Math.round(value);
}

/**
 * Mongo only returns hours that had traffic. A chart built from that would
 * silently compress a quiet night into nothing, so the gaps are filled here.
 */
function zeroFilledHours(rows, hours) {
  const counts = Object.fromEntries(rows.map((row) => [row._id, row.count]));
  const series = [];

  for (let offset = hours - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 3600 * 1000);
    const key = date.toISOString().slice(0, 13);
    series.push({ hour: `${key.slice(11)}:00`, count: counts[key] || 0 });
  }

  return series;
}

/** This process, not the host: containers make host figures misleading. */
function processMetrics() {
  const memory = process.memoryUsage();
  const mb = (bytes) => Number((bytes / 1048576).toFixed(1));

  return {
    uptimeSec: Math.round(process.uptime()),
    rssMb: mb(memory.rss),
    heapUsedMb: mb(memory.heapUsed),
    heapTotalMb: mb(memory.heapTotal),
    nodeVersion: process.version,
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  };
}

/* --- Retention -------------------------------------------------------------- */

/**
 * Creates or re-tunes the TTL index from the retention setting.
 *
 * Mongo will not change `expireAfterSeconds` on an existing index through
 * `createIndex`, so a changed setting needs an explicit `collMod` - without it
 * the retention setting would appear to work while the old window silently
 * stayed in force.
 */
async function ensureRetentionIndex(retentionDays) {
  const seconds = Math.max(3600, Math.round(Number(retentionDays) * 24 * 3600));

  try {
    const collection = model().collection;
    const indexes = await collection.indexes();

    // Any index on this exact key, TTL or not.
    const onOccurredAt = indexes.filter((index) => index.key?.occurredAt === 1 && Object.keys(index.key).length === 1);
    const existing = onOccurredAt.find((index) => index.expireAfterSeconds != null);

    if (!existing) {
      // A plain `{ occurredAt: 1 }` left behind by an earlier version of the
      // schema blocks the TTL index outright: Mongo refuses a second index on
      // the same key with different options. Dropping it is safe - the TTL
      // index that replaces it serves every query the old one did.
      for (const stale of onOccurredAt) {
        await collection.dropIndex(stale.name);
        stdoutLogger.info({ index: stale.name }, 'Dropped a non-TTL index blocking log retention');
      }

      await collection.createIndex({ occurredAt: 1 }, { expireAfterSeconds: seconds, name: 'applicationlog_ttl' });
      stdoutLogger.info({ retentionDays }, 'Application log TTL index created');
      return;
    }

    if (existing.expireAfterSeconds !== seconds) {
      await mongoose.connection.db.command({
        collMod: collection.collectionName,
        index: { name: existing.name, expireAfterSeconds: seconds }
      });
      stdoutLogger.info({ retentionDays }, 'Application log TTL index updated');
    }
  } catch (error) {
    // Not fatal: logging still works, entries just accumulate until an
    // operator fixes it.
    stdoutLogger.error({ err: error }, 'Could not ensure the application log TTL index');
  }
}

module.exports = {
  record,
  list,
  summary,
  performance,
  ensureRetentionIndex,
  PERFORMANCE_WINDOW_HOURS
};
