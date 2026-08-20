'use strict';

/**
 * Application log queries.
 *
 * Read-only. There is no endpoint that writes, edits or deletes an entry:
 * writing is what the service and the request middleware do, and retention is
 * the TTL index's job. Exposing a delete here would mean an administrator
 * could quietly remove the record of their own mistake.
 */

const mongoose = require('mongoose');

const asyncHandler = require('../../../core/http/async-handler');
const response = require('../../../core/http/response');
const logService = require('../services/log.service');

const list = asyncHandler(async (req, res) => {
  const result = await logService.list(req.query);
  return response.paginated(res, result.items, result);
});

const getOne = asyncHandler(async (req, res) => {
  const entry = await mongoose.model('ApplicationLog').findById(req.params.id).lean();
  if (!entry) {
    return response.failure(res, { status: 404, code: 'NOT_FOUND', message: 'Log entry was not found.' });
  }

  return response.ok(res, Object.assign({ id: String(entry._id) }, entry, { _id: undefined }));
});

/** Level counts and the noisiest problems, for the log screen's header. */
const summary = asyncHandler(async (req, res) => {
  return response.ok(res, await logService.summary({ hours: Number(req.query.hours) || 24 }));
});

/** Traffic, latency and error shape - the dashboard's performance panel. */
const stats = asyncHandler(async (req, res) => {
  return response.ok(res, await logService.performance({ hours: Number(req.query.hours) || undefined }));
});

module.exports = { list, getOne, summary, stats };
