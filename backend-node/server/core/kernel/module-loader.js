'use strict';

/**
 * Discovers, validates, orders and boots feature modules.
 *
 * Discovery is a filesystem scan of `server/modules/*` for a
 * `module.manifest.js`. Dropping a folder in adds its routes, permissions,
 * settings, menu entries, jobs and seeds - there is no central list to edit,
 * which is the property that makes the template extensible without touching
 * platform code.
 */

const fs = require('fs');
const path = require('path');
const Joi = require('joi');

const AppError = require('../errors/AppError');
const config = require('../../../config');
const logger = require('../../../config/logger').forModule('kernel');
const { descriptorSchema } = require('../settings/setting-descriptor');

const MODULES_DIR = path.join(__dirname, '..', '..', 'modules');
const MANIFEST_FILE = 'module.manifest.js';

const permissionSchema = Joi.object({
  resource: Joi.string()
    .pattern(/^\/[a-z0-9\-/]*$/)
    .required()
    .messages({ 'string.pattern.base': 'resource must be a lowercase slash path, e.g. /security/users' }),
  label: Joi.string().required(),
  description: Joi.string().allow('').default(''),
  group: Joi.string().optional(),
  actions: Joi.array().items(Joi.string().pattern(/^[a-z][a-z0-9-]*$/)).min(1).required(),
  dangerous: Joi.boolean().default(false)
});

const menuItemSchema = Joi.object({
  id: Joi.string().required(),
  label: Joi.string().required(),
  labelKey: Joi.string().optional(),
  icon: Joi.string().allow('').default(''),
  path: Joi.string().allow('').default(''),
  order: Joi.number().default(999),
  badge: Joi.string().allow('').optional(),
  // A menu item is visible only when the viewer holds this permission.
  // Omitting it makes the item public to any authenticated user.
  permission: Joi.object({
    resource: Joi.string().required(),
    action: Joi.string().default('view')
  }).optional(),
  children: Joi.array().items(Joi.link('#menuItem')).optional()
}).id('menuItem');

const manifestSchema = Joi.object({
  id: Joi.string().pattern(/^[a-z][a-z0-9-]*$/).required(),
  name: Joi.string().required(),
  version: Joi.string().default('1.0.0'),
  description: Joi.string().allow('').default(''),
  // Lower boots first. Core modules occupy 0-99; feature modules start at 100.
  order: Joi.number().default(100),
  enabled: Joi.boolean().default(true),
  dependsOn: Joi.array().items(Joi.string()).default([]),

  routes: Joi.array()
    .items(
      Joi.object({
        basePath: Joi.string().pattern(/^\//).required(),
        router: Joi.function().required(),
        meta: Joi.object().default({})
      })
    )
    .default([]),

  models: Joi.function().optional(),
  permissions: Joi.array().items(permissionSchema).default([]),
  // Validated with the full descriptor schema here, not merely as "an object".
  // Defaults such as `scopes: ['global']` are applied centrally so a module
  // author cannot omit them: relying on each manifest to call
  // validateDescriptor itself meant one module's settings reached the registry
  // half-formed, and only failed later inside the settings resolver.
  settings: Joi.array().items(descriptorSchema).default([]),
  menu: Joi.array().items(menuItemSchema).default([]),
  jobs: Joi.array().items(Joi.object()).default([]),
  seeds: Joi.array().items(Joi.object()).default([]),

  hooks: Joi.object({
    onBoot: Joi.function().optional(),
    onReady: Joi.function().optional(),
    onShutdown: Joi.function().optional()
  }).default({})
}).unknown(false);

/**
 * @param {string} dir
 * @returns {string[]} absolute paths of module directories containing a manifest
 */
function discoverModuleDirs(dir = MODULES_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
    .map((entry) => path.join(dir, entry.name))
    .filter((modulePath) => fs.existsSync(path.join(modulePath, MANIFEST_FILE)));
}

function loadManifest(modulePath) {
  const manifestPath = path.join(modulePath, MANIFEST_FILE);
  // eslint-disable-next-line global-require
  const raw = require(manifestPath);

  const { value, error } = manifestSchema.validate(raw, { abortEarly: false });
  if (error) {
    const details = error.details.map((d) => `    - ${d.message}`).join('\n');
    throw AppError.internal(`Invalid module manifest at ${manifestPath}:\n${details}`);
  }

  value.__path = modulePath;
  return value;
}

/**
 * MODULES_ENABLED acts as an allowlist when non-empty; MODULES_DISABLED always
 * wins. This lets a tier switch a module off without a code change.
 */
function isEnabled(manifest) {
  if (!manifest.enabled) return false;
  if (config.modules.disabled.includes(manifest.id)) return false;
  if (config.modules.enabled.length > 0) return config.modules.enabled.includes(manifest.id);
  return true;
}

/**
 * Orders modules so dependencies boot first, then by declared `order`.
 * Throws on a cycle rather than booting in an arbitrary order.
 */
function resolveBootOrder(manifests) {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const resolved = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(manifest, chain) {
    if (visited.has(manifest.id)) return;
    if (visiting.has(manifest.id)) {
      throw AppError.internal(`Circular module dependency: ${chain.concat(manifest.id).join(' -> ')}`);
    }
    visiting.add(manifest.id);

    for (const depId of manifest.dependsOn) {
      const dep = byId.get(depId);
      if (!dep) {
        throw AppError.internal(`Module "${manifest.id}" depends on "${depId}", which is not loaded.`);
      }
      visit(dep, chain.concat(manifest.id));
    }

    visiting.delete(manifest.id);
    visited.add(manifest.id);
    resolved.push(manifest);
  }

  for (const manifest of manifests.slice().sort((a, b) => a.order - b.order)) {
    visit(manifest, []);
  }
  return resolved;
}

/**
 * Loads every enabled module into the registry.
 *
 * @param {import('./module-registry')} registry
 * @returns {Promise<object[]>} the booted manifests, in boot order
 */
async function loadModules(registry) {
  const dirs = discoverModuleDirs();
  const discovered = dirs.map(loadManifest);
  const enabled = discovered.filter(isEnabled);

  const skipped = discovered.filter((m) => !enabled.includes(m)).map((m) => m.id);
  if (skipped.length) logger.info({ skipped }, 'Modules skipped by configuration');

  const ordered = resolveBootOrder(enabled);

  for (const manifest of ordered) {
    registry.registerModule(manifest);

    // Models are registered before anything that might query them.
    if (manifest.models) await manifest.models();

    for (const route of manifest.routes) registry.registerRoute(manifest.id, route);
    for (const permission of manifest.permissions) registry.registerPermission(manifest.id, permission);
    for (const setting of manifest.settings) registry.registerSetting(manifest.id, setting);
    for (const job of manifest.jobs) registry.registerJob(manifest.id, job);
    for (const seed of manifest.seeds) registry.registerSeed(manifest.id, seed);
    if (manifest.menu.length) registry.registerMenuItems(manifest.id, manifest.menu);

    logger.debug({ module: manifest.id, version: manifest.version }, 'Module registered');
  }

  logger.info({ modules: ordered.map((m) => m.id) }, `Loaded ${ordered.length} module(s)`);
  return ordered;
}

module.exports = {
  loadModules,
  discoverModuleDirs,
  loadManifest,
  resolveBootOrder,
  manifestSchema,
  MODULES_DIR,
  MANIFEST_FILE
};
