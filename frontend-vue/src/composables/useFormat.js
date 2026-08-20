/**
 * Date and time rendering, driven by the localisation settings.
 *
 * Three settings on that screen - timezone, date format and the Buddhist era
 * toggle - previously decided nothing at all. Every screen called
 * `new Date(value).toLocaleString()`, which formats in the *browser's* zone
 * with the *browser's* conventions, so an operator in Bangkok and one in
 * London read different timestamps off the same audit row and neither matched
 * what the settings screen claimed.
 *
 * Everything goes through here instead, so the deployment's configuration is
 * what decides, and there is one place to change when it needs to.
 *
 * Reading the store inside the function rather than capturing values keeps the
 * result reactive: changing a setting re-renders every date on screen without
 * a reload.
 */

import { usePlatformStore } from '@/stores/platform.store';

const DEFAULTS = {
  timeZone: 'Asia/Bangkok',
  dateFormat: 'DD/MM/YYYY',
  buddhist: false
};

function localisation() {
  try {
    const settings = usePlatformStore().settings || {};
    return {
      timeZone: settings['localization.timezone'] || DEFAULTS.timeZone,
      dateFormat: settings['localization.dateFormat'] || DEFAULTS.dateFormat,
      buddhist: Boolean(settings['localization.buddhistCalendar'])
    };
  } catch {
    // Called before Pinia is active - a formatter in a module-scope constant,
    // say. The configured values are not knowable yet; the defaults render
    // something sane rather than throwing inside a template.
    return DEFAULTS;
  }
}

/**
 * `Intl` is asked for the pieces and this assembles them, because the ordering
 * is the operator's choice and no single `Intl` option expresses all three
 * patterns. `en-GB` only picks the numbering; the visible order comes from the
 * pattern below.
 */
function partsOf(date, { timeZone, buddhist, month }) {
  const options = {
    timeZone,
    year: 'numeric',
    month,
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  };
  if (buddhist) options.calendar = 'buddhist';

  const result = {};
  for (const part of new Intl.DateTimeFormat('en-GB', options).formatToParts(date)) {
    result[part.type] = part.value;
  }
  return result;
}

/**
 * @param {string|number|Date} value
 * @param {object} [options]
 * @param {boolean} [options.withTime=true]
 * @param {string} [options.fallback='—']  Rendered for a missing or unparseable value.
 */
export function formatDateTime(value, { withTime = true, fallback = '—' } = {}) {
  if (value === null || value === undefined || value === '') return fallback;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const { timeZone, dateFormat, buddhist } = localisation();

  let parts;
  try {
    parts = partsOf(date, { timeZone, buddhist, month: dateFormat === 'DD MMM YYYY' ? 'short' : '2-digit' });
  } catch {
    // An unknown timezone - a value stored before the setting became a picker.
    // Better a timestamp in the wrong zone than a broken screen.
    parts = partsOf(date, { timeZone: 'UTC', buddhist, month: '2-digit' });
  }

  let day;
  if (dateFormat === 'YYYY-MM-DD') day = `${parts.year}-${parts.month}-${parts.day}`;
  else if (dateFormat === 'DD MMM YYYY') day = `${parts.day} ${parts.month} ${parts.year}`;
  else day = `${parts.day}/${parts.month}/${parts.year}`;

  return withTime ? `${day} ${parts.hour}:${parts.minute}` : day;
}

/** Date only, for columns where the time adds width but no information. */
export function formatDate(value, options = {}) {
  return formatDateTime(value, Object.assign({}, options, { withTime: false }));
}

export function useFormat() {
  return { formatDateTime, formatDate };
}
