'use strict';

/**
 * In-memory registry of everything the loaded modules contribute.
 *
 * This is the object that makes the platform introspectable at runtime: the
 * permission catalogue, the settings catalogue and the navigation tree are
 * all read back out of here rather than being maintained as separate lists
 * that drift from the code. A module is the only place a capability is
 * declared; the registry is the only place it is collected.
 */

const AppError = require('../errors/AppError');

class ModuleRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this.modules = new Map();
    /** @type {Array<{moduleId: string, basePath: string, router: Function, meta: object}>} */
    this.routes = [];
    /** @type {Map<string, object>} */
    this.permissions = new Map();
    /** @type {Map<string, object>} */
    this.settings = new Map();
    /** @type {Array<object>} */
    this.menu = [];
    /** @type {Array<object>} */
    this.jobs = [];
    /** @type {Array<object>} */
    this.seeds = [];
  }

  // --- Modules ---------------------------------------------------------------

  registerModule(manifest) {
    if (this.modules.has(manifest.id)) {
      throw AppError.internal(`Duplicate module id "${manifest.id}".`);
    }
    this.modules.set(manifest.id, manifest);
  }

  getModule(id) {
    return this.modules.get(id) || null;
  }

  listModuleIds() {
    return Array.from(this.modules.keys());
  }

  listModules() {
    return Array.from(this.modules.values());
  }

  // --- Routes ----------------------------------------------------------------

  registerRoute(moduleId, { basePath, router, meta }) {
    this.routes.push({ moduleId, basePath, router, meta: meta || {} });
  }

  countRoutes() {
    return this.routes.length;
  }

  // --- Permissions -----------------------------------------------------------

  /**
   * A permission is identified by `resource` (a slash path mirroring the UI
   * route) plus the set of actions valid on it. Keeping resources aligned
   * with UI routes is what lets one declaration drive both the API guard and
   * the menu visibility check.
   *
   * @param {string} moduleId
   * @param {{resource: string, label: string, actions: string[], group?: string,
   *          description?: string, dangerous?: boolean}} permission
   */
  registerPermission(moduleId, permission) {
    const existing = this.permissions.get(permission.resource);
    if (existing) {
      // Two modules extending the same resource is legitimate (a plugin adding
      // an action); conflicting labels are not.
      existing.actions = Array.from(new Set(existing.actions.concat(permission.actions)));
      existing.contributedBy = Array.from(new Set(existing.contributedBy.concat([moduleId])));
      return;
    }
    this.permissions.set(permission.resource, {
      resource: permission.resource,
      label: permission.label,
      description: permission.description || '',
      group: permission.group || moduleId,
      actions: permission.actions.slice(),
      dangerous: Boolean(permission.dangerous),
      contributedBy: [moduleId]
    });
  }

  listPermissions() {
    return Array.from(this.permissions.values());
  }

  getPermission(resource) {
    return this.permissions.get(resource) || null;
  }

  /** True when `action` is a declared action of `resource`. */
  isKnownAction(resource, action) {
    const permission = this.permissions.get(resource);
    return Boolean(permission && permission.actions.includes(action));
  }

  // --- Settings --------------------------------------------------------------

  /**
   * @param {string} moduleId
   * @param {object} descriptor  See core/settings/settings-registry.js for the
   *                             descriptor contract.
   */
  registerSetting(moduleId, descriptor) {
    if (this.settings.has(descriptor.key)) {
      throw AppError.internal(
        `Duplicate setting key "${descriptor.key}" (module "${moduleId}" conflicts with ` +
          `"${this.settings.get(descriptor.key).moduleId}").`
      );
    }
    this.settings.set(descriptor.key, Object.assign({ moduleId }, descriptor));
  }

  listSettings() {
    return Array.from(this.settings.values());
  }

  getSetting(key) {
    return this.settings.get(key) || null;
  }

  // --- Menu ------------------------------------------------------------------

  registerMenuItems(moduleId, items) {
    for (const item of items) {
      this.menu.push(Object.assign({ moduleId }, item));
    }
  }

  /**
   * Navigation tree ordered by `order`, with children sorted recursively.
   * Permission filtering happens later, per request.
   */
  getMenuTree() {
    const sortTree = (nodes) =>
      nodes
        .slice()
        .sort((a, b) => (a.order || 999) - (b.order || 999))
        .map((node) => (node.children ? Object.assign({}, node, { children: sortTree(node.children) }) : node));
    return sortTree(this.menu);
  }

  // --- Jobs & seeds ----------------------------------------------------------

  registerJob(moduleId, job) {
    this.jobs.push(Object.assign({ moduleId }, job));
  }

  listJobs() {
    return this.jobs.slice();
  }

  registerSeed(moduleId, seed) {
    this.seeds.push(Object.assign({ moduleId }, seed));
  }

  listSeeds() {
    return this.seeds.slice().sort((a, b) => (a.order || 999) - (b.order || 999));
  }

  // --- Introspection ---------------------------------------------------------

  /** Machine-readable snapshot, exposed by GET /platform/modules. */
  describe() {
    return {
      modules: this.listModules().map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        description: m.description || '',
        dependsOn: m.dependsOn || [],
        routeCount: this.routes.filter((r) => r.moduleId === m.id).length,
        permissionCount: this.listPermissions().filter((p) => p.contributedBy.includes(m.id)).length,
        settingCount: this.listSettings().filter((s) => s.moduleId === m.id).length
      })),
      totals: {
        modules: this.modules.size,
        routes: this.routes.length,
        permissions: this.permissions.size,
        settings: this.settings.size,
        menuRoots: this.menu.length
      }
    };
  }
}

module.exports = ModuleRegistry;
