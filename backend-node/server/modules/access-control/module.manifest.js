'use strict';

/**
 * Access-control module manifest.
 *
 * This single file is the module's entire contract with the platform. Read it
 * to know what the module adds: which routes exist, which permissions it
 * defines, which settings it contributes, where it appears in the navigation,
 * and what runs on boot.
 *
 * The permissions declared here are the source of truth for the whole
 * authorization system - `permission-sync` projects them into MongoDB, the
 * role editor offers them, and `assertResourcesDeclared` fails the boot if a
 * route guards a resource that is missing from this list.
 */

const registerModels = require('./models');
const permissionSync = require('./services/permission-sync.service');
const { assertResourcesDeclared } = require('../../core/security/authorize');

// Actions used across this module. Keeping them as constants makes a typo a
// crash at boot instead of a silent always-deny.
const CRUD = ['view', 'create', 'edit', 'delete'];

module.exports = {
  id: 'access-control',
  name: 'Access Control',
  version: '1.0.0',
  description: 'Identity, authentication, RBAC/ABAC authorization, sessions and audit trail.',
  // Core module - boots before anything that guards a route.
  order: 10,
  dependsOn: [],

  models: registerModels,

  // --- HTTP surface ----------------------------------------------------------
  routes: [
    { basePath: '/auth', router: require('./routes/auth.routes') },
    { basePath: '/users', router: require('./routes/user.routes') },
    { basePath: '/roles', router: require('./routes/role.routes') },
    { basePath: '/permissions', router: require('./routes/permission.routes') },
    { basePath: '/policies', router: require('./routes/policy.routes') },
    { basePath: '/sessions', router: require('./routes/session.routes') },
    { basePath: '/audit', router: require('./routes/audit.routes') }
  ],

  // --- Permission catalogue --------------------------------------------------
  permissions: [
    {
      resource: '/security/users',
      label: 'User accounts',
      description: 'Create, edit and deactivate user accounts.',
      group: 'Security',
      actions: CRUD.concat(['reset-password', 'export'])
    },
    {
      resource: '/security/roles',
      label: 'Roles',
      description: 'Define roles and assign them to users.',
      group: 'Security',
      // `assign` is separate from `edit`: granting someone a role is a bigger
      // decision than renaming one.
      actions: CRUD.concat(['assign']),
      dangerous: true
    },
    {
      resource: '/security/permissions',
      label: 'Permission catalogue',
      description: 'Browse the permissions every module declares.',
      group: 'Security',
      actions: ['view']
    },
    {
      resource: '/security/policies',
      label: 'Access policies',
      description: 'Conditional allow/deny rules layered on top of roles.',
      group: 'Security',
      actions: CRUD,
      dangerous: true
    },
    {
      resource: '/security/sessions',
      label: 'Active sessions',
      description: 'Inspect and revoke sessions across all users.',
      group: 'Security',
      actions: ['view', 'revoke']
    },
    {
      resource: '/security/audit',
      label: 'Audit trail',
      description: 'Read the record of security and configuration changes.',
      group: 'Security',
      actions: ['view', 'export']
    }
  ],

  // --- Settings this module contributes --------------------------------------
  settings: [
    {
      key: 'security.password.minLength',
      group: 'security',
      section: 'password',
      label: 'Minimum password length',
      description: 'Applies to new passwords and administrative resets.',
      type: 'number',
      default: 12,
      min: 8,
      max: 128,
      permission: { resource: '/settings/security', action: 'edit' },
      order: 10
    },
    {
      key: 'security.password.historySize',
      group: 'security',
      section: 'password',
      label: 'Password history',
      description: 'How many previous passwords may not be reused.',
      type: 'number',
      default: 5,
      min: 0,
      max: 24,
      permission: { resource: '/settings/security', action: 'edit' },
      order: 20
    },
    {
      key: 'security.login.maxAttempts',
      group: 'security',
      section: 'lockout',
      label: 'Failed login attempts before lockout',
      type: 'number',
      default: 5,
      min: 3,
      max: 20,
      permission: { resource: '/settings/security', action: 'edit' },
      order: 30
    },
    {
      key: 'security.login.lockoutMinutes',
      group: 'security',
      section: 'lockout',
      label: 'Lockout duration (minutes)',
      type: 'number',
      default: 15,
      min: 1,
      max: 1440,
      permission: { resource: '/settings/security', action: 'edit' },
      order: 40
    },
    {
      key: 'security.session.idleTimeoutMinutes',
      group: 'security',
      section: 'session',
      label: 'Idle timeout (minutes)',
      description: 'A session with no activity for this long must sign in again.',
      type: 'number',
      default: 60,
      min: 5,
      max: 1440,
      permission: { resource: '/settings/security', action: 'edit' },
      order: 50
    },
    // `security.mfa.required` used to sit here, offering a switch labelled
    // "every user must enrol a second factor before signing in". No code read
    // the key, and there is no second factor to enrol: `login()` goes from
    // password verification straight to issuing a session. Turning it on
    // changed nothing and reported success.
    //
    // A control that says it is protecting you and is not is worse than an
    // absent one, because it ends the search. It is removed rather than
    // documented-as-broken; when MFA is implemented (enrolment, TOTP
    // verification between password check and session creation, recovery
    // codes), the setting comes back with the code that honours it.
    //
    // `user.mfa` remains on the model as the shape that enrolment will fill.
    {
      key: 'security.audit.retentionDays',
      group: 'security',
      section: 'audit',
      label: 'Audit retention (days)',
      description: 'Entries older than this are purged by the nightly job.',
      type: 'number',
      default: 365,
      min: 30,
      max: 3650,
      permission: { resource: '/settings/security', action: 'edit' },
      order: 70
    }
  ],

  // --- Navigation ------------------------------------------------------------
  menu: [
    {
      id: 'security',
      label: 'Security',
      labelKey: 'menu.security',
      icon: 'shield',
      order: 900,
      children: [
        {
          id: 'security-users',
          label: 'Users',
          labelKey: 'menu.security.users',
          icon: 'users',
          path: '/security/users',
          permission: { resource: '/security/users', action: 'view' },
          order: 10
        },
        {
          id: 'security-roles',
          label: 'Roles',
          labelKey: 'menu.security.roles',
          icon: 'key',
          path: '/security/roles',
          permission: { resource: '/security/roles', action: 'view' },
          order: 20
        },
        {
          id: 'security-permissions',
          label: 'Permission matrix',
          labelKey: 'menu.security.permissions',
          icon: 'grid',
          path: '/security/permissions',
          permission: { resource: '/security/permissions', action: 'view' },
          order: 30
        },
        {
          id: 'security-policies',
          label: 'Policies',
          labelKey: 'menu.security.policies',
          icon: 'filter',
          path: '/security/policies',
          permission: { resource: '/security/policies', action: 'view' },
          order: 40
        },
        {
          id: 'security-sessions',
          label: 'Sessions',
          labelKey: 'menu.security.sessions',
          icon: 'monitor',
          path: '/security/sessions',
          permission: { resource: '/security/sessions', action: 'view' },
          order: 50
        },
        {
          id: 'security-audit',
          label: 'Audit trail',
          labelKey: 'menu.security.audit',
          icon: 'list',
          path: '/security/audit',
          permission: { resource: '/security/audit', action: 'view' },
          order: 60
        }
      ]
    }
  ],

  // --- Scheduled work --------------------------------------------------------
  jobs: [
    {
      id: 'audit-retention',
      schedule: '0 3 * * *',
      description: 'Purges audit entries older than security.audit.retentionDays.',
      handler: require('./jobs/audit-retention.job')
    },
    {
      id: 'expire-role-bindings',
      schedule: '*/15 * * * *',
      description: 'Revokes role bindings whose expiry has passed.',
      handler: require('./jobs/expire-role-bindings.job')
    }
  ],

  // --- Seed data -------------------------------------------------------------
  seeds: [
    {
      id: 'baseline-roles',
      order: 10,
      description: 'System roles and the bootstrap administrator.',
      handler: require('./seeds/baseline.seed')
    }
  ],

  // --- Lifecycle -------------------------------------------------------------
  hooks: {
    /**
     * Runs before routes are mounted. The permission catalogue must exist in
     * the database before anything can read it.
     */
    async onBoot({ registry, app }) {
      // Controllers reach the registry through the app, which keeps them from
      // importing the kernel and creating a cycle.
      app.set('moduleRegistry', registry);
      await permissionSync.sync(registry);
    },

    /**
     * Runs after every module has registered. Verifies that each resource
     * guarding a route was actually declared - catching a typo here rather
     * than at the moment someone is wrongly denied.
     */
    async onReady({ registry }) {
      assertResourcesDeclared(registry, [
        '/security/users',
        '/security/roles',
        '/security/permissions',
        '/security/policies',
        '/security/sessions',
        '/security/audit'
      ]);
    }
  }
};
