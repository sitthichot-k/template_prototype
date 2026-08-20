'use strict';

const asyncHandler = require('../../../core/http/async-handler');
const response = require('../../../core/http/response');
const roleService = require('../services/role.service');

const list = asyncHandler(async (req, res) => {
  const result = await roleService.list(req.query);
  return response.paginated(res, result.items, result);
});

const getOne = asyncHandler(async (req, res) => {
  return response.ok(res, await roleService.getById(req.params.id));
});

const create = asyncHandler(async (req, res) => {
  const role = await roleService.create(req.body, {
    registry: req.app.get('moduleRegistry'),
    actorId: req.auth.userId,
    req
  });
  return response.created(res, role, `${req.baseUrl}/${role.id}`);
});

const update = asyncHandler(async (req, res) => {
  const role = await roleService.update(req.params.id, req.body, {
    registry: req.app.get('moduleRegistry'),
    actorId: req.auth.userId,
    req
  });
  return response.ok(res, role);
});

const remove = asyncHandler(async (req, res) => {
  await roleService.remove(req.params.id, { actorId: req.auth.userId, req });
  return response.noContent(res);
});

const members = asyncHandler(async (req, res) => {
  const result = await roleService.listMembers(req.params.id, req.query);
  return response.paginated(res, result.items, result);
});

module.exports = { list, getOne, create, update, remove, members };
