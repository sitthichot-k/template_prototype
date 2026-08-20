<script setup>
/**
 * Sign-in screen.
 *
 * Branding comes from the public info endpoint, so a generated project looks
 * like itself before anyone has authenticated. Which credential providers to
 * offer is also a server decision - adding SSO to a deployment makes the
 * button appear without a frontend change.
 */

import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth.store';
import { usePlatformStore } from '@/stores/platform.store';
import { ApiError } from '@/services/api';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const platform = usePlatformStore();

const identifier = ref('');
const password = ref('');
const error = ref('');
const submitting = ref(false);
const loading = ref(true);
// Set when the API cannot be reached at all, as opposed to rejecting us.
const unreachable = ref(false);

const info = computed(() => platform.publicInfo || {});
const ssoProvider = computed(() => auth.providers.find((provider) => provider.kind === 'redirect'));
const hasLocalProvider = computed(() => auth.providers.some((provider) => provider.id === 'local'));

onMounted(async () => {
  if (route.query.expired) error.value = t('auth.sessionExpired');

  // Swallowing these failures produced a login screen with a heading and
  // nothing else - no form, no error, no clue. A page that cannot reach its
  // API must say so; silence turns a five-minute configuration mistake into
  // an afternoon.
  try {
    await Promise.all([
      auth.loadProviders(),
      platform.publicInfo ? Promise.resolve() : platform.loadPublicInfo()
    ]);
  } catch (err) {
    unreachable.value = true;
    error.value = err.code === 'NETWORK_ERROR' ? t('error.network') : err.message;
  } finally {
    loading.value = false;
  }
});

async function submit() {
  error.value = '';
  submitting.value = true;

  try {
    await auth.login({ identifier: identifier.value, password: password.value });
    router.push(route.query.returnTo || { name: 'dashboard' });
  } catch (err) {
    // The server deliberately does not distinguish "no such account" from
    // "wrong password"; the UI must not invent that distinction either.
    error.value =
      err instanceof ApiError && err.code === 'INVALID_CREDENTIALS' ? t('auth.invalidCredentials') : err.message;
  } finally {
    submitting.value = false;
  }
}

function signInWithSso() {
  auth.startSso(route.query.returnTo || '/');
}

function reload() {
  window.location.reload();
}
</script>

<template>
  <div class="login">
    <div class="login__card card">
      <header class="login__header">
        <img v-if="info.branding?.logoUrl" :src="info.branding.logoUrl" alt="" class="login__logo" />
        <h1 class="login__title">{{ info.appName || 'Sign in' }}</h1>
        <p v-if="info.organizationName" class="login__organization">{{ info.organizationName }}</p>
      </header>

      <div v-if="info.maintenance?.enabled" class="alert alert--warning" role="alert">
        {{ info.maintenance.message }}
      </div>

      <p v-if="error" class="alert alert--error" role="alert">{{ error }}</p>

      <p v-if="loading" class="login__state">{{ t('common.loading') }}</p>

      <!-- No provider reached us: say what to check rather than showing an
           empty card. -->
      <div v-else-if="unreachable" class="login__state">
        <p>Could not reach the API.</p>
        <button type="button" class="btn btn--ghost login__submit" @click="reload">Try again</button>
      </div>

      <p v-else-if="!hasLocalProvider && !ssoProvider" class="login__state">
        No sign-in method is enabled for this deployment.
      </p>

      <form v-if="!loading && hasLocalProvider" class="login__form" @submit.prevent="submit">
        <label class="login__field">
          <span>{{ t('auth.email') }}</span>
          <input
            v-model="identifier"
            type="text"
            autocomplete="username"
            required
            :disabled="submitting"
            class="login__input"
          />
        </label>

        <label class="login__field">
          <span>{{ t('auth.password') }}</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            :disabled="submitting"
            class="login__input"
          />
        </label>

        <button type="submit" class="btn btn--primary login__submit" :disabled="submitting">
          {{ submitting ? t('common.loading') : t('auth.signIn') }}
        </button>
      </form>

      <template v-if="!loading && ssoProvider">
        <div v-if="hasLocalProvider" class="login__divider"><span>or</span></div>

        <button type="button" class="btn btn--ghost login__submit" @click="signInWithSso">
          {{ ssoProvider.name || t('auth.signInWithSso') }}
        </button>
      </template>

      <!-- The one screen where a support address earns its place: someone who
           cannot sign in cannot reach anything else in the application. -->
      <p v-if="info.supportEmail" class="login__support">
        Trouble signing in?
        <a :href="`mailto:${info.supportEmail}`">{{ info.supportEmail }}</a>
      </p>
    </div>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 1.5rem;
}

.login__card {
  width: 100%;
  max-width: 24rem;
}

.login__header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.login__logo {
  height: 3rem;
  margin-bottom: 0.75rem;
}

.login__title {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0;
}

.login__organization {
  margin: 0.125rem 0 0;
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.login__support {
  margin: 1.25rem 0 0;
  font-size: 0.8125rem;
  text-align: center;
  color: var(--color-text-muted);
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.login__field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.login__input {
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}

.login__submit {
  width: 100%;
  margin-top: 0.25rem;
}

.login__divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1rem 0;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}

.login__state {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.login__divider::before,
.login__divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border);
}

.alert {
  padding: 0.625rem 0.875rem;
  border-radius: var(--radius-md);
  margin-bottom: 1rem;
  font-size: 0.875rem;
}

.alert--error {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}

.alert--warning {
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  color: var(--color-warning);
}
</style>
