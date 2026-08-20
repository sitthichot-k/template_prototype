'use strict';

/**
 * User lifecycle and role assignment.
 *
 * Every operation that changes what a person can do ends with the same two
 * steps: bump `permissionVersion` and invalidate the cached permission map.
 * Doing that in one place is what makes "access revoked" take effect on the
 * next request instead of whenever the current token happens to expire.
 */

const mongoose = require('mongoose');

const config = require('../../../../config');
const AppError = require('../../../core/errors/AppError');
const BaseRepository = require('../../../core/db/base-repository');
const crypto = require('../../../core/security/crypto');
const permissionResolver = require('../../../core/security/permission-resolver');
const settingsService = require('../../../core/settings/settings-service');
const mailService = require('../../../core/mail/mail-service');
const auditService = require('../../../core/audit/audit-service');
const authService = require('./auth.service');
const roleService = require('./role.service');

let repository = null;

function repo() {
  if (!repository) {
    repository = new BaseRepository(mongoose.model('User'), {
      sortable: ['createdAt', 'updatedAt', 'email', 'displayName', 'status', 'lastLoginAt'],
      filterable: ['status', 'profile.department'],
      searchable: ['email', 'username', 'displayName', 'profile.department']
    });
  }
  return repository;
}

async function list(query) {
  const result = await repo().list(query);

  // Roles are joined here rather than denormalised onto the user, so a role
  // rename never leaves stale copies behind.
  const userIds = result.items.map((item) => item.id);
  const roleMap = await loadRoleMap(userIds);

  return Object.assign(result, {
    items: result.items.map((item) => Object.assign(item, { roles: roleMap[item.id] || [] }))
  });
}

async function getById(id) {
  const user = await repo().findByIdOrFail(id);
  const roleMap = await loadRoleMap([id]);
  const bindings = await mongoose
    .model('RoleBinding')
    .find({ userId: id, deletedAt: null })
    .populate('roleId', 'code name')
    .lean();

  return Object.assign(user.toJSON(), {
    roles: roleMap[String(id)] || [],
    roleBindings: bindings.map((binding) => ({
      id: String(binding._id),
      role: binding.roleId ? { id: String(binding.roleId._id), code: binding.roleId.code, name: binding.roleId.name } : null,
      scope: binding.scope,
      scopeId: binding.scopeId ? String(binding.scopeId) : null,
      expiresAt: binding.expiresAt
    }))
  });
}

/**
 * Creates a user. A password is optional: when omitted the account is created
 * `pending` and must be activated through an invitation, which is the safer
 * default for administrator-created accounts.
 */
async function create(payload, { actorId, req } = {}) {
  const User = mongoose.model('User');

  const email = String(payload.email).toLowerCase().trim();
  if (await User.exists({ email, deletedAt: null })) {
    throw AppError.conflict('An account with this email already exists.', { fields: ['email'] });
  }

  const user = new User({
    email,
    username: payload.username || null,
    displayName: payload.displayName,
    status: payload.password ? 'active' : 'pending',
    mustChangePassword: Boolean(payload.password && payload.mustChangePassword),
    profile: payload.profile || {},
    attributes: payload.attributes || {},
    createdBy: actorId || null,
    updatedBy: actorId || null
  });

  if (payload.password) {
    await assertPasswordPolicy(payload.password);
    user.passwordHash = await crypto.hashPassword(payload.password);
    user.passwordChangedAt = new Date();
  }

  await user.save();

  if (payload.roleIds && payload.roleIds.length) {
    await assignRoles(user._id, payload.roleIds, { actorId, req });
  }

  await auditService.record({
    action: 'user.created',
    category: 'security',
    actorId,
    target: { type: 'user', id: String(user._id), label: user.email },
    metadata: { status: user.status },
    req
  });

  return getById(user._id);
}

