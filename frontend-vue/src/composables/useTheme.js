/**
 * Theme resolution and switching.
 *
 * Three inputs, in priority order:
 *
 *   1. the user's own choice, kept in localStorage so it survives a reload
 *      and does not need a round trip before the first paint;
 *   2. `branding.defaultTheme` from the settings module, which is how a
 *      deployment says "this product is dark by default";
 *   3. the operating system.
 *
 * The state lives at module scope rather than in a Pinia store because the
 * pre-paint bootstrap in index.html has to reach it before Vue exists, and
 * because a second call to `useTheme()` must observe the first one's choice.
 */

import { computed, ref } from 'vue';

const STORAGE_KEY = 'theme-preference';

/** What the user picked: 'light' | 'dark' | 'system'. */
const preference = ref(readStoredPreference());

/** What the deployment configured; overridden by `preference` when set. */
const configuredDefault = ref('system');

/** What the OS currently reports. */
const systemTheme = ref(prefersDark() ? 'dark' : 'light');

let mediaQuery = null;

function readStoredPreference() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : null;
}

function prefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The theme actually painted: never 'system'. */
const resolved = computed(() => {
  const wanted = preference.value || configuredDefault.value;
  return wanted === 'system' ? systemTheme.value : wanted;
});

function apply() {
  document.documentElement.setAttribute('data-theme', resolved.value);
}

/**
 * Watching the OS matters even when the user picked a fixed theme: they may
 * switch back to "follow the device" without reloading, and the listener has
 * to already be attached for that to take effect.
 */
function watchSystem() {
  if (mediaQuery || typeof window === 'undefined') return;

  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (event) => {
    systemTheme.value = event.matches ? 'dark' : 'light';
    apply();
  });
}

export function useTheme() {
  /** Called by the platform store once `branding.defaultTheme` is known. */
  function setConfiguredDefault(value) {
    configuredDefault.value = value === 'light' || value === 'dark' ? value : 'system';
    apply();
  }

  /** @param {'light'|'dark'|'system'} value */
  function setPreference(value) {
    if (value === 'system') {
      preference.value = 'system';
      localStorage.setItem(STORAGE_KEY, 'system');
    } else {
      preference.value = value === 'dark' ? 'dark' : 'light';
      localStorage.setItem(STORAGE_KEY, preference.value);
    }
    apply();
  }

  /** The header switch: flips whatever is on screen right now. */
  function toggle() {
    setPreference(resolved.value === 'dark' ? 'light' : 'dark');
  }

  /** Drops the override and goes back to what the deployment configured. */
  function clearPreference() {
    preference.value = null;
    localStorage.removeItem(STORAGE_KEY);
    apply();
  }

  return {
    preference: computed(() => preference.value || 'system'),
    resolved,
    isDark: computed(() => resolved.value === 'dark'),
    setConfiguredDefault,
    setPreference,
    clearPreference,
    toggle
  };
}

/** Called once from main.js, before the app mounts. */
export function initTheme() {
  watchSystem();
  apply();
}
