'use strict';

/**
 * The bootstrap contract - one call that tells a frontend everything it needs
 * to render itself.
 *
 *   GET /api/v1/platform/bootstrap
 *   {
 *     user, permissions, menu, settings, features, modules, server
 *   }
 *
 * This endpoint is why the Vue and React frontends can stay behaviourally
 * identical without sharing code: navigation, visible actions, branding and
 * feature flags all arrive as data. A new module appears in both UIs with no
 * frontend change at all.
 */

const asyncHandler = require('../../../core/http/async-handler');
const response = require('../../../core/http/response');
const config = require('../../../../config');
const settingsService = require('../../../core/settings/settings-service');
const permissionResolver = require('../../../core/security/permission-resolver');
const { loadPermissionMap } = require('../../../core/security/authenticate');
const userService = require('../../access-control/services/user.service');

/**
 * Setting groups every signed-in client receives.
 *
 * Bootstrap is sent to everyone with a session, so its settings block is a
 * publication, not a query - whatever goes in is readable by the least
 * privileged account in the system. It used to carry every setting the
 * platform declares, which meant the operator's mail and security
 * configuration travelled to every user on every page load.
 *
 * These four groups are the ones the frontend actually renders from: branding
 * and general drive the shell, localization the locale, features the flags.
 * Everything else - mail, observability, security - is operator configuration
 * and is read through `/settings/*`, which checks permissions per key.
 *
 * The list is deliberately here, in one place, rather than a flag on each of
 * thirty-six descriptors: a security boundary is easier to review when it is
 * one line than when it is spread across every manifest, where a copied
 * `clientVisible: true` would never be noticed.
 */
const CLIENT_SETTING_GROUPS = new Set(['general', 'branding', 'localization', 'features']);

/**
 * Filters the navigation tree against the caller's permissions.
 *
 * A branch whose children are all hidden is removed too, so an empty section
 * header never appears in the sidebar.
 */
function filterMenu(nodes, isAllowed) {
  const visible = [];

  for (const node of nodes) {
    const children = node.children ? filterMenu(node.children, isAllowed) : [];

    // A node with declared children is a container: it survives only if
    // something inside it survived.
    if (node.children && node.children.length) {
      if (children.length) visible.push(Object.assign({}, node, { children }));
      continue;
    }

    if (!node.permission || isAllowed(node.permission.resource, node.permission.action)) {
      visible.push(Object.assign({}, node, { children: undefined }));
    }
  }

  return visible;
}

const bootstrap = asyncHandler(async (req, res) => {
  const registry = req.app.get('moduleRegistry');
  const permissionMap = await loadPermissionMap(req);
  const catalogue = registry.listPermissions();

  const permissions = permissionResolver.toClientShape(permissionMap, catalogue);

  const isAllowed = (resource, action) => {
    if (permissionMap.superAdmin) return true;
    const actions = permissions[resource];
    return Boolean(actions && (actions.includes(action) || actions.includes('*')));
  };

  const [user, resolved] = await Promise.all([
    userService.getById(req.auth.userId),
    settingsService.getAll({ userId: req.auth.userId })
  ]);

  const settings = {};
  for (const [key, value] of Object.entries(resolved)) {
    const descriptor = registry.getSetting(key);
    if (descriptor && CLIENT_SETTING_GROUPS.has(descriptor.group)) settings[key] = value;
  }

  // Feature flags are surfaced separately from settings so the frontend can
  // gate on them without knowing the settings key layout.
  const features = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith('features.')) features[key.slice('features.'.length)] = value;
  }

  return response.ok(res, {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      roles: user.roles,
      profile: user.profile,
      mustChangePassword: user.mustChangePassword
    },
    permissions: {
      superAdmin: permissionMap.superAdmin,
      roles: permissionMap.roles,
      scopes: permissionMap.scopes,
      granted: permissions
    },
    menu: filterMenu(registry.getMenuTree(), isAllowed),
    settings,
    features,
    modules: registry.listModuleIds(),
    server: {
      appName: settings['general.appName'] || config.project.name,
      version: config.project.version,
      environment: config.env.appEnv,
      apiPrefix: config.http.apiPrefix,
      time: new Date().toISOString()
    }
  });
});

/** Module inventory - what is loaded and what each module contributes. */
const modules = asyncHandler(async (req, res) => {
  return response.ok(res, req.app.get('moduleRegistry').describe());
});

/** Public deployment facts, safe before sign-in (branding on the login page). */
const info = asyncHandler(async (req, res) => {
  const appName = await settingsService.get('general.appName');
  const [organizationName, supportEmail, primaryColor, logoUrl, defaultLocale, maintenanceMode, maintenanceMessage] =
    await Promise.all([
      settingsService.get('general.organizationName'),
      settingsService.get('general.supportEmail'),
      settingsService.get('branding.primaryColor'),
      settingsService.get('branding.logoUrl'),
      settingsService.get('localization.defaultLocale'),
      settingsService.get('general.maintenanceMode'),
      settingsService.get('general.maintenanceMessage')
    ]);

  return response.ok(res, {
    appName,
    // Both were settings nothing read. The login screen is where they belong:
    // whose system this is, and who to write to when you cannot get into it.
    organizationName,
    supportEmail,
    branding: { primaryColor, logoUrl },
    defaultLocale,
    maintenance: { enabled: maintenanceMode, message: maintenanceMode ? maintenanceMessage : '' },
    // Version is deliberately omitted: it is fingerprinting data and the
    // login page has no use for it.
    environment: config.env.isProduction ? undefined : config.env.appEnv
  });
});

module.exports = { bootstrap, modules, info };
