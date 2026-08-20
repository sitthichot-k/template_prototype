'use strict';

/**
 * Role management.
 *
 * Two invariants are enforced here rather than left to convention:
 *
 *   - grants must reference permissions that a loaded module declares, so a
 *     role can never contain a typo that silently grants nothing;
 *   - system roles cannot be renamed, emptied or deleted, so a deployment
 *     always keeps a working way in.
 */

const mongoose = require('mongoose');

const AppError = require('../../../core/errors/AppError');
const BaseRepository = require('../../../core/db/base-repository');
const permissionResolver = require('../../../core/security/permission-resolver');
const auditService = require('../../../core/audit/audit-service');
const permissionSync = require('./permission-sync.service');

let repository = null;

function repo() {
  if (!repository) {
    repository = new BaseRepository(mongoose.model('Role'), {
      sortable: ['createdAt', 'updatedAt', 'code', 'name', 'priority'],
      filterable: ['isActive', 'isSystem'],
      searchable: ['code', 'name', 'description']
    });
  }
  return repository;
}

/**
 * Refuses to let an actor write a role that grants more than they hold.
 *
 * Without this, `/security/roles:edit` and `/security/roles:assign` are each
 * quietly equivalent to super-admin: hold either and you can write yourself a
 * role carrying every permission in the catalogue, or hand yourself the
 * super-admin role outright. The Permission Matrix presents them as two
 * checkboxes among forty, so nobody granting them reads it that way.
 *
 * The rule is the one Kubernetes RBAC uses: you may delegate what you have,
 * and no more. It binds the actor's *effective* permissions, so a super-admin
 * is unaffected - they already hold everything - and an administrator scoped
 * to one area can still manage roles inside it.
 *
 * Skipped entirely when there is no actor: seeds and migrations run as the
 * system and have no permission map to compare against.
 *
 * @param {string|null} actorId
 * @param {Array<{resource: string, actions: string[]}>} grants
 * @param {object} [options]
 * @param {boolean} [options.superAdmin]  The write also confers super-admin.
 */
async function assertCanDelegate(actorId, grants, { superAdmin = false } = {}) {
  if (!actorId) return;

  const User = mongoose.model('User');
  const actor = await User.findOne({ _id: actorId, deletedAt: null }).select('permissionVersion').lean();
  if (!actor) throw AppError.forbidden();

  const permissionMap = await permissionResolver.getPermissionMap(actorId, actor.permissionVersion || 0);
  if (permissionMap.superAdmin) return;

  if (superAdmin) {
    throw AppError.forbidden('Only a super-administrator may create or modify a super-admin role.');
  }

  const missing = [];
  for (const grant of grants || []) {
    for (const action of grant.actions || []) {
      // Policies are deliberately not consulted: they are conditional on the
      // request, and a grant written today outlives the condition that would
      // have allowed it. Only the static grants count as "held".
      const decision = await permissionResolver.can({
        permissionMap,
        resource: grant.resource,
        action,
        policies: []
      });
      if (!decision.allowed) missing.push(`${grant.resource}:${action}`);
    }
  }

  if (missing.length) {
    throw AppError.forbidden(
      'A role cannot grant more than you hold yourself. ' +
        `You do not have: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}.`,
      { missing }
    );
  }
}

async function list(query) {
  const result = await repo().list(query);

  const roleIds = result.items.map((item) => item.id);
  const counts = await countAssignments(roleIds);

  return Object.assign(result, {
    items: result.items.map((item) =>
      Object.assign(item, {
        userCount: counts[item.id] || 0,
        grantCount: (item.grants || []).reduce((total, g) => total + (g.actions || []).length, 0)
      })
    )
  });
}

async function getById(id) {
  const role = await repo().findByIdOrFail(id);
  const counts = await countAssignments([String(id)]);
  return Object.assign(role.toJSON(), { userCount: counts[String(id)] || 0 });
}

async function create(payload, { registry, actorId, req } = {}) {
  const Role = mongoose.model('Role');

  const code = String(payload.code).toUpperCase();
  if (await Role.exists({ code, deletedAt: null })) {
    throw AppError.conflict('A role with this code already exists.', { fields: ['code'] });
  }

  // Exactly one super-admin role. More than one makes "who can do everything"
  // unanswerable at a glance, which is the question an auditor always asks.
  if (payload.isSuperAdmin && (await Role.exists({ isSuperAdmin: true, deletedAt: null }))) {
    throw AppError.conflict('A super-admin role already exists.');
  }

  const problems = permissionSync.validateGrants(registry, payload.grants);
  if (problems.length) throw AppError.validation({ grants: problems });

  await assertCanDelegate(actorId, payload.grants, { superAdmin: Boolean(payload.isSuperAdmin) });

  const role = await Role.create({
    code,
    name: payload.name,
    description: payload.description || '',
    isSuperAdmin: Boolean(payload.isSuperAdmin),
    isSystem: false,
    isActive: payload.isActive !== false,
    grants: payload.grants || [],
    allowedScopes: payload.allowedScopes || ['global'],
    priority: payload.priority || 100,
    createdBy: actorId || null,
    updatedBy: actorId || null
  });

  await auditService.record({
    action: 'role.created',
    category: 'security',
    actorId,
    target: { type: 'role', id: String(role._id), label: role.code },
    metadata: { grantCount: (role.grants || []).length },
    req
  });

  return getById(role._id);
}

