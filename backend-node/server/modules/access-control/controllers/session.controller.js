'use strict';

/**
 * Session visibility and revocation.
 *
 * "Where am I signed in, and how do I sign that device out" is a control
 * users expect and auditors ask for, so it is part of the phase-1 module
 * rather than a later addition.
 */

const mongoose = require('mongoose');

const asyncHandler = require('../../../core/http/async-handler');
const response = require('../../../core/http/response');
const AppError = require('../../../core/errors/AppError');
const { parseFilter } = require('../../../core/http/pagination');
const authService = require('../services/auth.service');

function present(session, currentSessionId) {
  return {
    id: String(session._id),
    provider: session.provider,
    device: session.device,
    issuedAt: session.issuedAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    revokedReason: session.revokedReason,
    isCurrent: String(session._id) === currentSessionId
  };
}

/** The caller's own sessions. */
const mine = asyncHandler(async (req, res) => {
  const sessions = await mongoose
    .model('Session')
    .find({ userId: req.auth.userId, revokedAt: null })
    .sort({ lastSeenAt: -1 })
    .lean();

  return response.ok(res, sessions.map((session) => present(session, req.auth.sessionId)));
});

/** Revokes one of the caller's own sessions. */
const revokeMine = asyncHandler(async (req, res) => {
  const session = await mongoose.model('Session').findOne({ _id: req.params.id, userId: req.auth.userId }).lean();
  if (!session) throw AppError.notFound('Session');

  await authService.revokeSession(req.params.id, 'logout');
  return response.noContent(res);
});

/** Administrative view across all users. */
const list = asyncHandler(async (req, res) => {
  // Built through the shared parser rather than by hand. Assigning
  // `req.query.filter.userId` straight onto the query was the one place in the
  // codebase that skipped `parseFilter`'s allowlist and its rejection of
  // values beginning with `$`, so `?filter[userId][$ne]=` arrived at mongo as
  // an operator instead of an id.
  const filter = Object.assign(
    { revokedAt: null },
    parseFilter(req.query.filter, ['userId'])
  );

  const [items, total] = await Promise.all([
    mongoose
      .model('Session')
      .find(filter)
      .populate('userId', 'email displayName')
      .sort({ lastSeenAt: -1 })
      .skip((req.query.page - 1) * req.query.limit)
      .limit(req.query.limit)
      .lean(),
    mongoose.model('Session').countDocuments(filter)
  ]);

  return response.paginated(
    res,
    items.map((session) =>
      Object.assign(present(session, req.auth.sessionId), {
        user: session.userId
          ? { id: String(session.userId._id), email: session.userId.email, displayName: session.userId.displayName }
          : null
      })
    ),
    { page: req.query.page, limit: req.query.limit, total }
  );
});

/** Administrative revocation of every session belonging to a user. */
const revokeForUser = asyncHandler(async (req, res) => {
  const count = await authService.revokeAllForUser(req.params.id, 'admin');
  return response.ok(res, { revokedSessions: count });
});

module.exports = { mine, revokeMine, list, revokeForUser };
