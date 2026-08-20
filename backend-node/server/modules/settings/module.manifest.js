'use strict';

/**
 * Settings module manifest.
 *
 * Provides the storage and API for every setting in the system, and declares
 * the platform-level settings (branding, localisation, feature flags) that do
 * not belong to any feature module.
 *
 * The settings this module declares are the ones a child project is most
 * likely to change first, which is why branding and localisation ship in
 * phase 1: a generated project should be re-brandable without a code change.
 */

const mongoose = require('mongoose');
const config = require('../../../config');
const settingsService = require('../../core/settings/settings-service');
const { assertResourcesDeclared } = require('../../core/security/authorize');

const SETTINGS_ACTIONS = ['view', 'edit'];

/**
 * Selectable timezones, taken from the runtime's own IANA database.
 *
 * Generated rather than hand-listed so the options are exactly the identifiers
 * `Intl.DateTimeFormat` will accept - a curated list drifts from the runtime
 * and ends up offering a zone that then throws when something formats a date
 * with it. Node has carried `supportedValuesOf` since 18; the fallback covers
 * a runtime without it rather than leaving the setting unusable.
 */
const TIMEZONE_OPTIONS = (typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('timeZone')
  : ['UTC', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'America/New_York']
).map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') }));

const descriptors = [
  // --- General --------------------------------------------------------------
  {
    key: 'general.appName',
    group: 'general',
    section: 'identity',
    label: 'Application name',
    description: 'Shown in the browser title, the sidebar and outgoing email.',
    type: 'string',
    default: config.project.name,
    maxLength: 80,
    required: true,
    permission: { resource: '/settings/general', action: 'edit' },
    order: 10
  },
  {
    key: 'general.organizationName',
    group: 'general',
    section: 'identity',
    label: 'Organisation name',
    type: 'string',
    default: config.project.organization,
    maxLength: 120,
    permission: { resource: '/settings/general', action: 'edit' },
    order: 20
  },
  {
    key: 'general.supportEmail',
    group: 'general',
    section: 'contact',
    label: 'Support email',
    description: 'Where users are told to write when something goes wrong.',
    type: 'email',
    default: '',
    permission: { resource: '/settings/general', action: 'edit' },
    order: 30
  },
  {
    key: 'general.maintenanceMode',
    group: 'general',
    section: 'availability',
    label: 'Maintenance mode',
    description: 'Blocks every non-administrator from signing in.',
    type: 'boolean',
    default: false,
    permission: { resource: '/settings/general', action: 'edit' },
    order: 40
  },
  {
    key: 'general.maintenanceMessage',
    group: 'general',
    section: 'availability',
    label: 'Maintenance message',
    type: 'text',
    default: 'The system is temporarily unavailable for scheduled maintenance.',
    maxLength: 500,
    dependsOn: { key: 'general.maintenanceMode', equals: true },
    permission: { resource: '/settings/general', action: 'edit' },
    order: 50
  },

  // --- Branding -------------------------------------------------------------
  {
    key: 'branding.primaryColor',
    group: 'branding',
    section: 'theme',
    label: 'Primary colour',
    type: 'color',
    default: config.branding.primaryColor,
    permission: { resource: '/settings/general', action: 'edit' },
    order: 10
  },
  {
    key: 'branding.logoUrl',
    group: 'branding',
    section: 'theme',
    label: 'Logo',
    type: 'file',
    default: '',
    permission: { resource: '/settings/general', action: 'edit' },
    order: 20
  },
  {
    key: 'branding.faviconUrl',
    group: 'branding',
    section: 'theme',
    label: 'Favicon',
    type: 'file',
    default: '',
    permission: { resource: '/settings/general', action: 'edit' },
    order: 30
  },
  {
    key: 'branding.defaultTheme',
    group: 'branding',
    section: 'theme',
    label: 'Default theme',
    type: 'select',
    default: 'system',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'system', label: 'Follow the device' }
    ],
    scopes: ['global', 'user'],
    permission: { resource: '/settings/general', action: 'edit' },
    order: 40
  },

  // --- Localisation ---------------------------------------------------------
  {
    key: 'localization.defaultLocale',
    group: 'localization',
    section: 'language',
    label: 'Default language',
    type: 'select',
    default: config.branding.defaultLocale,
    options: [
      { value: 'th', label: 'ไทย' },
      { value: 'en', label: 'English' }
    ],
    scopes: ['global', 'user'],
    permission: { resource: '/settings/localization', action: 'edit' },
    order: 10
  },
  {
    key: 'localization.timezone',
    group: 'localization',
    section: 'regional',
    label: 'Timezone',
    description: 'Used to render every date and time in the interface.',
    // A picker, not a text box. A timezone is chosen from a closed set that
    // the runtime already knows; typing it freehand invited "Bangkok",
    // "GMT+7" and "asia/bangkok", none of which `Intl` accepts, and the
    // setting saved happily because nothing validated the string.
    type: 'select',
    default: 'Asia/Bangkok',
    options: TIMEZONE_OPTIONS,
    scopes: ['global', 'user'],
    permission: { resource: '/settings/localization', action: 'edit' },
    order: 20
  },
  {
    key: 'localization.dateFormat',
    group: 'localization',
    section: 'regional',
    label: 'Date format',
    type: 'select',
    default: 'DD/MM/YYYY',
    options: [
      { value: 'DD/MM/YYYY', label: '31/12/2026' },
      { value: 'YYYY-MM-DD', label: '2026-12-31' },
      { value: 'DD MMM YYYY', label: '31 Dec 2026' }
    ],
    scopes: ['global', 'user'],
    permission: { resource: '/settings/localization', action: 'edit' },
    order: 30
  },
  {
    key: 'localization.buddhistCalendar',
    group: 'localization',
    section: 'regional',
    label: 'Use the Buddhist era for displayed years',
    type: 'boolean',
    default: true,
    scopes: ['global', 'user'],
    permission: { resource: '/settings/localization', action: 'edit' },
    order: 40
  },

  // --- Notification ---------------------------------------------------------
  {
    key: 'notification.mail.enabled',
    group: 'notification',
    section: 'mail',
    label: 'Send email notifications',
    type: 'boolean',
    default: false,
    permission: { resource: '/settings/notification', action: 'edit' },
    order: 10
  },
  {
    key: 'notification.mail.host',
    group: 'notification',
    section: 'mail',
    label: 'SMTP host',
    type: 'string',
    default: '',
    dependsOn: { key: 'notification.mail.enabled', equals: true },
    permission: { resource: '/settings/notification', action: 'edit' },
    order: 20
  },
  {
    key: 'notification.mail.port',
    group: 'notification',
    section: 'mail',
    label: 'SMTP port',
    type: 'number',
    default: 587,
    min: 1,
    max: 65535,
    dependsOn: { key: 'notification.mail.enabled', equals: true },
    permission: { resource: '/settings/notification', action: 'edit' },
    order: 30
  },
  {
    key: 'notification.mail.username',
    group: 'notification',
    section: 'mail',
    label: 'SMTP username',
    type: 'string',
    default: '',
    dependsOn: { key: 'notification.mail.enabled', equals: true },
    permission: { resource: '/settings/notification', action: 'edit' },
    order: 40
  },
  {
    key: 'notification.mail.password',
    group: 'notification',
    section: 'mail',
    label: 'SMTP password',
    type: 'password',
    default: '',
    // Encrypted at rest and never returned by the read API.
    secret: true,
    dependsOn: { key: 'notification.mail.enabled', equals: true },
    permission: { resource: '/settings/notification', action: 'edit' },
    order: 50
  },
  {
    key: 'notification.mail.from',
    group: 'notification',
    section: 'mail',
    label: 'From address',
    type: 'email',
    default: '',
    dependsOn: { key: 'notification.mail.enabled', equals: true },
    permission: { resource: '/settings/notification', action: 'edit' },
    order: 60
  },

  // --- Feature flags --------------------------------------------------------
  //
  // Two flags used to live here and neither could do anything.
  //
  // `features.registrationEnabled` offered "Allow self-registration", and
  // there is no registration endpoint in the platform - switching it on
  // announced an open sign-up that did not exist, while switching it off
  // described the only behaviour there has ever been. Self-registration is a
  // public account-creation surface and deserves to be built deliberately
  // (verification, rate limiting, what the new account may do before an
  // administrator has looked at it) rather than implied by a toggle.
  //
  // `features.experimental` was a multiselect with an empty option list, so
  // the screen rendered "No options are available" and there was nothing to
  // pick. Feature keys belong to whichever project has features to gate; a
  // child project declares its own flags in its own manifest, where the
  // options can name something real.
  //
  // The group stays declared - `features.*` is still how the bootstrap payload
  // surfaces flags to the client - it simply has nothing to show until a
  // project puts something in it.
];

