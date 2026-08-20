<script setup>
/**
 * 403 page.
 *
 * Says what happened without naming the permission that was missing -
 * enumerating the permission model for someone who does not hold it is
 * information they have no use for.
 */
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
</script>

<template>
  <div class="state">
    <p class="state__code">403</p>
    <h1 class="state__title">{{ t('error.forbidden') }}</h1>
    <RouterLink :to="{ name: 'dashboard' }" class="btn btn--ghost">{{ t('common.back') }}</RouterLink>
  </div>
</template>

<style scoped>
.state {
  display: grid;
  place-items: center;
  gap: 0.75rem;
  min-height: 100vh;
  text-align: center;
}
.state__code {
  font-size: 3rem;
  font-weight: 800;
  color: var(--color-text-muted);
  margin: 0;
}
.state__title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}
</style>
