<script setup>
/**
 * Navigation, rendered from the server's menu tree.
 *
 * The tree arrives already filtered by permission - the backend removes what
 * the user may not see, including containers left empty. Filtering here as
 * well would only duplicate a rule that has to live on the server anyway.
 *
 * A new backend module with menu entries appears here on the next bootstrap
 * call, with no change to this component.
 */

import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { usePlatformStore } from '@/stores/platform.store';

defineProps({
  collapsed: { type: Boolean, default: false }
});

const platform = usePlatformStore();
const route = useRoute();

/** Expanded top-level sections, keyed by menu id. */
const expanded = ref(new Set(initiallyExpanded()));

/** Opens the section containing the current route so the user sees where they are. */
function initiallyExpanded() {
  const open = [];
  for (const node of platform.menu) {
    if (node.children?.some((child) => route.path.startsWith(child.path))) open.push(node.id);
  }
  return open;
}

function toggle(id) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

/**
 * Prefix match at a segment boundary, not equality.
 *
 * `/security/permissions/ADMIN` and `/security/users/<id>` are the same screen
 * as their menu entry, so the entry has to stay lit while you are on them -
 * with equality the sidebar went blank the moment you opened a record. The
 * trailing slash is what stops `/security/roles` from also matching a
 * hypothetical `/security/roles-archive`.
 */
function isActive(path) {
  if (!path) return false;
  return route.path === path || route.path.startsWith(`${path}/`);
}

function isSectionActive(node) {
  return node.children?.some((child) => isActive(child.path));
}
</script>

<template>
  <nav class="menu" aria-label="Main">
    <ul class="menu__list">
      <li v-for="node in platform.menu" :key="node.id" class="menu__item">
        <!-- Leaf -->
        <RouterLink
          v-if="!node.children?.length"
          :to="node.path"
          class="menu__link"
          :class="{ 'menu__link--active': isActive(node.path) }"
        >
          <span class="menu__icon" :data-icon="node.icon" aria-hidden="true" />
          <span v-if="!collapsed" class="menu__label">{{ node.label }}</span>
          <span v-if="node.badge && !collapsed" class="menu__badge">{{ node.badge }}</span>
        </RouterLink>

        <!-- Section -->
        <template v-else>
          <button
            type="button"
            class="menu__link menu__link--section"
            :class="{ 'menu__link--active': isSectionActive(node) }"
            :aria-expanded="expanded.has(node.id)"
            @click="toggle(node.id)"
          >
            <span class="menu__icon" :data-icon="node.icon" aria-hidden="true" />
            <span v-if="!collapsed" class="menu__label">{{ node.label }}</span>
            <span v-if="!collapsed" class="menu__chevron" :class="{ 'menu__chevron--open': expanded.has(node.id) }">
              ›
            </span>
          </button>

          <ul v-show="expanded.has(node.id) && !collapsed" class="menu__sublist">
            <li v-for="child in node.children" :key="child.id">
              <RouterLink
                :to="child.path"
                class="menu__link menu__link--child"
                :class="{ 'menu__link--active': isActive(child.path) }"
              >
                {{ child.label }}
              </RouterLink>
            </li>
          </ul>
        </template>
      </li>
    </ul>

    <p v-if="!platform.menu.length" class="menu__empty">
      No sections are available for your account.
    </p>
  </nav>
</template>

<style scoped>
.menu__list,
.menu__sublist {
  list-style: none;
  margin: 0;
  padding: 0;
}

.menu__link {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 0;
  border-radius: 0.375rem;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.menu__link:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.menu__link--active {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
  font-weight: 600;
}

/* --- Hierarchy ---------------------------------------------------------------
   A section header and its children used to differ only by an indent and a
   fraction of a font size, which made a nine-item sidebar read as one flat
   list. Three signals separate them now, so no single one has to carry it:
   weight and colour on the parent, a rail the children hang from, and size.
   -------------------------------------------------------------------------- */

.menu__link--section {
  margin-top: 0.125rem;
  color: var(--color-text);
  font-weight: 600;
}

/* The section stays legible as a heading when one of its children is the
   active page: tinting both identically is what made them hard to tell apart. */
.menu__link--section.menu__link--active {
  background: none;
  color: var(--color-text);
}

.menu__sublist {
  /* Aligned under the parent's label rather than its icon, so the rail reads
     as "these belong to that". */
  margin: 0.125rem 0 0.375rem 1.4375rem;
  padding-left: 0.625rem;
  border-left: 1px solid var(--color-border);
}

.menu__link--child {
  padding: 0.375rem 0.625rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.menu__link--child.menu__link--active {
  /* A filled pill on an indented row fights the rail; a solid left marker
     reads as "you are here" without competing with it. */
  position: relative;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.menu__link--child.menu__link--active::before {
  content: '';
  position: absolute;
  left: -0.6875rem;
  top: 0.375rem;
  bottom: 0.375rem;
  width: 2px;
  border-radius: 1px;
  background: var(--color-primary);
}

.menu__icon {
  flex: 0 0 1.25rem;
  height: 1.25rem;
}

.menu__label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu__chevron {
  transition: transform 0.15s ease;
}

.menu__chevron--open {
  transform: rotate(90deg);
}

.menu__badge {
  padding: 0.0625rem 0.375rem;
  border-radius: 999px;
  background: var(--color-primary);
  color: #fff;
  font-size: 0.6875rem;
}

.menu__empty {
  padding: 1rem 0.75rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
</style>
