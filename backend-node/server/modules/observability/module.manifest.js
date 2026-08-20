'use strict';

/**
 * Observability module manifest.
 *
 * Gives the platform an operational log an administrator can actually read:
 * every API request plus whatever modules choose to record, filterable by
 * level, searchable, and aggregated into the numbers the dashboard shows.
 *
 * It is separate from the audit trail on purpose - see the note on the
 * ApplicationLog model for why mixing the two ruins both.
 *
 * Boots at order 30: after access-control (it reads `req.auth`) and settings
 * (it reads its own switches), before any feature module whose traffic it is
 * meant to capture.
 */

const registerModels = require('./models');
const logService = require('./services/log.service');
const { requestLog } = require('./middleware/request-log');
const { assertResourcesDeclared } = require('../../core/security/authorize');

module.exports = {
  id: 'observability',
  name: 'Observability',
  version: '1.0.0',
  description: 'Queryable application log, request tracing and runtime performance metrics.',
  order: 30,
  dependsOn: ['access-control', 'settings'],

  models: registerModels,

  routes: [{ basePath: '/logs', router: require('./routes/log.routes') }],

  permissions: [
    {
      resource: '/observability/logs',
      label: 'Application logs',
      description: 'Read the operational log: requests, warnings and errors.',
      group: 'Observability',
      // Read-only by design; there is no write or delete endpoint to guard.
      actions: ['view', 'export']
    }
  ],

  settings: [
    {
      key: 'observability.requestLogging',
      group: 'observability',
      section: 'logging',
      label: 'Record API requests',
      description:
        'Every request becomes a log row. Drop to "Problems only" on a busy system - the performance panel then covers failures rather than all traffic.',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'All requests' },
        { value: 'errors', label: 'Problems only (4xx and 5xx)' },
        { value: 'off', label: 'Off' }
      ],
      permission: { resource: '/settings/general', action: 'edit' },
      order: 10
    },
    {
      key: 'observability.logRetentionDays',
      group: 'observability',
      section: 'logging',
      label: 'Log retention (days)',
      description: 'Entries older than this are expired by MongoDB itself. Applied on the next restart.',
      type: 'number',
      default: 14,
      min: 1,
      max: 365,
      permission: { resource: '/settings/general', action: 'edit' },
      order: 20
    }
  ],

  menu: [
    {
      id: 'observability',
      label: 'Monitoring',
      labelKey: 'menu.observability',
      icon: 'activity',
      order: 920,
      children: [
        {
          id: 'observability-logs',
          label: 'Logs',
          labelKey: 'menu.observability.logs',
          icon: 'list',
          path: '/observability/logs',
          permission: { resource: '/observability/logs', action: 'view' },
          order: 10
        }
      ]
    }
  ],

  hooks: {
    /**
     * Registered here rather than in the platform middleware stack because the
     * module owns the behaviour: disabling the module through MODULES_DISABLED
     * has to stop the writes as well as hide the screen.
     *
     * `onBoot` runs before module routers are mounted, so this sits ahead of
     * every API route and still sees the final status code on `finish`.
     */
    async onBoot({ app }) {
      app.use(requestLog);
    },

    /**
     * Retention is applied at `onReady` because it needs a live connection and
     * the settings registry, and because a slow index command must not hold up
     * route mounting.
     */
    async onReady({ registry }) {
      assertResourcesDeclared(registry, ['/observability/logs']);

      // eslint-disable-next-line global-require
      const settingsService = require('../../core/settings/settings-service');
      const retentionDays = await settingsService.get('observability.logRetentionDays');
      await logService.ensureRetentionIndex(retentionDays);
    }
  }
};
