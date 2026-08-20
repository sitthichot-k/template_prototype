'use strict';

/**
 * Registers every access-control model with mongoose.
 *
 * Called by the module manifest's `models` hook, before any route is mounted,
 * so `mongoose.model('User')` resolves anywhere in the process afterwards.
 */

module.exports = function registerModels() {
  return {
    User: require('./user.model'),
    Role: require('./role.model'),
    Permission: require('./permission.model'),
    RoleBinding: require('./role-binding.model'),
    Policy: require('./policy.model'),
    Session: require('./session.model'),
    AuditLog: require('./audit-log.model')
  };
};
