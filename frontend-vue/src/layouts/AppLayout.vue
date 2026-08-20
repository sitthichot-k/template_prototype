<script setup>
/**
 * Authenticated shell: sidebar, header, content outlet.
 *
 * The sidebar's contents come from the server (see DynamicMenu), so this
 * layout has no knowledge of which modules exist.
 */

import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlatformStore } from '@/stores/platform.store';
import { useAuthStore } from '@/stores/auth.store';
import { useTheme } from '@/composables/useTheme';
import { useIsMobile } from '@/composables/useMediaQuery';
import DynamicMenu from '@/components/layout/DynamicMenu.vue';

const platform = usePlatformStore();
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const theme = useTheme();

const isMobile = useIsMobile();

/**
 * Two different behaviours behind one button, because they answer different
 * questions.
 *
 * On a wide screen the sidebar is always present and `collapsed` narrows it to
 * an icon rail - a preference, so it is remembered. On a narrow screen there
 * is no room for either width, so the sidebar becomes an overlay drawer and
 * `drawerOpen` is a transient state that must NOT be remembered: restoring a
 * page with the menu covering it would be an odd way to arrive.
 */
const collapsed = ref(localStorage.getItem('sidebar-collapsed') === '1');
const drawerOpen = ref(false);
const userMenuOpen = ref(false);

function toggleSidebar() {
  if (isMobile.value) {
    drawerOpen.value = !drawerOpen.value;
    return;
  }
  collapsed.value = !collapsed.value;
  localStorage.setItem('sidebar-collapsed', collapsed.value ? '1' : '0');
}

// Navigating is the whole reason the drawer was opened, so it closes itself
// rather than leaving the destination hidden behind it.
watch(() => route.fullPath, () => {
  drawerOpen.value = false;
});

// Widening past the breakpoint makes the drawer the wrong control; leaving it
// "open" would strand its backdrop over a desktop layout.
watch(isMobile, (mobile) => {
  if (!mobile) drawerOpen.value = false;
});

async function signOut() {
  await auth.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="shell" :class="{ 'shell--collapsed': collapsed, 'shell--drawer-open': drawerOpen }">
    <!-- Only rendered on mobile, and only while open: a permanently present
         backdrop would swallow clicks on the desktop layout. -->
    <div
      v-if="isMobile && drawerOpen"
      class="shell__backdrop"
      role="presentation"
      @click="drawerOpen = false"
    />

    <aside class="shell__sidebar">
      <div class="shell__brand">
        <img v-if="platform.setting('branding.logoUrl')" :src="platform.setting('branding.logoUrl')" alt="" />
        <span v-if="!collapsed || isMobile" class="shell__brand-name">{{ platform.appName }}</span>
      </div>

      <!-- The icon rail is a desktop affordance; in the drawer there is room
           for labels, so `collapsed` is ignored there. -->
      <DynamicMenu :collapsed="collapsed && !isMobile" />
    </aside>

    <div class="shell__main">
      <header class="shell__header">
        <button type="button" class="shell__toggle" :aria-label="collapsed ? 'Expand menu' : 'Collapse menu'" @click="toggleSidebar">
          ☰
        </button>

        <div class="shell__spacer" />

        <span v-if="platform.server.environment && platform.server.environment !== 'production'" class="shell__env">
          {{ platform.server.environment }}
        </span>

        <button
          type="button"
          class="shell__theme"
          :title="theme.isDark.value ? 'Switch to the light theme' : 'Switch to the dark theme'"
          :aria-label="theme.isDark.value ? 'Switch to the light theme' : 'Switch to the dark theme'"
          @click="theme.toggle()"
        >
          <svg v-if="theme.isDark.value" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
          </svg>
        </button>

        <div class="shell__user">
          <button type="button" class="shell__user-button" @click="userMenuOpen = !userMenuOpen">
            {{ platform.user?.displayName }}
          </button>

          <div v-if="userMenuOpen" class="shell__user-menu" @click="userMenuOpen = false">
            <RouterLink :to="{ name: 'account-profile' }" class="shell__user-item">Profile</RouterLink>
            <button type="button" class="shell__user-item" @click="signOut">Sign out</button>
          </div>
        </div>
      </header>

      <main class="shell__content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 16rem 1fr;
  min-height: 100vh;
  /* The grid track is what stops a wide table from pushing the whole page
     sideways: without it, `1fr` resolves to the content's width rather than
     the viewport's, and the sidebar scrolls away with it. */
  min-width: 0;
}

.shell--collapsed {
  grid-template-columns: 4rem 1fr;
}

.shell__sidebar {
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  padding: 0.75rem;
  overflow-y: auto;
}

/* --- Mobile: the sidebar becomes an overlay drawer ---------------------------
   Below --bp-md there is no width to spend on a permanent sidebar - a 16rem
   rail on a 375px phone leaves 5rem of content. The grid collapses to one
   column and the sidebar lifts out of flow. --------------------------------- */
@media (max-width: 48rem) {
  .shell,
  .shell--collapsed {
    grid-template-columns: 1fr;
  }

  .shell__sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 40;
    width: min(17rem, 82vw);
    transform: translateX(-100%);
    transition: transform 0.18s ease;
    box-shadow: var(--shadow-lg);
  }

  .shell--drawer-open .shell__sidebar {
    transform: translateX(0);
  }

  .shell__backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    background: rgb(0 0 0 / 45%);
  }
}

/* Respect a request for reduced motion: the drawer still opens, it just does
   not slide. */
@media (prefers-reduced-motion: reduce) {
  .shell__sidebar {
    transition: none;
  }
}

.shell__brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem 1rem;
}

.shell__brand img {
  height: 1.75rem;
}

.shell__brand-name {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shell__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  height: 3.5rem;
  padding: 0 1.25rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.shell__spacer {
  flex: 1;
}

.shell__toggle,
.shell__user-button {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;
}

.shell__toggle:hover,
.shell__user-button:hover {
  background: var(--color-surface-hover);
}

.shell__env {
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  background: var(--color-warning);
  color: #111;
  font-size: 0.75rem;
  text-transform: uppercase;
}

.shell__theme {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.shell__theme:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.shell__theme svg {
  width: 1.125rem;
  height: 1.125rem;
}

.shell__user {
  position: relative;
}

.shell__user-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 0.25rem);
  min-width: 10rem;
  padding: 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  background: var(--color-surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
  z-index: 20;
}

.shell__user-item {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 0;
  border-radius: 0.375rem;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.shell__user-item:hover {
  background: var(--color-surface-hover);
}

/* `min-width: 0` lets the column shrink below its content, which is what makes
   `.table-scroll` scroll the table instead of widening the page. Without it a
   grid item's minimum size is `auto`, i.e. as wide as the widest table. */
.shell__main {
  min-width: 0;
}

.shell__content {
  padding: 1.5rem;
  min-width: 0;
}

@media (max-width: 48rem) {
  .shell__header {
    padding: 0 0.75rem;
    gap: 0.5rem;
  }

  .shell__content {
    padding: 1rem 0.75rem;
  }

  /* The display name is the first thing worth dropping: the avatar button
     still opens the same menu, and the header has to fit a toggle, an
     environment badge and a theme switch first. */
  .shell__user-button {
    max-width: 7rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
