<script setup>
/** Roles list. `userCount` comes from the server so the UI never has to count. */

import { ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/services/api';
import DataTable from '@/components/dynamic/DataTable.vue';
import RoleEditor from '../components/RoleEditor.vue';

const router = useRouter();
const table = ref(null);

const editorOpen = ref(false);
const editing = ref(null);
const rowError = ref('');

const columns = [
  { key: 'code', label: 'Code', sortable: true, width: '12rem' },
  { key: 'name', label: 'Name', sortable: true },
  { key: 'grantCount', label: 'Grants', width: '6rem' },
  { key: 'userCount', label: 'Users', width: '6rem' },
  {
    key: 'isSystem',
    label: 'Type',
    width: '7rem',
    formatter: (value) => (value ? 'System' : 'Custom')
  }
];

function openCreate() {
  editing.value = null;
  editorOpen.value = true;
}

function openEdit(role) {
  editing.value = role;
  editorOpen.value = true;
}

async function onSaved() {
  editorOpen.value = false;
  editing.value = null;
  await table.value?.reload();
}

/**
 * The server refuses to delete a system role, or one still assigned to
 * anyone - and says how many. Surfacing that message is more useful than
 * pre-empting it here, because the count is what tells the administrator what
 * to do next.
 */
async function remove(role) {
  if (!window.confirm(`Delete the role "${role.name}"? This cannot be undone.`)) return;

  rowError.value = '';
  try {
    await api.delete(`/roles/${role.id}`);
    await table.value?.reload();
  } catch (error) {
    rowError.value = error.message;
  }
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1 class="page-header__title">Roles</h1>
    </header>

    <DataTable
      ref="table"
      endpoint="/roles"
      :columns="columns"
      default-sort="-priority"
      @row-click="(row) => router.push({ name: 'security-role-detail', params: { id: row.id } })"
    >
      <template #actions>
        <button v-can="'/security/roles:create'" type="button" class="btn btn--primary" @click="openCreate">
          New role
        </button>
      </template>

      <template #row-actions="{ row }">
        <div class="row-actions">
          <button
            v-can="'/security/roles:edit'"
            type="button"
            class="btn btn--ghost btn--sm"
            :disabled="row.isSystem"
            :title="row.isSystem ? 'System roles cannot be edited' : undefined"
            @click="openEdit(row)"
          >
            Edit
          </button>
          <button
            v-can="'/security/roles:delete'"
            type="button"
            class="btn btn--danger-ghost btn--sm"
            :disabled="row.isSystem"
            :title="row.isSystem ? 'System roles cannot be deleted' : undefined"
            @click="remove(row)"
          >
            Delete
          </button>
        </div>
      </template>
    </DataTable>

    <p v-if="rowError" class="form-alert form-alert--danger" role="alert">{{ rowError }}</p>

    <RoleEditor :open="editorOpen" :role="editing" @close="editorOpen = false" @saved="onSaved" />
  </div>
</template>

<style scoped>
</style>
