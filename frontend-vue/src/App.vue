<script setup>
/**
 * Root component.
 *
 * Chooses between the authenticated shell and a bare page based on the
 * route's `layout` meta, and surfaces the maintenance banner. Everything else
 * is delegated.
 */

import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { usePlatformStore } from '@/stores/platform.store';

const route = useRoute();
const platform = usePlatformStore();

const isBlankLayout = computed(() => route.meta.layout === 'blank');

onMounted(async () => {
  // Branding for the login screen must be available before anyone signs in.
  if (!platform.publicInfo) {
    await platform.loadPublicInfo().catch(() => {
      // The API being unreachable is handled by the view; the app still boots.
    });
  }
});
</script>

<template>
  <div id="app-root" :class="{ 'app-root--blank': isBlankLayout }">
    <div v-if="platform.isMaintenanceMode" class="maintenance-banner" role="alert">
      {{ platform.setting('general.maintenanceMessage', 'Maintenance in progress.') }}
    </div>

    <RouterView />
  </div>
</template>

<style>
.maintenance-banner {
  padding: 0.625rem 1rem;
  background: var(--color-warning);
  color: #111;
  font-size: 0.875rem;
  text-align: center;
}
</style>
