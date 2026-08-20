'use strict';

/**
 * User administration endpoints.
 *
 * Controllers stay thin: validate-shaped input in, service call, envelope out.
 * Business rules live in the service so they are reachable from seeds, jobs
 * and tests without an HTTP request.
 */

const asyncHandler = require('../../../core/http/async-handler');
const response = require('../../../core/http/response');
const AppError = require('../../../core/errors/AppError');
const userService = require('../services/user.service');

const list = asyncHandler(async (req, res) => {
  const result = await userService.list(req.query);
  return response.paginated(res, result.items, result);
});

const getOne = asyncHandler(async (req, res) => {
  return response.ok(res, await userService.getById(req.params.id));
});

const create = asyncHandler(async (req, res) => {
  const user = await userService.create(req.body, { actorId: req.auth.userId, req });
  return response.created(res, user, `${req.baseUrl}/${user.id}`);
});

const update = asyncHandler(async (req, res) => {
  return response.ok(res, await userService.update(req.params.id, req.body, { actorId: req.auth.userId, req }));
});

const changeStatus = asyncHandler(async (req, res) => {
  // Locking yourself out is the single most common self-inflicted outage in
  // an admin console, so it is refused outright.
  if (String(req.params.id) === req.auth.userId && req.body.status !== 'active') {
    throw AppError.badRequest('You cannot deactivate your own account.');
  }

  const user = await userService.changeStatus(req.params.id, req.body.status, {
    actorId: req.auth.userId,
    reason: req.body.reason,
    req
  });
  return response.ok(res, user);
});

const remove = asyncHandler(async (req, res) => {
  if (String(req.params.id) === req.auth.userId) {
    throw AppError.badRequest('You cannot delete your own account.');
  }
  await userService.remove(req.params.id, { actorId: req.auth.userId, req });
  return response.noContent(res);
});

const assignRoles = asyncHandler(async (req, res) => {
  const result = await userService.assignRoles(req.params.id, req.body.roleIds, {
    actorId: req.auth.userId,
    scope: req.body.scope,
    scopeId: req.body.scopeId,
    req
  });
  return response.ok(res, result);
});

const effectivePermissions = asyncHandler(async (req, res) => {
  const registry = req.app.get('moduleRegistry');
  return response.ok(res, await userService.getEffectivePermissions(req.params.id, registry));
});

const resetPassword = asyncHandler(async (req, res) => {
  await userService.resetPassword(req.params.id, req.body.newPassword, { actorId: req.auth.userId, req });
  return response.noContent(res);
});

// --- Self-service ------------------------------------------------------------

const me = asyncHandler(async (req, res) => {
  return response.ok(res, await userService.getById(req.auth.userId));
});

const updateMe = asyncHandler(async (req, res) => {
  return response.ok(res, await userService.update(req.auth.userId, req.body, { actorId: req.auth.userId, req }));
});

const changeMyPassword = asyncHandler(async (req, res) => {
  await userService.changePassword(req.auth.userId, req.body, { req });
  return response.noContent(res);
});

module.exports = {
  list,
  getOne,
  create,
  update,
  changeStatus,
  remove,
  assignRoles,
  effectivePermissions,
  resetPassword,
  me,
  updateMe,
  changeMyPassword
};
