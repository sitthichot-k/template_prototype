/**
 * Authentication store.
 *
 * Owns the access token's lifetime in memory and the surrounding flows. The
 * refresh token is never touched here - it lives in an httpOnly cookie the
 * browser manages, which is the point.
 */

import { defineStore } from 'pinia';
import api, { setAccessToken, getAccessToken, subscribeToToken } from '@/services/api';
import { usePlatformStore } from './platform.store';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    initialised: false,
    authenticating: false,
    providers: [],

    // A reactive mirror of the token api.js holds. It must live in state, not
    // in a getter that reads api.js: a getter over a non-reactive module
    // variable is computed once and cached, which silently broke every
    // navigation after sign-in. `bindTokenSync` keeps the two in step.
    accessToken: getAccessToken()
  }),

  getters: {
    isAuthenticated: (state) => Boolean(state.accessToken)
  },

  actions: {
    /**
     * Mirrors api.js's token into reactive state. Called once from main.js.
     *
     * Covers the token changes the store does not make itself - notably the
     * silent refresh the response interceptor performs.
     */
    bindTokenSync() {
      subscribeToToken((token) => {
        this.accessToken = token;
      });
    },

    async loadProviders() {
      const data = await api.get('/auth/providers');
      this.providers = data.providers;
      return this.providers;
    },

    async login({ identifier, password, provider = 'local' }) {
      this.authenticating = true;
      try {
        const data = await api.post('/auth/login', { provider, identifier, password });
        setAccessToken(data.accessToken);
        await usePlatformStore().bootstrap();
        return data.user;
      } finally {
        this.authenticating = false;
      }
    },

    /**
     * Restores a session on page load.
     *
     * The access token is gone after a reload, but the refresh cookie is not.
     * A failed refresh here is the normal "not signed in" case, not an error
     * worth surfacing.
     */
    async restore() {
      if (this.initialised) return this.isAuthenticated;

      try {
        const data = await api.post('/auth/refresh', {});
        setAccessToken(data.accessToken);
        await usePlatformStore().bootstrap();
        return true;
      } catch {
        setAccessToken(null);
        return false;
      } finally {
        this.initialised = true;
      }
    },

    async logout() {
      try {
        await api.post('/auth/logout', {});
      } catch {
        // A failed call must not trap the user in a signed-in shell; the
        // local state is cleared either way and the server session expires.
      } finally {
        this.clear();
      }
    },

    async logoutEverywhere() {
      await api.post('/auth/logout-all', {});
      this.clear();
    },

    clear() {
      setAccessToken(null);
      usePlatformStore().reset();
      this.initialised = true;
    },

    async startSso(returnTo = '/') {
      const { url } = await api.get('/auth/sso/start', { params: { returnTo } });
      window.location.href = url;
    }
  }
});
