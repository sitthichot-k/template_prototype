<script setup>
/**
 * Self-service profile.
 *
 * Also the forced-password-change screen: the router sends a user here and
 * keeps them here while `mustChangePassword` is set, which is how the
 * bootstrap administrator's generated password stops being usable.
 */

import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api, { ApiError } from '@/services/api';
import { usePlatformStore } from '@/stores/platform.store';
import { useAuthStore } from '@/stores/auth.store';
import { useTheme } from '@/composables/useTheme';

import { formatDateTime } from '@/composables/useFormat';
const route = useRoute();
const router = useRouter();
const platform = usePlatformStore();
const auth = useAuthStore();
const theme = useTheme();

const THEME_CHOICES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Follow the device' }
];

const forced = computed(() => route.query.forcePasswordChange === '1' || platform.user?.mustChangePassword);

const passwords = ref({ currentPassword: '', newPassword: '', confirmPassword: '' });
const sessions = ref([]);
const errors = ref({});
const notice = ref('');
const saving = ref(false);

async function loadSessions() {
  sessions.value = await api.get('/users/me/sessions');
}

loadSessions();

async function changePassword() {
  saving.value = true;
  errors.value = {};
  notice.value = '';

  try {
    await api.post('/users/me/password', passwords.value);
    // Every session including this one is revoked server-side, so the only
    // correct next step is to sign in again.
    notice.value = 'Password changed. Please sign in again.';
    setTimeout(() => {
      auth.clear();
      router.push({ name: 'login' });
    }, 1500);
  } catch (error) {
    if (error instanceof ApiError && error.isValidation) {
      errors.value = Object.fromEntries(
        Object.entries(error.details || {}).map(([key, messages]) => [key, messages.join(' ')])
      );
    } else {
      notice.value = error.message;
    }
  } finally {
    saving.value = false;
  }
}

async function revokeSession(id) {
  await api.delete(`/users/me/sessions/${id}`);
  await loadSessions();
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1 class="page-header__title">Profile</h1>
    </header>

    <p v-if="forced" class="alert alert--warning">
      You must set a new password before you can use the rest of the application.
    </p>

    <p v-if="notice" class="alert">{{ notice }}</p>

    <section class="card">
      <h2 class="section__title">Account</h2>
      <dl class="details">
        <dt>Name</dt>
        <dd>{{ platform.user?.displayName }}</dd>
        <dt>Email</dt>
        <dd>{{ platform.user?.email }}</dd>
        <dt>Roles</dt>
        <dd>{{ (platform.user?.roles || []).map((r) => r.name).join(', ') || '—' }}</dd>
      </dl>
    </section>

    <section class="card">
      <h2 class="section__title">Appearance</h2>
      <p class="section__hint">
        Applies to this browser only. "Follow the device" uses your operating system's setting; when you have never
        chosen, the deployment's default is used.
      </p>

      <div class="choices" role="radiogroup" aria-label="Theme">
        <button
          v-for="choice in THEME_CHOICES"
          :key="choice.value"
          type="button"
          class="choice"
          :class="{ 'choice--active': theme.preference.value === choice.value }"
          role="radio"
          :aria-checked="theme.preference.value === choice.value"
          @click="theme.setPreference(choice.value)"
        >
          <span class="choice__swatch" :data-theme-preview="choice.value" aria-hidden="true" />
          {{ choice.label }}
        </button>
      </div>
    </section>

    <section class="card">
      <h2 class="section__title">Change password</h2>

      <form class="form" @submit.prevent="changePassword">
        <label class="form__field">
          <span>Current password</span>
          <input v-model="passwords.currentPassword" type="password" autocomplete="current-password" required />
          <em v-if="errors.currentPassword" class="form__error">{{ errors.currentPassword }}</em>
        </label>

        <label class="form__field">
          <span>New password</span>
          <input v-model="passwords.newPassword" type="password" autocomplete="new-password" required />
          <em v-if="errors.newPassword" class="form__error">{{ errors.newPassword }}</em>
        </label>

        <label class="form__field">
          <span>Confirm new password</span>
          <input v-model="passwords.confirmPassword" type="password" autocomplete="new-password" required />
          <em v-if="errors.confirmPassword" class="form__error">{{ errors.confirmPassword }}</em>
        </label>

        <button type="submit" class="btn btn--primary" :disabled="saving">
          {{ saving ? 'Saving…' : 'Change password' }}
        </button>
      </form>
    </section>

    <section class="card">
      <h2 class="section__title">Signed in on</h2>

      <ul class="sessions">
        <li v-for="session in sessions" :key="session.id" class="sessions__item">
          <div>
            <strong>{{ session.device.ip || 'Unknown IP' }}</strong>
            <span v-if="session.isCurrent" class="sessions__current">this device</span>
            <p class="sessions__meta">
              {{ session.device.userAgent || 'Unknown device' }} ·
              last seen {{ formatDateTime(session.lastSeenAt) }}
            </p>
          </div>

          <button
            v-if="!session.isCurrent"
            type="button"
            class="btn btn--ghost btn--sm"
            @click="revokeSession(session.id)"
          >
            Revoke
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 42rem;
}
.card + .card {
  margin-top: 1.25rem;
}
.section__title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 0.75rem;
}
.section__hint {
  margin: -0.375rem 0 0.875rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
}
.choice {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}
.choice:hover {
  background: var(--color-surface-hover);
}
.choice--active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 600;
}
/* A literal preview of what the option does, which reads faster than the word. */
.choice__swatch {
  width: 1rem;
  height: 1rem;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
}
.choice__swatch[data-theme-preview='light'] {
  background: #ffffff;
}
.choice__swatch[data-theme-preview='dark'] {
  background: #000000;
}
.choice__swatch[data-theme-preview='system'] {
  background: linear-gradient(135deg, #ffffff 0%, #ffffff 49%, #000000 51%, #000000 100%);
}
.details {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.875rem;
}
.details dt {
  color: var(--color-text-muted);
}
.details dd {
  margin: 0;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 22rem;
}
.form__field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
}
.form__field input {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}
.form__error {
  color: var(--color-danger);
  font-size: 0.8125rem;
  font-style: normal;
  font-weight: 400;
}
.sessions {
  list-style: none;
  margin: 0;
  padding: 0;
}
.sessions__item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--color-border);
}
.sessions__item .btn {
  margin-left: auto;
}
.sessions__current {
  margin-left: 0.5rem;
  padding: 0.0625rem 0.4375rem;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
  color: var(--color-success);
  font-size: 0.6875rem;
}
.sessions__meta {
  margin: 0.125rem 0 0;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
.btn--sm {
  padding: 0.25rem 0.625rem;
  font-size: 0.8125rem;
}
.alert {
  padding: 0.625rem 0.875rem;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  color: var(--color-info);
  font-size: 0.875rem;
  margin-bottom: 1rem;
}
.alert--warning {
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  color: var(--color-warning);
}
</style>
