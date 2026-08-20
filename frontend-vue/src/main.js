/**
 * Application entry point.
 *
 * Nothing here knows about a specific feature. The shell mounts, the router
 * restores the session, and the bootstrap contract fills in what this
 * particular deployment looks like.
 */

import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import router from './router';
import i18n from './i18n';
import permissionDirective from './directives/permission';
import { useAuthStore } from './stores/auth.store';
import { initTheme } from './composables/useTheme';

import './assets/styles/tokens.css';
import './assets/styles/base.css';

// Re-applies what the inline script in index.html already painted, and starts
// listening for OS theme changes. The deployment default arrives later, with
// the bootstrap payload.
initTheme();

// A stable per-browser identifier, sent as X-Device-Id so a user can tell
// their sessions apart in the "signed in on" list. Not an authentication
// factor and never treated as one.
if (!localStorage.getItem('device-id')) {
  localStorage.setItem('device-id', crypto.randomUUID());
}

const app = createApp(App);

app.use(createPinia());

// Must run before the router: the navigation guard reads `isAuthenticated`,
// which is only correct once the store is mirroring the API client's token.
useAuthStore().bindTokenSync();

app.use(router);
app.use(i18n);
app.use(permissionDirective);

app.config.errorHandler = (error, instance, info) => {
  // eslint-disable-next-line no-console
  console.error('[vue]', info, error);
};

app.mount('#app');
