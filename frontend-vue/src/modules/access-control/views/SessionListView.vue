<script setup>
/** Active sessions across all users - the revocation half of an investigation. */

import { ref } from 'vue';
import api from '@/services/api';
import DataTable from '@/components/dynamic/DataTable.vue';

import { formatDateTime } from '@/composables/useFormat';
const table = ref(null);

const columns = [
  { key: 'user.displayName', label: 'User' },
  { key: 'user.email', label: 'Email' },
  { key: 'device.ip', label: 'IP', width: '10rem' },
  { key: 'device.userAgent', label: 'Device' },
  {
    key: 'lastSeenAt',
    label: 'Last seen',
    sortable: true,
    width: '12rem',
    formatter: (value) => formatDateTime(value)
  }
];

/* A slot name containing a dot cannot be written as `#cell-device.userAgent`:
   the template compiler reads everything after the dot as a directive
   modifier, so the slot silently never binds. A dynamic slot name is the way
   to pass one through. */
const deviceSlot = 'cell-device.userAgent';

async function revokeAllForUser(row) {
  if (!row.user) return;
  if (!window.confirm(`Sign ${row.user.displayName} out of every device?`)) return;

  await api.delete(`/users/${row.user.id}/sessions`);
  table.value.reload();
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1 class="page-header__title">Active sessions</h1>
    </header>

    <DataTable ref="table" endpoint="/sessions" :columns="columns" :searchable="false" default-sort="-lastSeenAt">
      <!-- The full user agent is worth keeping for an investigation, but it is
           up to 300 characters of one unbroken line. Capped here so it cannot
           set the width of the table; the whole string stays on the tooltip. -->
      <template #[deviceSlot]="{ value }">
        <span class="session-device" :title="value || undefined">{{ value || '—' }}</span>
      </template>

      <template #row-actions="{ row }">
        <button
          v-can="'/security/sessions:revoke'"
          type="button"
          class="btn btn--ghost btn--sm"
          @click="revokeAllForUser(row)"
        >
          Revoke all
        </button>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.btn--sm {
  padding: 0.25rem 0.625rem;
  font-size: 0.8125rem;
}

/* `max-width` on a table cell is ignored by table layout, so the cap has to
   live on a block inside the cell - that box is a normal block, its max-width
   is honoured, and it caps what the column contributes to the table's width. */
.session-device {
  display: block;
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
