'use strict';

/**
 * Audit trail queries.
 *
 * Read-only: there is no endpoint that writes, edits or deletes an entry.
 * Retention is enforced by the scheduled job the module declares, driven by
 * the `security.audit.retentionDays` setting.
 */

const mongoose = require('mongoose');

const asyncHandler = require('../../../core/http/async-handler');
const response = require('../../../core/http/response');

function buildFilter(query) {
  const filter = {};
  if (query.category) filter.category = query.category;
  if (query.outcome) filter.outcome = query.outcome;
  if (query.actorId) filter.actorId = query.actorId;
  // Prefix match so `user.` returns every user event.
  if (query.action) filter.action = new RegExp(`^${String(query.action).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (query.from || query.to) {
    filter.occurredAt = {};
    if (query.from) filter.occurredAt.$gte = new Date(query.from);
    if (query.to) filter.occurredAt.$lte = new Date(query.to);
  }
  return filter;
}

const list = asyncHandler(async (req, res) => {
  const AuditLog = mongoose.model('AuditLog');
  const filter = buildFilter(req.query);

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ occurredAt: -1 })
      .skip((req.query.page - 1) * req.query.limit)
      .limit(req.query.limit)
      .lean(),
    AuditLog.countDocuments(filter)
  ]);

  return response.paginated(
    res,
    items.map((item) => Object.assign({ id: String(item._id) }, item, { _id: undefined })),
    { page: req.query.page, limit: req.query.limit, total }
  );
});

const getOne = asyncHandler(async (req, res) => {
  const item = await mongoose.model('AuditLog').findById(req.params.id).lean();
  if (!item) return response.failure(res, { status: 404, code: 'NOT_FOUND', message: 'Audit entry was not found.' });
  return response.ok(res, Object.assign({ id: String(item._id) }, item, { _id: undefined }));
});

/** Every entry touching one record - the "history" tab of any resource. */
const forTarget = asyncHandler(async (req, res) => {
  const items = await mongoose
    .model('AuditLog')
    .find({ 'target.type': req.params.type, 'target.id': req.params.id })
    .sort({ occurredAt: -1 })
    .limit(200)
    .lean();

  return response.ok(res, items.map((item) => Object.assign({ id: String(item._id) }, item, { _id: undefined })));
});

/** Counts per action and outcome, for the security dashboard. */
const summary = asyncHandler(async (req, res) => {
  const AuditLog = mongoose.model('AuditLog');
  const since = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await AuditLog.aggregate([
    { $match: { occurredAt: { $gte: since } } },
    { $group: { _id: { category: '$category', outcome: '$outcome' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  return response.ok(res, {
    since,
    breakdown: rows.map((row) => ({
      category: row._id.category,
      outcome: row._id.outcome,
      count: row.count
    }))
  });
});

module.exports = { list, getOne, forTarget, summary };