async function update(id, payload, { registry, actorId, req } = {}) {
  const role = await repo().findByIdOrFail(id);
  const before = role.toJSON();

  if (role.isSystem) {
    // A system role's grants may be tuned; its identity may not change.
    if (payload.code && payload.code !== role.code) {
      throw AppError.forbidden('A system role cannot be renamed.');
    }
    if (payload.isSuperAdmin !== undefined && payload.isSuperAdmin !== role.isSuperAdmin) {
      throw AppError.forbidden('A system role\'s super-admin flag cannot be changed.');
    }
  }

  if (payload.grants) {
    const problems = permissionSync.validateGrants(registry, payload.grants);
    if (problems.length) throw AppError.validation({ grants: problems });
    await assertCanDelegate(actorId, payload.grants, { superAdmin: role.isSuperAdmin });
    role.grants = payload.grants;
  }

  for (const field of ['name', 'description', 'isActive', 'allowedScopes', 'priority']) {
    if (payload[field] !== undefined) role.set(field, payload[field]);
  }
  role.updatedBy = actorId || null;
  await role.save();

  // Everyone holding this role now has different access.
  await invalidateHolders(id);

  await auditService.recordChange({
    action: 'role.updated',
    category: 'security',
    target: { type: 'role', id: String(role._id), label: role.code },
    before,
    after: role.toJSON(),
    req
  });

  return getById(id);
}

async function remove(id, { actorId, req } = {}) {
  const role = await repo().findByIdOrFail(id);

  if (role.isSystem) throw AppError.forbidden('A system role cannot be deleted.');

  const assigned = await mongoose.model('RoleBinding').countDocuments({ roleId: id, deletedAt: null });
  if (assigned > 0) {
    throw AppError.conflict(`This role is still assigned to ${assigned} user(s). Reassign them first.`, {
      userCount: assigned
    });
  }

  await repo().deleteById(id, { actorId });

  await auditService.record({
    action: 'role.deleted',
    category: 'security',
    actorId,
    target: { type: 'role', id: String(id), label: role.code },
    req
  });
}

/** Users holding a given role. */
async function listMembers(roleId, query) {
  const bindings = await mongoose
    .model('RoleBinding')
    .find({ roleId, deletedAt: null })
    .populate('userId', 'email displayName status')
    .skip((query.page - 1) * query.limit)
    .limit(query.limit)
    .lean();

  const total = await mongoose.model('RoleBinding').countDocuments({ roleId, deletedAt: null });

  return {
    items: bindings
      .filter((binding) => binding.userId)
      .map((binding) => ({
        bindingId: String(binding._id),
        id: String(binding.userId._id),
        email: binding.userId.email,
        displayName: binding.userId.displayName,
        status: binding.userId.status,
        scope: binding.scope,
        expiresAt: binding.expiresAt
      })),
    total,
    page: query.page,
    limit: query.limit
  };
}

async function countAssignments(roleIds) {
  if (!roleIds.length) return {};
  const rows = await mongoose.model('RoleBinding').aggregate([
    { $match: { roleId: { $in: roleIds.map((id) => new mongoose.Types.ObjectId(id)) }, deletedAt: null } },
    { $group: { _id: '$roleId', count: { $sum: 1 } } }
  ]);
  const map = {};
  for (const row of rows) map[String(row._id)] = row.count;
  return map;
}

/**
 * Bumps permissionVersion for every holder of a role, which invalidates their
 * tokens and cached permission maps in one step.
 */
async function invalidateHolders(roleId) {
  const bindings = await mongoose.model('RoleBinding').find({ roleId, deletedAt: null }).select('userId').lean();
  const userIds = bindings.map((binding) => binding.userId);
  if (!userIds.length) return 0;

  await mongoose.model('User').updateMany({ _id: { $in: userIds } }, { $inc: { permissionVersion: 1 } });
  await Promise.all(userIds.map((userId) => permissionResolver.invalidateUser(String(userId))));
  return userIds.length;
}

module.exports = { list, getById, create, update, remove, listMembers, invalidateHolders, assertCanDelegate };
