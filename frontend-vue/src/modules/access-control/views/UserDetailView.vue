<script setup>
/**
 * User detail.
 *
 * Role assignment is guarded by `/security/roles:assign` rather than
 * `/security/users:edit` - making someone an administrator is a different
 * decision from correcting their phone number, and the API draws the same
 * line.
 */

import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '@/services/api';
import UserEditor from '../components/UserEditor.vue';
import PasswordResetDialog from '../components/PasswordResetDialog.vue';

const route = useRoute();
const router = useRouter();

const user = ref(null);
const roles = ref([]);
const selectedRoleIds = ref([]);
const effective = ref(null);
const loading = ref(true);
const saving = ref(false);
const notice = ref('');

const editorOpen = ref(false);
const resetOpen = ref(false);

onMounted(load);

async function load() {
  loading.value = true;
  try {
    user.value = await api.get(`/users/${route.params.id}`);
    selectedRoleIds.value = user.value.roleBindings.filter((b) => b.role).map((b) => b.role.id);

    const roleList = await api.list('/roles', { limit: 200 });
    roles.value = roleList.items;
  } finally {
    loading.value = false;
  }
}

async function saveRoles() {
  saving.value = true;
  notice.value = '';
  try {
    await api.put(`/users/${route.params.id}/roles`, { roleIds: selectedRoleIds.value });
    notice.value = 'Roles updated. The user must sign in again for the change to apply everywhere.';
    await load();
  } catch (error) {
    notice.value = error.message;
  } finally {
    saving.value = false;
  }
}

async function loadEffective() {
  effective.value = await api.get(`/users/${route.params.id}/effective-permissions`);
}

async function changeStatus(status) {
  await api.put(`/users/${route.params.id}/status`, { status });
  await load();
}

async function onEdited() {
  editorOpen.value = false;
  await load();
}

/**
 * Signs the account out everywhere without changing anything about it - the
 * response to a lost laptop, where a password reset would also lock the owner
 * out of an account they still need.
 */
async function revokeSessions() {
  if (!window.confirm(`Sign ${user.value.displayName} out of every device?`)) return;

  notice.value = '';
  try {
    await api.delete(`/users/${route.params.id}/sessions`);
    notice.value = 'All sessions for this account have been ended.';
  } catch (error) {
    notice.value = error.message;
  }
}

async function remove() {
  if (!window.confirm(`Delete ${user.value.displayName} (${user.value.email})? Their sessions end immediately.`)) {
    return;
  }

  try {
    await api.delete(`/users/${route.params.id}`);
    router.push({ name: 'security-users' });
  } catch (error) {
    notice.value = error.message;
  }
}
</script>

<template>
  <div class="page">
    <p v-if="loading">Loading…</p>

    <template v-else-if="user">
      <header class="page-header">
        <div>
          <h1 class="page-header__title">{{ user.displayName }}</h1>
          <p class="page-header__meta">{{ user.email }} · {{ user.status }}</p>
        </div>

        <div class="page-header__actions">
          <button v-can="'/security/users:edit'" type="button" class="btn btn--ghost" @click="editorOpen = true">
            Edit
          </button>
          <button
            v-can="'/security/users:reset-password'"
            type="button"
            class="btn btn--ghost"
            @click="resetOpen = true"
          >
            Reset password
          </button>
          <button
            v-if="user.status === 'active'"
            v-can="'/security/users:edit'"
            type="button"
            class="btn btn--ghost"
            @click="changeStatus('suspended')"
          >
            Suspend
          </button>
          <button
            v-else
            v-can="'/security/users:edit'"
            type="button"
            class="btn btn--ghost"
            @click="changeStatus('active')"
          >
            Activate
          </button>
          <button
            v-can="'/security/sessions:revoke'"
            type="button"
            class="btn btn--ghost"
            @click="revokeSessions"
          >
            Sign out everywhere
          </button>
          <button v-can="'/security/users:delete'" type="button" class="btn btn--danger-ghost" @click="remove">
            Delete
          </button>
        </div>
      </header>

      <p v-if="notice" class="alert">{{ notice }}</p>

      <section class="card">
        <h2 class="section__title">Roles</h2>

        <div class="roles">
          <label v-for="role in roles" :key="role.id" class="roles__item">
            <input v-model="selectedRoleIds" type="checkbox" :value="role.id" />
            <span>
              <strong>{{ role.name }}</strong>
              <em class="roles__code">{{ role.code }}</em>
            </span>
          </label>
        </div>

        <button
          v-can="'/security/roles:assign'"
          type="button"
          class="btn btn--primary"
          :disabled="saving"
          @click="saveRoles"
        >
          {{ saving ? 'Saving…' : 'Save roles' }}
        </button>
      </section>

      <section class="card">
        <h2 class="section__title">Effective permissions</h2>
        <button type="button" class="btn btn--ghost" @click="loadEffective">Calculate</button>

        <div v-if="effective" class="effective">
          <p v-if="effective.superAdmin" class="effective__super">
            This account holds a super-admin role and is allowed everything not explicitly denied.
          </p>
          <ul v-else class="effective__list">
            <li v-for="(actions, resource) in effective.permissions" :key="resource">
              <code>{{ resource }}</code> → {{ actions.join(', ') }}
            </li>
          </ul>
        </div>
      </section>

      <UserEditor :open="editorOpen" :user="user" @close="editorOpen = false" @saved="onEdited" />
      <PasswordResetDialog :open="resetOpen" :user="user" @close="resetOpen = false" @done="load" />
    </template>
  </div>
</template>

<style scoped>
.card + .card {
  margin-top: 1.25rem;
}
.section__title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 0.75rem;
}
.roles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.roles__item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}
.roles__code {
  display: block;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-muted);
  font-style: normal;
}
.effective {
  margin-top: 0.75rem;
}
.effective__list {
  font-size: 0.8125rem;
  padding-left: 1.25rem;
}
.effective__super {
  color: var(--color-warning);
  font-size: 0.875rem;
}
.alert {
  padding: 0.625rem 0.875rem;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  color: var(--color-info);
  font-size: 0.875rem;
}
</style>
