<script setup>
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
</script>

<template>
  <div class="state">
    <p class="state__code">404</p>
    <h1 class="state__title">{{ t('error.notFound') }}</h1>
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