module.exports = {
  id: 'settings',
  name: 'Settings',
  version: '1.0.0',
  description: 'Dynamic, schema-driven configuration with global, organisation and per-user scopes.',
  order: 20,
  dependsOn: ['access-control'],

  models() {
    return { Setting: require('./models/setting.model') };
  },

  routes: [{ basePath: '/settings', router: require('./routes/settings.routes') }],

  permissions: [
    {
      resource: '/settings/general',
      label: 'General settings',
      description: 'Application identity, branding and availability.',
      group: 'Settings',
      actions: SETTINGS_ACTIONS
    },
    {
      resource: '/settings/security',
      label: 'Security settings',
      description: 'Password policy, lockout, session and audit retention.',
      group: 'Settings',
      actions: SETTINGS_ACTIONS,
      dangerous: true
    },
    {
      resource: '/settings/notification',
      label: 'Notification settings',
      description: 'Mail transport and delivery defaults.',
      group: 'Settings',
      actions: SETTINGS_ACTIONS
    },
    {
      resource: '/settings/integration',
      label: 'Integration settings',
      description: 'Third-party credentials and endpoints.',
      group: 'Settings',
      actions: SETTINGS_ACTIONS,
      dangerous: true
    },
    {
      resource: '/settings/localization',
      label: 'Localisation settings',
      description: 'Language, timezone and date formatting.',
      group: 'Settings',
      actions: SETTINGS_ACTIONS
    },
    {
      resource: '/settings/feature-flags',
      label: 'Feature flags',
      description: 'Switch features on and off without a deployment.',
      group: 'Settings',
      actions: SETTINGS_ACTIONS
    }
  ],

  // The kernel validates these against the descriptor schema and applies its
  // defaults, exactly as it does for every other module.
  settings: descriptors,

  menu: [
    {
      id: 'settings',
      label: 'Settings',
      labelKey: 'menu.settings',
      icon: 'settings',
      order: 950,
      children: [
        {
          id: 'settings-general',
          label: 'General',
          labelKey: 'menu.settings.general',
          path: '/settings/general',
          permission: { resource: '/settings/general', action: 'view' },
          order: 10
        },
        {
          // Branding descriptors exist under their own group, so without this
          // entry the primary colour, logo and default theme were reachable
          // only by typing the URL.
          id: 'settings-branding',
          label: 'Branding',
          labelKey: 'menu.settings.branding',
          path: '/settings/branding',
          permission: { resource: '/settings/general', action: 'view' },
          order: 15
        },
        {
          id: 'settings-security',
          label: 'Security',
          labelKey: 'menu.settings.security',
          path: '/settings/security',
          permission: { resource: '/settings/security', action: 'view' },
          order: 20
        },
        {
          id: 'settings-notification',
          label: 'Notifications',
          labelKey: 'menu.settings.notification',
          path: '/settings/notification',
          permission: { resource: '/settings/notification', action: 'view' },
          order: 30
        },
        {
          id: 'settings-localization',
          label: 'Localisation',
          labelKey: 'menu.settings.localization',
          path: '/settings/localization',
          permission: { resource: '/settings/localization', action: 'view' },
          order: 40
        },
        {
          // Declared by the observability module, navigated from here: menu
          // nodes are not merged across modules, so a second manifest adding
          // an `id: 'settings'` node would put a whole second Settings section
          // in the sidebar. The settings module owns this navigation the same
          // way it already does for the security group.
          id: 'settings-observability',
          label: 'Monitoring',
          labelKey: 'menu.settings.observability',
          path: '/settings/observability',
          permission: { resource: '/settings/general', action: 'view' },
          order: 45
        },
        {
          id: 'settings-features',
          label: 'Feature flags',
          labelKey: 'menu.settings.features',
          path: '/settings/features',
          permission: { resource: '/settings/feature-flags', action: 'view' },
          order: 50
        }
      ]
    }
  ],

  hooks: {
    /**
     * The settings service reads descriptors out of the registry, so it must
     * be bound before any module tries to read a setting.
     */
    async onBoot({ registry }) {
      settingsService.bindRegistry(registry);
      // Touch the model so `mongoose.model('Setting')` resolves for callers
      // that never import the file directly.
      mongoose.model('Setting');
    },

    async onReady({ registry }) {
      assertResourcesDeclared(registry, [
        '/settings/general',
        '/settings/security',
        '/settings/notification',
        '/settings/integration',
        '/settings/localization',
        '/settings/feature-flags'
      ]);
    }
  }
};
