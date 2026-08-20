/**
 * Reactive media queries.
 *
 * The point of this file is that there is exactly one place that knows where
 * the layout changes. The breakpoints are declared as custom properties in
 * `tokens.css` and read from there, so a stylesheet and a component can never
 * disagree about whether 47rem is "mobile" - which is the bug that produces a
 * page with a desktop sidebar and a mobile header at the same time.
 *
 *   const isMobile = useIsMobile();          // below --bp-md
 *   const wide     = useMediaQuery('(min-width: 100rem)');
 *
 * Listeners are torn down with the component that created them. Calls made
 * outside a component (in a store, say) stay subscribed for the life of the
 * page, which is what you want there.
 */

import { onScopeDispose, readonly, ref } from 'vue';

/** Cache per query string: one MediaQueryList and one ref, however many callers. */
const registry = new Map();

/**
 * Reads a breakpoint token from `:root`, so the numbers live in one file.
 *
 * @param {'sm'|'md'|'lg'|'xl'} name
 * @returns {string} e.g. '48rem'
 */
export function breakpoint(name) {
  if (typeof window === 'undefined') return '48rem';

  const value = getComputedStyle(document.documentElement).getPropertyValue(`--bp-${name}`).trim();

  // A missing token means someone renamed it in tokens.css. Failing loudly in
  // development beats silently laying the page out at an invented width.
  if (!value) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[useMediaQuery] --bp-${name} is not defined in tokens.css; falling back to 48rem.`);
    }
    return '48rem';
  }
  return value;
}

/**
 * @param {string} query A full media query, e.g. '(max-width: 48rem)'.
 * @returns {import('vue').Ref<boolean>} Readonly, true while the query matches.
 */
export function useMediaQuery(query) {
  if (typeof window === 'undefined' || !window.matchMedia) return readonly(ref(false));

  let entry = registry.get(query);

  if (!entry) {
    const list = window.matchMedia(query);
    const matches = ref(list.matches);
    const handler = (event) => {
      matches.value = event.matches;
    };

    list.addEventListener('change', handler);
    entry = { list, matches, handler, consumers: 0 };
    registry.set(query, entry);
  }

  entry.consumers += 1;

  onScopeDispose(() => {
    entry.consumers -= 1;
    if (entry.consumers > 0) return;

    entry.list.removeEventListener('change', entry.handler);
    registry.delete(query);
  });

  return readonly(entry.matches);
}

/**
 * True below `--bp-md`, the width at which the sidebar becomes a drawer.
 *
 * This is *the* mobile test for the application. A screen needing a different
 * boundary should say so explicitly with `useMediaQuery`, rather than this
 * one quietly meaning something different on one page.
 */
export function useIsMobile() {
  return useMediaQuery(`(max-width: ${breakpoint('md')})`);
}
