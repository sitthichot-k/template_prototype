'use strict';

/**
 * Revokes role bindings whose expiry has passed.
 *
 * Time-boxed access is only meaningful if something actually removes it, and
 * removing it must also bump the holder's permission version so their current
 * tokens stop working.
 */

const mongoose = require('mongoose');
const permissionResolver = require('../../../core/security/permission-resolver');
const auditService = require('../../../core/audit/audit-service');
const logger = require('../../../../config/logger').forModule('role-expiry');

module.exports = async function expireRoleBindingsJob() {
  const RoleBinding = mongoose.model('RoleBinding');
  const now = new Date();

  const expired = await RoleBinding.find({
    expiresAt: { $ne: null, $lte: now },
    deletedAt: null
  })
    .select('userId roleId scope')
    .lean();

  if (!expired.length) return { expired: 0 };

  await RoleBinding.updateMany(
    { _id: { $in: expired.map((binding) => binding._id) } },
    { $set: { deletedAt: now } }
  );

  const userIds = Array.from(new Set(expired.map((binding) => String(binding.userId))));
  await mongoose.model('User').updateMany({ _id: { $in: userIds } }, { $inc: { permissionVersion: 1 } });
  await Promise.all(userIds.map((userId) => permissionResolver.invalidateUser(userId)));

  for (const binding of expired) {
    await auditService.record({
      action: 'user.roles.expired',
      category: 'security',
      actorLabel: 'system',
      target: { type: 'user', id: String(binding.userId) },
      metadata: { roleId: String(binding.roleId), scope: binding.scope }
    });
  }

  logger.info({ expired: expired.length, users: userIds.length }, 'Expired role bindings revoked');
  return { expired: expired.length };
};
