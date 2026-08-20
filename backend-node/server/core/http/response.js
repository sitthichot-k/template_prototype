'use strict';

/**
 * The response envelope every endpoint in the platform uses.
 *
 * Both frontends and the generated API client depend on this exact shape, so
 * it is defined once here rather than assembled ad hoc in controllers:
 *
 *   success  { "success": true,  "data": <payload>, "meta": {...}? }
 *   failure  { "success": false, "error": { "code", "message", "details"? },
 *              "requestId": "..." }
 */

function ok(res, data, meta) {
  const body = { success: true, data: data === undefined ? null : data };
  if (meta) body.meta = meta;
  return res.status(200).json(body);
}

function created(res, data, location) {
  if (location) res.location(location);
  return res.status(201).json({ success: true, data });
}

function accepted(res, data) {
  return res.status(202).json({ success: true, data: data === undefined ? null : data });
}

function noContent(res) {
  return res.status(204).end();
}

/**
 * Paginated list response. `meta.pagination` is the contract the frontend
 * data-table component reads directly.
 */
function paginated(res, items, { page, limit, total }) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  return res.status(200).json({
    success: true,
    data: items,
    meta: {
      pagination: {
        page: Number(page) || 1,
        limit: safeLimit,
        total: Number(total) || 0,
        totalPages: Math.ceil((Number(total) || 0) / safeLimit)
      }
    }
  });
}

function failure(res, { status, code, message, details, requestId }) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ success: false, error, requestId });
}

module.exports = { ok, created, accepted, noContent, paginated, failure };
