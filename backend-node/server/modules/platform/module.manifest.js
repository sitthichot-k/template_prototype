'use strict';

/**
 * Platform module manifest.
 *
 * Owns the contract between the backend and any frontend. It declares no
 * models and no permissions of its own - it only projects what other modules
 * registered into a shape a client can consume.
 *
 * Boots last (order 90) so every other module has already contributed its
 * permissions, settings and menu entries.
 */

module.exports = {
  id: 'platform',
  name: 'Platform',
  version: '1.0.0',
  description: 'Bootstrap contract, dynamic navigation and module introspection.',
  order: 90,
  dependsOn: ['access-control', 'settings'],

  routes: [{ basePath: '/platform', router: require('./routes/platform.routes') }],

  // The module inventory is the one thing this module guards. It reports every
  // route, permission and setting key the platform declares - a map of the
  // system, which used to be readable by anyone holding a session. Declared
  // here rather than borrowed from another module so the guard does not break
  // when that module is switched off.
  permissions: [
    {
      resource: '/platform/modules',
      label: 'Module inventory',
      description: 'Read which modules are loaded and what each one contributes.',
      group: 'Platform',
      actions: ['view']
    }
  ],
  settings: [],

  menu: [
    {
      // The dashboard route always existed but nothing declared it, so the
      // sidebar had no way to reach the app's own landing page - you could
      // only get there by clearing the URL.
      //
      // No `permission`: every authenticated user has a home screen, and the
      // panels inside it hide themselves individually.
      id: 'dashboard',
      label: 'Dashboard',
      labelKey: 'menu.dashboard',
      icon: 'home',
      path: '/',
      order: 1
    }
  ]
};
