<script setup>
/**
 * Role detail - identity and a read-only picture of what the role can do.
 *
 * Grants are deliberately NOT editable here. Two editors for the same data
 * meant two places to check when an audit asked "who changed this", and two
 * chances for the screens to disagree about what a partially-granted resource
 * looks like. The permission matrix is the single editing surface; this screen
 * links into it with the role preselected.
 */

import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '@/services/api';
import RoleEditor from '../components/RoleEditor.vue';

const route = useRoute();
const router = useRouter();

const role = ref(null);
const catalogue = ref([]);
const loading = ref(true);
const error = ref('');
const editorOpen = ref(false);

onMounted(load);

async function load() {
  try {
    const [roleData, catalogueData] = await Promise.all([
      api.get(`/roles/${route.params.id}`),
      api.get('/permissions/catalogue')
    ]);

    role.value = roleData;
    catalogue.value = catalogueData.groups;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function onSaved() {
  editorOpen.value = false;
  await load();
}

/**
 * The server refuses to delete a system role or one still assigned to anyone,
 * and its message carries the user count - which is the part that tells the
 * administrator what to do next, so it is shown verbatim.
 */
async function remove() {
  if (!window.confirm(`Delete the role "${role.value.name}"? This cannot be undone.`)) return;

  try {
    await api.delete(`/roles/${route.params.id}`);
    router.push({ name: 'security-roles' });
  } catch (err) {
    error.value = err.message;
  }
}

/** `resource -> Set(actions)` for quick lookup while rendering. */
const grantMap = computed(() => {
  const map = {};
  for (const grant of role.value?.grants || []) map[grant.resource] = new Set(grant.actions || []);
  return map;
});

/**
 * The catalogue filtered down to what this role actually holds, so the summary
 * is a list of capabilities rather than a wall of mostly-empty rows.
 */
const heldByGroup = computed(() =>
  catalogue.value
    .map((group) => ({
      group: group.group,
      items: group.items
        .filter((item) => grantMap.value[item.resource]?.size)
        .map((item) => ({
          ...item,
          held: item.actions.filter((action) => grantMap.value[item.resource].has(action)),
          full: item.actions.every((action) => grantMap.value[item.resource].has(action))
        }))
    }))
    .filter((group) => group.items.length)
);

/**
 * Grants pointing at a resource no module currently declares. Surfacing them
 * beats hiding them: they are usually the fingerprint of a module that was
 * removed or renamed, and they stay in the document until someone looks.
 */
const orphanedGrants = computed(() => {
  const declared = new Set(catalogue.value.flatMap((group) => group.items.map((item) => item.resource)));
  return (role.value?.grants || []).filter((grant) => !declared.has(grant.resource));
});

const grantTotal = computed(() =>
  (role.value?.grants || []).reduce((total, grant) => total + (grant.actions || []).length, 0)
);

/** Addressed by code rather than id, so the link reads as a sentence. */
const matrixLink = computed(() =>
  role.value?.code ? `/security/permissions/${role.value.code}` : '/security/permissions'
);
</script>

<template>
  <div class="page">
    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="error" class="alert alert--danger" role="alert">{{ error }}</p>

    <template v-else-if="role">
      <header class="page-header">
        <div>
          <h1 class="page-header__title">{{ role.name }}</h1>
          <p class="page-header__meta">
            <code>{{ role.code }}</code>
            <span v-if="role.isSystem" class="tag">System</span>
            <span v-if="role.isSuperAdmin" class="tag tag--danger">Super admin</span>
            <span v-if="!role.isActive" class="tag tag--muted">Inactive</span>
          </p>
          <p v-if="role.description" class="page-header__description">{{ role.description }}</p>
        </div>

        <div class="page-header__actions">
          <RouterLink v-can="'/security/roles:edit'" :to="matrixLink" class="btn btn--primary">
            Edit in permission matrix
          </RouterLink>
          <button
            v-can="'/security/roles:edit'"
            type="button"
            class="btn btn--ghost"
            :disabled="role.isSystem"
            :title="role.isSystem ? 'System roles cannot be edited' : undefined"
            @click="editorOpen = true"
          >
            Edit details
          </button>
          <button
            v-can="'/security/roles:delete'"
            type="button"
            class="btn btn--danger-ghost"
            :disabled="role.isSystem"
            :title="role.isSystem ? 'System roles cannot be deleted' : undefined"
            @click="remove"
          >
            Delete
          </button>
        </div>
      </header>

      <section class="facts">
        <div class="card fact">
          <p class="fact__label">Users</p>
          <p class="fact__value">{{ role.userCount ?? 0 }}</p>
        </div>
        <div class="card fact">
          <p class="fact__label">Granted rules</p>
          <p class="fact__value">{{ grantTotal }}</p>
        </div>
        <div class="card fact">
          <p class="fact__label">Priority</p>
          <p class="fact__value">{{ role.priority }}</p>
        </div>
        <div class="card fact">
          <p class="fact__label">Scopes</p>
          <p class="fact__value fact__value--text">{{ (role.allowedScopes || []).join(', ') || 'global' }}</p>
        </div>
      </section>

      <p v-if="role.isSuperAdmin" class="alert alert--warning">
        A super-admin role bypasses grant checks entirely, so the list below has no effect on what it can do.
      </p>

      <section class="card grants">
        <header class="grants__header">
          <h2 class="grants__title">Effective grants</h2>
          <RouterLink :to="matrixLink" class="grants__link">Open in permission matrix →</RouterLink>
        </header>

        <p v-if="!heldByGroup.length && !orphanedGrants.length" class="state">
          This role grants nothing yet.
        </p>

        <div v-for="group in heldByGroup" :key="group.group" class="grants__group">
          <h3 class="grants__group-title">{{ group.group }}</h3>

          <div v-for="item in group.items" :key="item.resource" class="grant">
            <div class="grant__identity">
              <span class="grant__label">{{ item.label }}</span>
              <code class="grant__resource">{{ item.resource }}</code>
            </div>

            <div class="grant__actions">
              <span v-if="item.full" class="chip chip--full">All actions</span>
              <span v-for="action in item.held" v-else :key="action" class="chip">{{ action }}</span>
            </div>
          </div>
        </div>

        <div v-if="orphanedGrants.length" class="grants__group">
          <h3 class="grants__group-title grants__group-title--warning">Undeclared resources</h3>
          <p class="grants__note">
            No loaded module declares these, so they grant nothing. They are kept until someone removes them.
          </p>

          <div v-for="grant in orphanedGrants" :key="grant.resource" class="grant">
            <div class="grant__identity">
              <code class="grant__resource">{{ grant.resource }}</code>
            </div>
            <div class="grant__actions">
              <span v-for="action in grant.actions" :key="action" class="chip chip--muted">{{ action }}</span>
            </div>
          </div>
        </div>
      </section>

      <RoleEditor :open="editorOpen" :role="role" @close="editorOpen = false" @saved="onSaved" />
    </template>
  </div>
</template>

<style scoped>

/* This screen's meta line is a row of status tags rather than a sentence, so
   it needs to lay them out. The shared rule stays plain text for every other
   screen. */
.page-header__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.page-header__meta code {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

.page-header__actions .btn {
  text-decoration: none;
}

.tag {
  padding: 0.0625rem 0.4375rem;
  border-radius: var(--radius-sm);
  background: var(--color-surface-hover);
  color: var(--color-text-muted);
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.tag--danger {
  background: color-mix(in srgb, var(--color-danger) 14%, transparent);
  color: var(--color-danger);
}

.tag--muted {
  opacity: 0.8;
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.fact {
  padding: var(--space-4) var(--space-6);
}

.fact__label {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.fact__value {
  margin: 0.25rem 0 0;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.2;
}

.fact__value--text {
  font-size: 0.9375rem;
  font-weight: 600;
}

.grants__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.grants__title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 700;
}

.grants__link {
  margin-left: auto;
  font-size: 0.875rem;
  text-decoration: none;
}

.grants__group + .grants__group {
  margin-top: 1.5rem;
}

.grants__group-title {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.grants__group-title--warning {
  color: var(--color-warning);
}

.grants__note {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.grant {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0;
  border-bottom: 1px solid var(--color-border);
}

.grant:last-child {
  border-bottom: 0;
}

.grant__identity {
  flex: 1 1 18rem;
  min-width: 0;
}

.grant__label {
  display: block;
  font-weight: 600;
}

.grant__resource {
  display: block;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.grant__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3125rem;
}

.chip {
  padding: 0.125rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.chip--full {
  border-color: transparent;
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
  color: var(--color-success);
  font-family: inherit;
  font-weight: 600;
}

.chip--muted {
  color: var(--color-text-muted);
  opacity: 0.75;
}

.state {
  padding: 1.5rem 0;
  color: var(--color-text-muted);
}

.alert {
  padding: 0.625rem 0.875rem;
  margin-bottom: 1rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
}

.alert--warning {
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  color: var(--color-warning);
}

.alert--danger {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}
</style>
