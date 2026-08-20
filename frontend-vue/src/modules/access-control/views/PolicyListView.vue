<script setup>
/**
 * Access policies.
 *
 * Conditional rules layered over roles. The list stays deliberately plain -
 * the value is in the simulator, which answers "would this actually stop
 * anyone" before a rule is switched on.
 */

import { onMounted, ref } from 'vue';
import api from '@/services/api';
import DataTable from '@/components/dynamic/DataTable.vue';
import PolicyEditor from '../components/PolicyEditor.vue';

const columns = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'effect', label: 'Effect', width: '6rem' },
  { key: 'resources', label: 'Resources', formatter: (value) => (value || []).join(', ') },
  { key: 'actions', label: 'Actions', formatter: (value) => (value || []).join(', '), width: '12rem' },
  { key: 'priority', label: 'Priority', sortable: true, width: '6rem' },
  { key: 'isActive', label: 'Active', width: '6rem', formatter: (value) => (value ? 'Yes' : 'No') }
];

const simulation = ref({ userId: '', resource: '', action: 'view' });
const result = ref(null);
const simulating = ref(false);

const table = ref(null);
const seeding = ref(false);
const seedResult = ref(null);

const editorOpen = ref(false);
const editing = ref(null);
const roles = ref([]);
const rowError = ref('');

// Subjects are role codes, so the editor needs the role list to offer them as
// names rather than asking an administrator to remember codes.
onMounted(async () => {
  try {
    const { items } = await api.list('/roles', { limit: 200, sort: '-priority' });
    roles.value = items;
  } catch {
    // A missing role list only costs the subject checkboxes; the rest of the
    // editor still works, so this is not worth blocking the screen for.
    roles.value = [];
  }
});

function openCreate() {
  editing.value = null;
  editorOpen.value = true;
}

function openEdit(policy) {
  editing.value = policy;
  editorOpen.value = true;
}

async function onSaved() {
  editorOpen.value = false;
  editing.value = null;
  await table.value?.reload();
}

/**
 * Activating is the step that makes a rule bite, so it is a deliberate click
 * rather than an inline switch that can be caught in passing.
 *
 * The policy is re-read before being written back. `PATCH /policies/:id`
 * validates against the full policy schema - every field is required, so it
 * behaves like a replace - and sending the list row instead would depend on
 * that endpoint never gaining a field projection.
 */
async function toggleActive(policy) {
  rowError.value = '';
  try {
    const current = await api.get(`/policies/${policy.id}`);
    await api.patch(`/policies/${policy.id}`, { ...current, isActive: !current.isActive });
    await table.value?.reload();
  } catch (error) {
    rowError.value = error.message;
  }
}

async function remove(policy) {
  if (!window.confirm(`Delete the policy "${policy.name}"? This cannot be undone.`)) return;
  rowError.value = '';
  try {
    await api.delete(`/policies/${policy.id}`);
    await table.value?.reload();
  } catch (error) {
    rowError.value = error.message;
  }
}

/**
 * Installs the starter policy set.
 *
 * The starters arrive inactive and carrying placeholder addresses, so the
 * button is safe to press but does not by itself change any decision. The
 * message afterwards says so - an administrator who assumed otherwise would
 * believe they had protection they do not have.
 */
async function seedDefaults() {
  seeding.value = true;
  seedResult.value = null;
  try {
    const data = await api.post('/policies/seed-defaults');
    seedResult.value = { ok: true, ...data };
    await table.value?.reload();
  } catch (error) {
    seedResult.value = { ok: false, message: error.message };
  } finally {
    seeding.value = false;
  }
}

async function simulate() {
  simulating.value = true;
  result.value = null;
  try {
    result.value = await api.post('/policies/simulate', simulation.value);
  } catch (error) {
    result.value = { allowed: false, reason: error.message };
  } finally {
    simulating.value = false;
  }
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1 class="page-header__title">Access policies</h1>
    </header>

    <DataTable ref="table" endpoint="/policies" :columns="columns" default-sort="-priority">
      <template #actions>
        <button
          v-can="'/security/policies:create'"
          type="button"
          class="btn btn--ghost"
          :disabled="seeding"
          @click="seedDefaults"
        >
          {{ seeding ? 'Seeding…' : 'Seed defaults' }}
        </button>
        <button v-can="'/security/policies:create'" type="button" class="btn btn--primary" @click="openCreate">
          New policy
        </button>
      </template>

      <template #row-actions="{ row }">
        <div class="row-actions">
          <button
            v-can="'/security/policies:edit'"
            type="button"
            class="btn btn--ghost btn--sm"
            @click="toggleActive(row)"
          >
            {{ row.isActive ? 'Deactivate' : 'Activate' }}
          </button>
          <button v-can="'/security/policies:edit'" type="button" class="btn btn--ghost btn--sm" @click="openEdit(row)">
            Edit
          </button>
          <button
            v-can="'/security/policies:delete'"
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

    <PolicyEditor
      :open="editorOpen"
      :policy="editing"
      :roles="roles"
      @close="editorOpen = false"
      @saved="onSaved"
    />

    <p v-if="seedResult" class="seed-result" :class="seedResult.ok ? 'is-allowed' : 'is-denied'">
      <template v-if="seedResult.ok">
        <template v-if="seedResult.created.length">
          Added {{ seedResult.created.length }} starter
          {{ seedResult.created.length === 1 ? 'policy' : 'policies' }}.
        </template>
        <template v-else>Nothing added — every starter policy already exists.</template>
        <span v-if="seedResult.skipped.length" class="seed-result__note">
          Skipped {{ seedResult.skipped.length }} already present.
        </span>
        <span class="seed-result__note">
          They are <strong>inactive</strong> and hold placeholder addresses and dates. Edit each one,
          check it with the simulator below, then switch it on.
        </span>
      </template>
      <template v-else>{{ seedResult.message }}</template>
    </p>

    <section class="card simulator">
      <h2 class="simulator__title">Simulate a decision</h2>
      <p class="simulator__hint">
        Checks a real user against the current roles and policies without changing anything.
      </p>

      <form class="simulator__form" @submit.prevent="simulate">
        <input v-model="simulation.userId" placeholder="User ID" class="simulator__input" required />
        <input v-model="simulation.resource" placeholder="/security/users" class="simulator__input" required />
        <input v-model="simulation.action" placeholder="view" class="simulator__input" required />
        <button type="submit" class="btn btn--ghost" :disabled="simulating">Run</button>
      </form>

      <p v-if="result" class="simulator__result" :class="result.allowed ? 'is-allowed' : 'is-denied'">
        {{ result.allowed ? 'Allowed' : 'Denied' }} — {{ result.reason }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.seed-result {
  margin: 0.75rem 0 0;
  font-size: 0.875rem;
  font-weight: 600;
}
.seed-result__note {
  display: block;
  margin-top: 0.25rem;
  font-weight: 400;
  color: var(--color-text-muted);
}
.simulator {
  margin-top: 1.5rem;
}
.simulator__title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 0.25rem;
}
.simulator__hint {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  margin: 0 0 0.75rem;
}
.simulator__form {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.simulator__input {
  flex: 1 1 12rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}
.simulator__result {
  margin: 0.75rem 0 0;
  font-weight: 600;
}
.is-allowed {
  color: var(--color-success);
}
.is-denied {
  color: var(--color-danger);
}
</style>