async function update(id, payload, { actorId, req } = {}) {
  const user = await repo().findByIdOrFail(id);
  const before = user.toJSON();

  // Email and status changes go through their own paths so they are audited
  // distinctly and cannot be smuggled in through a general profile edit.
  const allowed = ['displayName', 'username', 'profile', 'attributes'];
  for (const field of allowed) {
    if (payload[field] !== undefined) user.set(field, payload[field]);
  }
  user.updatedBy = actorId || null;
  await user.save();

  await auditService.recordChange({
    action: 'user.updated',
    category: 'security',
    target: { type: 'user', id: String(user._id), label: user.email },
    before,
    after: user.toJSON(),
    req
  });

  return getById(id);
}

/**
 * Changes lifecycle state. Suspending or disabling an account immediately
 * revokes every session - an account that is "disabled" but still holds a
 * valid token is not disabled.
 */
async function changeStatus(id, status, { actorId, req, reason } = {}) {
  const user = await repo().findByIdOrFail(id);
  const previous = user.status;

  if (previous === status) return getById(id);

  user.status = status;
  user.bumpPermissionVersion();
  user.updatedBy = actorId || null;
  await user.save();

  if (status !== 'active') {
    await authService.revokeAllForUser(user._id, 'admin');
  }
  await permissionResolver.invalidateUser(String(user._id));

  await auditService.record({
    action: `user.status.${status}`,
    category: 'security',
    actorId,
    target: { type: 'user', id: String(user._id), label: user.email },
    metadata: { from: previous, to: status, reason: reason || '' },
    req
  });

  return getById(id);
}

async function remove(id, { actorId, req } = {}) {
  const user = await repo().findByIdOrFail(id);

  await repo().deleteById(id, { actorId });
  await mongoose.model('RoleBinding').updateMany({ userId: id }, { $set: { deletedAt: new Date(), deletedBy: actorId } });
  await authService.revokeAllForUser(id, 'admin');
  await permissionResolver.invalidateUser(String(id));

  await auditService.record({
    action: 'user.deleted',
    category: 'security',
    actorId,
    target: { type: 'user', id: String(id), label: user.email },
    req
  });
}

// --- Roles -------------------------------------------------------------------

/**
 * Replaces a user's role bindings with the given set.
 *
 * @param {string} userId
 * @param {string[]} roleIds
 */
