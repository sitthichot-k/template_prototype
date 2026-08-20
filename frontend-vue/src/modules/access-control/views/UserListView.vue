<script setup>
/**
 * User directory.
 *
 * The reference example of a list screen: DataTable owns paging, sorting and
 * search, and `v-can` hides actions the viewer cannot perform. The server
 * enforces the same permissions, so hiding a button is a courtesy rather than
 * the control.
 */

import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/services/api';
import DataTable from '@/components/dynamic/DataTable.vue';
import UserEditor from '../components/UserEditor.vue';

import { formatDateTime } from '@/composables/useFormat';
const router = useRouter();
const table = ref(null);

const editorOpen = ref(false);
const editing = ref(null);
const roles = ref([]);
const rowError = ref('');

const columns = [
  { key: 'displayName', label: 'Name', sortable: true },
  { key: 'email', label: 'Email', sortable: true },
  { key: 'status', label: 'Status', sortable: true, width: '8rem' },
  { key: 'roles', label: 'Roles', formatter: (roles) => (roles || []).map((r) => r.name).join(', ') },
  {
    key: 'lastLoginAt',
    label: 'Last sign-in',
    sortable: true,
    width: '11rem',
    formatter: (value) => formatDateTime(value, { fallback: 'Never' })
  }
];

// Offered as initial roles when creating. A failure here costs only that
// section of the form, so it must not stop the list rendering.
onMounted(async () => {
  try {
    const { items } = await api.list('/roles', { limit: 200, sort: '-priority' });
    roles.value = items;
  } catch {
    roles.value = [];
  }
});

function openUser(row) {
  router.push({ name: 'security-user-detail', params: { id: row.id } });
}

function openCreate() {
  editing.value = null;
  editorOpen.value = true;
}

function openEdit(user) {
  editing.value = user;
  editorOpen.value = true;
}

async function onSaved() {
  editorOpen.value = false;
  editing.value = null;
  await table.value?.reload();
}

/**
 * Deletion is a soft delete on the server, but it is still the action that
 * removes someone's access, so it names the account rather than asking "are
 * you sure?" about an unnamed row.
 */
async function remove(user) {
  if (!window.confirm(`Delete ${user.displayName} (${user.email})? Their sessions end immediately.`)) return;

  rowError.value = '';
  try {
    await api.delete(`/users/${user.id}`);
    await table.value?.reload();
  } catch (error) {
    rowError.value = error.message;
  }
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1 class="page-header__title">Users</h1>
    </header>

    <DataTable
      ref="table"
      endpoint="/users"
      :columns="columns"
      default-sort="displayName"
      @row-click="openUser"
    >
      <template #actions>
        <button v-can="'/security/users:create'" type="button" class="btn btn--primary" @click="openCreate">
          New user
        </button>
      </template>

      <template #cell-status="{ value }">
        <span class="badge" :class="`badge--${value}`">{{ value }}</span>
      </template>

      <template #row-actions="{ row }">
        <div class="row-actions">
          <button v-can="'/security/users:edit'" type="button" class="btn btn--ghost btn--sm" @click="openEdit(row)">
            Edit
          </button>
          <button
            v-can="'/security/users:delete'"
            type="button"
            class="btn btn--danger-ghost btn--sm"
            @click="remove(row)"
          >
            Delete
          </button>
        </div>
      </template>
    </DataTable>

    <p v-if="rowError" class="form-alert form-alert--danger" role="alert">{{ rowError }}</p>

    <UserEditor
      :open="editorOpen"
      :user="editing"
      :roles="roles"
      @close="editorOpen = false"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>

.badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  text-transform: capitalize;
}

.badge--active {
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
  color: var(--color-success);
}

.badge--pending {
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
  color: var(--color-warning);
}

.badge--suspended,
.badge--disabled {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger);
}
</style>
