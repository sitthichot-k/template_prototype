/**
 * Platform store - the client-side half of the bootstrap contract.
 *
 * Everything that makes this app *this* app rather than the template - the
 * navigation, the visible actions, the branding, the feature flags - arrives
 * from `GET /platform/bootstrap` and lands here. No route table, permission
 * list or menu is hard-coded in the frontend, which is what lets a new
 * backend module appear in the UI with no frontend change.
 */

import { defineStore } from 'pinia';
import api from '@/services/api';
import { useTheme } from '@/composables/useTheme';
import { setConfiguredDefault } from '@/i18n';

export const usePlatformStore = defineStore('platform', {
  state: () => ({
    loaded: false,
    loading: false,

    user: null,
    /** `{ '/security/users': ['view', 'edit'] }` */
    permissions: {},
    superAdmin: false,
    roles: [],
    scopes: {},

    menu: [],
    settings: {},
    features: {},
    modules: [],
    server: {},

    /** Public info available before sign-in: branding, maintenance banner. */
    publicInfo: null
  }),

  getters: {
    /**
     * The single permission check used everywhere in the UI.
     *
     * This is a convenience for hiding controls the user cannot use. It is
     * NOT a security boundary - the API enforces the same rule server-side,
     * and that is the one that counts.
     */
    can: (state) => (resource, action = 'view') => {
      if (state.superAdmin) return true;
      const actions = state.permissions[resource];
      return Boolean(actions && (actions.includes(action) || actions.includes('*')));
    },

    canAny: (state) => (pairs) => {
      if (state.superAdmin) return true;
      return pairs.some(([resource, action]) => {
        const actions = state.permissions[resource];
        return Boolean(actions && (actions.includes(action) || actions.includes('*')));
      });
    },

    hasRole: (state) => (code) => state.roles.includes(code),

    feature: (state) => (key, fallback = false) => {
      const value = state.features[key];
      return value === undefined ? fallback : value;
    },

    setting: (state) => (key, fallback = null) => {
      const value = state.settings[key];
      return value === undefined ? fallback : value;
    },

    appName: (state) => state.server.appName || state.settings['general.appName'] || 'Application',

    isMaintenanceMode: (state) => Boolean(state.settings['general.maintenanceMode'])
  },

  actions: {
    /** Branding for the login screen, fetched before authentication. */
    async loadPublicInfo() {
      this.publicInfo = await api.get('/platform/info');
      return this.publicInfo;
    },

    /**
     * Loads everything the shell needs. Called once after sign-in and again
     * whenever the server signals the permission set changed.
     */
    async bootstrap() {
      if (this.loading) return;
      this.loading = true;

      try {
        const data = await api.get('/platform/bootstrap');

        this.user = data.user;
        this.permissions = data.permissions.granted;
        this.superAdmin = data.permissions.superAdmin;
        this.roles = data.permissions.roles;
        this.scopes = data.permissions.scopes;
        this.menu = data.menu;
        this.settings = data.settings;
        this.features = data.features;
        this.modules = data.modules;
        this.server = data.server;
        this.loaded = true;

        this.applyBranding();
      } finally {
        this.loading = false;
      }
    },

    /**
     * Pushes branding settings into CSS custom properties, so a colour change
     * in the settings screen re-themes the app without a rebuild.
     */
    applyBranding() {
      const root = document.documentElement;
      const primary = this.settings['branding.primaryColor'];
      if (primary) root.style.setProperty('--color-primary', primary);

      const favicon = this.settings['branding.faviconUrl'];
      if (favicon) {
        const link = document.querySelector("link[rel='icon']");
        if (link) link.href = favicon;
      }

      // The deployment's default only applies to users who never picked a
      // theme themselves - the composable owns that precedence.
      useTheme().setConfiguredDefault(this.settings['branding.defaultTheme']);

      // Same precedence for language. Without this the "Default language"
      // setting was read by nothing: the locale came from localStorage or a
      // build-time variable, so the settings screen could not change it.
      setConfiguredDefault(this.settings['localization.defaultLocale']);

      document.title = this.appName;
    },

    reset() {
      this.$reset();
    }
  }
});