async function assignRoles(userId, roleIds, { actorId, req, scope = 'global', scopeId = null } = {}) {
  const RoleBinding = mongoose.model('RoleBinding');
  const Role = mongoose.model('Role');
  const User = mongoose.model('User');

  const roles = await Role.find({ _id: { $in: roleIds }, deletedAt: null, isActive: true })
    .select('code name isSuperAdmin allowedScopes grants')
    .lean();
  if (roles.length !== roleIds.length) {
    throw AppError.badRequest('One or more roles do not exist or are inactive.');
  }

  // The same rule role editing enforces, applied to the other route to the
  // same place: `roles:assign` without this is super-admin, because the
  // super-admin role is just another row to hand yourself. Writing a role you
  // could not write is blocked in `role.service`; granting one is blocked
  // here. Only self-assignment is checked - handing someone else a role you do
  // not hold is delegation an administrator is expected to do.
  const grantingToSelf = String(userId) === String(actorId || '');
  if (grantingToSelf) {
    for (const role of roles) {
      await roleService.assertCanDelegate(actorId, role.grants, { superAdmin: Boolean(role.isSuperAdmin) });
    }
  }

  // A role may declare which scopes it is allowed to be granted in. The field
  // existed and was editable but was never read, so the constraint an
  // administrator set was silently ignored.
  const outOfScope = roles.filter((role) => !(role.allowedScopes || ['global']).includes(scope));
  if (outOfScope.length) {
    throw AppError.badRequest(
      `These roles may not be granted in the "${scope}" scope: ${outOfScope.map((r) => r.code).join(', ')}.`,
      { fields: ['scope'] }
    );
  }

  // Fail closed on a scope that decides nothing.
  //
  // A binding carries `scope`/`scopeId`, the resolver collects them into
  // `permissionMap.scopes`, and the comment there promises services will use
  // them to narrow queries - but nothing in this template reads them. So a
  // role granted as "editor for department X" resolved to editor everywhere,
  // while every screen reported the narrower grant. Silently widening access
  // is the worst way to be incomplete, so the narrower form is refused until a
  // project actually implements it: see the scope note in `permission-resolver`
  // and apply the binding's scopeId as a filter in the services it should
  // narrow, then relax this check.
  if (scope !== 'global') {
    throw AppError.badRequest(
      `Scoped role bindings are not enforced by this platform - granting "${scope}" would take effect globally. ` +
        'Narrow the access in the owning service first, then remove this guard.',
      { fields: ['scope'] }
    );
  }

  const existing = await RoleBinding.find({ userId, scope, scopeId, deletedAt: null }).select('roleId').lean();
  const existingIds = existing.map((binding) => String(binding.roleId));
  const targetIds = roleIds.map(String);

  const toAdd = targetIds.filter((roleId) => !existingIds.includes(roleId));
  const toRemove = existingIds.filter((roleId) => !targetIds.includes(roleId));

  if (toAdd.length) {
    await RoleBinding.insertMany(
      toAdd.map((roleId) => ({
        userId,
        roleId,
        scope,
        scopeId,
        grantedBy: actorId || null,
        grantedAt: new Date()
      })),
      { ordered: false }
    );
  }

  if (toRemove.length) {
    await RoleBinding.updateMany(
      { userId, roleId: { $in: toRemove }, scope, scopeId, deletedAt: null },
      { $set: { deletedAt: new Date(), deletedBy: actorId || null } }
    );
  }

  if (toAdd.length || toRemove.length) {
    await User.updateOne({ _id: userId }, { $inc: { permissionVersion: 1 } });
    await permissionResolver.invalidateUser(String(userId));

    await auditService.record({
      action: 'user.roles.changed',
      category: 'security',
      actorId,
      target: { type: 'user', id: String(userId) },
      metadata: {
        added: roles.filter((r) => toAdd.includes(String(r._id))).map((r) => r.code),
        removed: toRemove,
        scope
      },
      req
    });
  }

  return { added: toAdd.length, removed: toRemove.length };
}

/** Effective permissions for a user, in the shape the frontends consume. */
async function getEffectivePermissions(userId, registry) {
  const user = await repo().findByIdOrFail(userId);
  const map = await permissionResolver.getPermissionMap(String(user._id), user.permissionVersion || 0);
  return {
    superAdmin: map.superAdmin,
    roles: map.roles,
    permissions: permissionResolver.toClientShape(map, registry.listPermissions())
  };
}

// --- Passwords ---------------------------------------------------------------

/**
 * The length comes from the settings screen, falling back to the environment
 * value. It used to read `config` alone, which meant the "Minimum password
 * length" control an administrator could see and change decided nothing.
 */
async function assertPasswordPolicy(password) {
  const errors = [];
  const minLength = await settingsService.getOr('security.password.minLength', config.auth.password.minLength);

  if (!password || password.length < minLength) errors.push(`Must be at least ${minLength} characters.`);
  if (!/[a-z]/.test(password)) errors.push('Must contain a lowercase letter.');
  if (!/[A-Z]/.test(password)) errors.push('Must contain an uppercase letter.');
  if (!/\d/.test(password)) errors.push('Must contain a digit.');
  if (!/[^\w\s]/.test(password)) errors.push('Must contain a symbol.');

  if (errors.length) throw AppError.validation({ password: errors }, 'Password does not meet the policy.');
}

/**
 * Self-service password change. Requires the current password, reuse-checks
 * against history, and signs out every other device.
 */
