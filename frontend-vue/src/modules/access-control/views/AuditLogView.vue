<script setup>
/**
 * Audit trail.
 *
 * Read-only, and filterable on the dimensions an investigation actually uses:
 * who, what kind of action, and whether it succeeded.
 */

import { computed, ref } from 'vue';
import DataTable from '@/components/dynamic/DataTable.vue';

import { formatDateTime } from '@/composables/useFormat';
const category = ref('');
const outcome = ref('');

const baseParams = computed(() => ({
  category: category.value || undefined,
  outcome: outcome.value || undefined
}));

const columns = [
  {
    key: 'occurredAt',
    label: 'When',
    sortable: true,
    width: '12rem',
    formatter: (value) => formatDateTime(value)
  },
  { key: 'actorLabel', label: 'Actor', width: '14rem' },
  { key: 'action', label: 'Action', width: '14rem' },
  { key: 'outcome', label: 'Outcome', width: '7rem' },
  {
    key: 'target',
    label: 'Target',
    formatter: (target) => (target && target.type ? `${target.type}: ${target.label || target.id}` : '—')
  },
  { key: 'context.ip', label: 'IP', width: '9rem' }
];
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1 class="page-header__title">Audit trail</h1>
    </header>

    <DataTable endpoint="/audit" :columns="columns" :base-params="baseParams" default-sort="-occurredAt">
      <template #actions>
        <select v-model="category" class="page__select" aria-label="Category">
          <option value="">All categories</option>
          <option value="auth">Authentication</option>
          <option value="security">Security</option>
          <option value="data">Data</option>
          <option value="configuration">Configuration</option>
          <option value="system">System</option>
        </select>

        <select v-model="outcome" class="page__select" aria-label="Outcome">
          <option value="">All outcomes</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="denied">Denied</option>
        </select>
      </template>

      <template #cell-outcome="{ value }">
        <span class="badge" :class="`badge--${value}`">{{ value }}</span>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.page__select {
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}
.badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  text-transform: capitalize;
}
.badge--success {
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
  color: var(--color-success);
}
.badge--failure,
.badge--denied {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger);
}
</style>
