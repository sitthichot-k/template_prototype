'use strict';

/**
 * Baseline access-control data.
 *
 * Idempotent: safe to run on every deploy. It creates the system roles and,
 * only when the database has no users at all, the bootstrap administrator.
 *
 * The bootstrap password is never hard-coded. It comes from BOOTSTRAP_ADMIN_PASSWORD
 * or is generated and printed once - a template that ships with a known
 * default administrator password is a template that ships with a backdoor.
 */

const mongoose = require('mongoose');
const config = require('../../../../config');
const crypto = require('../../../core/security/crypto');
const logger = require('../../../../config/logger').forModule('seed:access-control');

/**
 * System roles. `grants: '*'` is expanded to every permission in the
 * catalogue at seed time, so ADMINISTRATOR stays correct as modules are added.
 */
const SYSTEM_ROLES = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super administrator',
    description: 'Unrestricted access. Reserved for break-glass use.',
    isSuperAdmin: true,
    priority: 1000,
    grants: []
  },
  {
    code: 'ADMINISTRATOR',
    name: 'Administrator',
    description: 'Full access to every permission the loaded modules declare.',
    isSuperAdmin: false,
    priority: 900,
    grants: '*'
  },
  {
    code: 'SECURITY_OFFICER',
    name: 'Security officer',
    description: 'Manages users, roles and reviews the audit trail.',
    priority: 800,
    grants: [
      { resource: '/security/users', actions: ['view', 'create', 'edit', 'reset-password'] },
      { resource: '/security/roles', actions: ['view', 'assign'] },
      { resource: '/security/permissions', actions: ['view'] },
      { resource: '/security/sessions', actions: ['view', 'revoke'] },
      { resource: '/security/audit', actions: ['view', 'export'] },
      { resource: '/settings/security', actions: ['view'] }
    ]
  },
  {
    code: 'VIEWER',
    name: 'Viewer',
    description: 'Read-only access to operational screens.',
    priority: 100,
    grants: []
  }
];

module.exports = async function seedAccessControl({ registry }) {
  const Role = mongoose.model('Role');
  const User = mongoose.model('User');
  const RoleBinding = mongoose.model('RoleBinding');

  const catalogue = registry.listPermissions();
  const allGrants = catalogue.map((entry) => ({ resource: entry.resource, actions: entry.actions.slice() }));

  const created = [];

  for (const definition of SYSTEM_ROLES) {
    const grants = definition.grants === '*' ? allGrants : definition.grants;

    const existing = await Role.findOne({ code: definition.code });
    if (existing) {
      // Keep ADMINISTRATOR in step with newly added modules, but never
      // overwrite grants an operator has deliberately narrowed on other roles.
      if (definition.grants === '*') {
        existing.grants = grants;
        await existing.save();
      }
      continue;
    }

    const role = await Role.create({
      code: definition.code,
      name: definition.name,
      description: definition.description,
      isSuperAdmin: Boolean(definition.isSuperAdmin),
      isSystem: true,
      isActive: true,
      priority: definition.priority,
      grants
    });
    created.push(role.code);
  }

  if (created.length) logger.info({ roles: created }, 'System roles created');

  // --- Bootstrap administrator ------------------------------------------------
  const userCount = await User.countDocuments({});
  if (userCount > 0) {
    logger.info('Users already exist - skipping bootstrap administrator');
    return { roles: created, bootstrapAdmin: null };
  }

  const email = config.bootstrap.adminEmail;
  const generated = !config.bootstrap.adminPassword;
  // A generated password still satisfies the policy: length, case, digit, symbol.
  const password = config.bootstrap.adminPassword || `${crypto.randomToken(12)}Aa1!`;

  const admin = await User.create({
    email,
    displayName: config.bootstrap.adminName,
    passwordHash: await crypto.hashPassword(password),
    passwordChangedAt: new Date(),
    // Forced regardless of source: the seeding operator has seen this value.
    mustChangePassword: true,
    status: 'active'
  });

  const superAdminRole = await Role.findOne({ code: 'SUPER_ADMIN' });
  await RoleBinding.create({
    userId: admin._id,
    roleId: superAdminRole._id,
    scope: 'global',
    reason: 'Bootstrap administrator created by the baseline seed.'
  });

  // Printed to stdout rather than the structured log so it is not shipped to
  // a log aggregator along with everything else.
  /* eslint-disable no-console */
  console.log('\n' + '='.repeat(68));
  console.log('  BOOTSTRAP ADMINISTRATOR CREATED');
  console.log('='.repeat(68));
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${generated ? password : '(from BOOTSTRAP_ADMIN_PASSWORD)'}`);
  console.log('  This password must be changed at first sign-in.');
  console.log('='.repeat(68) + '\n');
  /* eslint-enable no-console */

  return { roles: created, bootstrapAdmin: email };
};
