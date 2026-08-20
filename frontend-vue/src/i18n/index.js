/**
 * Internationalisation.
 *
 * Two things decide the active language, in this order:
 *
 *   1. the person's own choice, kept in localStorage so it survives a reload;
 *   2. the deployment's `localization.defaultLocale` setting, applied through
 *      `setConfiguredDefault` once the bootstrap payload arrives.
 *
 * The setting used to be documented here and read nowhere: the locale came
 * from localStorage or a build-time variable, so changing "Default language"
 * on the settings screen did nothing at all. The precedence above is the same
 * one `useTheme` applies to `branding.defaultTheme`, and for the same reason -
 * a deployment default must not overrule someone who has already chosen.
 *
 * Menu labels are an exception: they arrive translated from the server, since
 * a module's own manifest is the only place that knows what its screens are
 * called. `labelKey` lets a project override that locally when it wants to.
 */

import { createI18n } from 'vue-i18n';
import th from './locales/th.json';
import en from './locales/en.json';

const STORAGE_KEY = 'locale';

/** Locales with a message catalogue. Anything else falls back to English. */
export const SUPPORTED_LOCALES = ['en', 'th'];

function normalise(locale) {
  return SUPPORTED_LOCALES.includes(locale) ? locale : null;
}

const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale:
    normalise(localStorage.getItem(STORAGE_KEY)) ||
    normalise(import.meta.env.VITE_DEFAULT_LOCALE) ||
    'en',
  fallbackLocale: 'en',
  messages: { th, en },
  // A missing key is a bug, not a runtime failure - warn in development and
  // fall back rather than rendering an empty label in production.
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV
});

function apply(locale) {
  i18n.global.locale.value = locale;
  document.documentElement.setAttribute('lang', locale);
}

/** Records a deliberate choice. Outranks the deployment default from here on. */
export function setLocale(locale) {
  const next = normalise(locale) || 'en';
  localStorage.setItem(STORAGE_KEY, next);
  apply(next);
}

/**
 * The deployment's configured language, from the settings screen. Applied only
 * to people who have never chosen one themselves.
 */
export function setConfiguredDefault(locale) {
  const next = normalise(locale);
  if (!next) return;
  if (localStorage.getItem(STORAGE_KEY)) return;
  apply(next);
}

/** Forgets the personal choice and falls back to the deployment default. */
export function clearLocalePreference(configuredDefault) {
  localStorage.removeItem(STORAGE_KEY);
  apply(normalise(configuredDefault) || 'en');
}

apply(i18n.global.locale.value);

export default i18n;