async function changePassword(userId, { currentPassword, newPassword }, { req } = {}) {
  const User = mongoose.model('User');
  const user = await User.findOne({ _id: userId, deletedAt: null }).select('+passwordHash +passwordHistory');
  if (!user) throw AppError.notFound('User');

  if (!(await crypto.verifyPassword(user.passwordHash, currentPassword))) {
    await auditService.record({
      action: 'user.password.change',
      category: 'security',
      outcome: 'failure',
      actorId: String(userId),
      req
    });
    throw AppError.unauthenticated('Current password is incorrect.', 'INVALID_CREDENTIALS');
  }

  await assertPasswordPolicy(newPassword);

  for (const previous of user.passwordHistory || []) {
    if (await crypto.verifyPassword(previous, newPassword)) {
      throw AppError.validation({ newPassword: ['This password was used recently.'] });
    }
  }

  const historySize = await settingsService.getOr('security.password.historySize', config.auth.password.historySize);
  const history = [user.passwordHash].concat(user.passwordHistory || []).filter(Boolean);
  user.passwordHistory = history.slice(0, historySize);
  user.passwordHash = await crypto.hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = false;
  await user.save();

  await authService.revokeAllForUser(userId, 'password-changed');

  await notifyPasswordChanged(user, {
    subject: 'Your password was changed',
    text:
      `Hello ${user.displayName || ''},\n\n` +
      'The password on your account was just changed, and every other device ' +
      'has been signed out.\n\n' +
      'If this was not you, contact an administrator immediately - whoever ' +
      'made the change knew your previous password.\n'
  });

  await auditService.record({
    action: 'user.password.change',
    category: 'security',
    actorId: String(userId),
    req
  });
}

/**
 * "Your password changed" is the one notification worth sending even when a
 * deployment sends no other mail: it is how someone finds out their account
 * was taken over. Never awaited for its result - `send` already resolves on
 * failure, and the password has changed regardless of whether SMTP answered.
 */
async function notifyPasswordChanged(user, { subject, text }) {
  if (!user || !user.email) return;
  await mailService.send({ to: user.email, subject, text });
}

/** Administrative reset. Forces a change on next login. */
async function resetPassword(userId, newPassword, { actorId, req } = {}) {
  await assertPasswordPolicy(newPassword);

  const User = mongoose.model('User');
  const user = await User.findOne({ _id: userId, deletedAt: null }).select('+passwordHash email');
  if (!user) throw AppError.notFound('User');

  user.passwordHash = await crypto.hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = true;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  await authService.revokeAllForUser(userId, 'password-changed');

  await notifyPasswordChanged(user, {
    subject: 'Your password was reset by an administrator',
    text:
      `Hello ${user.displayName || ''},\n\n` +
      'An administrator has reset the password on your account. Every device ' +
      'has been signed out, and you will be asked to choose a new password the ' +
      'next time you sign in.\n\n' +
      'If you did not expect this, contact an administrator.\n'
  });

  await auditService.record({
    action: 'user.password.reset',
    category: 'security',
    actorId,
    target: { type: 'user', id: String(userId), label: user.email },
    req
  });
}

// --- Helpers -----------------------------------------------------------------

async function loadRoleMap(userIds) {
  if (!userIds.length) return {};

  const bindings = await mongoose
    .model('RoleBinding')
    .find({ userId: { $in: userIds }, deletedAt: null })
    .populate('roleId', 'code name')
    .lean();

  const map = {};
  for (const binding of bindings) {
    if (!binding.roleId) continue;
    const key = String(binding.userId);
    if (!map[key]) map[key] = [];
    map[key].push({ id: String(binding.roleId._id), code: binding.roleId.code, name: binding.roleId.name });
  }
  return map;
}

module.exports = {
  list,
  getById,
  create,
  update,
  changeStatus,
  remove,
  assignRoles,
  getEffectivePermissions,
  changePassword,
  resetPassword,
  assertPasswordPolicy
};
