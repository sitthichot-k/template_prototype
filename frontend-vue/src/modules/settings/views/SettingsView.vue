<script setup>
/**
 * The settings screen - one component for every settings group.
 *
 * It never names a setting. It asks the server for the schema, renders it,
 * and sends back what changed. Adding a settings group to a backend module
 * gives you a working, permission-aware screen at `/settings/<group>` with no
 * frontend work.
 *
 * The group switcher is built from the same schema response, so a group only
 * appears once the caller can actually read something inside it - which also
 * means it never offers a tab that would render empty.
 */

import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import api, { ApiError } from '@/services/api';
import { usePlatformStore } from '@/stores/platform.store';
import SchemaForm from '@/components/dynamic/SchemaForm.vue';

const route = useRoute();
const platform = usePlatformStore();

const schema = ref([]);
const loading = ref(false);
const saving = ref(false);
const errors = ref({});
const notice = ref(null);

const group = computed(() => route.params.group);

const currentGroup = computed(() => schema.value.find((entry) => entry.group === group.value) || null);

/** Human labels for the groups the platform ships; anything else is title-cased. */
const GROUP_LABELS = {
  general: 'General',
  branding: 'Branding',
  security: 'Security',
  notification: 'Notifications',
  localization: 'Localisation',
  observability: 'Monitoring',
  features: 'Feature flags',
  integration: 'Integrations'
};

const GROUP_DESCRIPTIONS = {
  general: 'Application identity, support contact and availability.',
  branding: 'Colour, logo and the theme new visitors start on.',
  security: 'Password policy, lockout, sessions and audit retention.',
  notification: 'Mail transport and delivery defaults.',
  localization: 'Language, timezone and how dates are written.',
  observability: 'How much traffic is logged, and for how long it is kept.',
  features: 'Switch features on and off without a deployment.',
  integration: 'Third-party credentials and endpoints.'
};

function labelFor(name) {
  return GROUP_LABELS[name] || name.charAt(0).toUpperCase() + name.slice(1);
}

const groupTitle = computed(() => labelFor(group.value || ''));

const groupDescription = computed(() => GROUP_DESCRIPTIONS[group.value] || '');

const tabs = computed(() => schema.value.map((entry) => ({ group: entry.group, label: labelFor(entry.group) })));

/** Total settings in the current group, shown so a short page looks deliberate. */
const fieldCount = computed(() =>
  (currentGroup.value?.sections || []).reduce((total, section) => total + section.items.length, 0)
);

async function load() {
  loading.value = true;
  errors.value = {};
  try {
    const data = await api.get('/settings/schema');
    schema.value = data.groups;
  } finally {
    loading.value = false;
  }
}

async function save(values) {
  saving.value = true;
  errors.value = {};
  notice.value = null;

  try {
    const result = await api.put('/settings', { scope: 'global', values });

    notice.value = {
      type: 'success',
      message: result.restartRequired
        ? 'Saved. Some changes take effect after the service restarts.'
        : 'Settings saved.'
    };

    if (result.rejected?.length) {
      notice.value = {
        type: 'warning',
        message: `Saved ${result.updated.length}, skipped ${result.rejected.length}: ${result.rejected
          .map((r) => r.key)
          .join(', ')}`
      };
    }

    // Re-read the schema so the form's pristine state matches what is stored,
    // and refresh the platform store in case branding or a flag changed.
    await load();
    await platform.bootstrap();
  } catch (error) {
    if (error instanceof ApiError && error.isValidation) {
      errors.value = Object.fromEntries(
        Object.entries(error.details || {}).map(([key, messages]) => [key, messages.join(' ')])
      );
      notice.value = { type: 'error', message: 'Some values were rejected. See the messages below.' };
    } else {
      notice.value = { type: 'error', message: error.message };
    }
  } finally {
    saving.value = false;
  }
}

watch(group, () => {
  notice.value = null;
  load();
}, { immediate: true });
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-header__title">{{ groupTitle }}</h1>
        <p v-if="groupDescription" class="page-header__description">{{ groupDescription }}</p>
      </div>
    </header>

    <nav v-if="tabs.length > 1" class="tabs" aria-label="Settings groups">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.group"
        :to="{ name: 'settings', params: { group: tab.group } }"
        class="tabs__link"
        :class="{ 'tabs__link--active': tab.group === group }"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>

    <div v-if="notice" class="alert" :class="`alert--${notice.type}`" role="status">
      {{ notice.message }}
    </div>

    <p v-if="loading" class="state">Loading…</p>

    <p v-else-if="!currentGroup" class="state">
      No settings in this group are available for your account.
    </p>

    <template v-else>
      <p class="count">{{ fieldCount }} setting{{ fieldCount === 1 ? '' : 's' }} in this group</p>

      <SchemaForm
        :sections="currentGroup.sections"
        :saving="saving"
        :errors="errors"
        @submit="save"
      />
    </template>
  </div>
</template>

<style scoped>
.page {
  max-width: 52rem;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 1.25rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border);
}

.tabs__link {
  padding: 0.375rem 0.75rem;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  font-size: 0.875rem;
  text-decoration: none;
}

.tabs__link:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.tabs__link--active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 600;
}

.count {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.state {
  color: var(--color-text-muted);
  padding: 2rem 0;
}

.alert {
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  margin-bottom: 1rem;
  font-size: 0.875rem;
}

.alert--success {
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  color: var(--color-success);
}

.alert--warning {
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  color: var(--color-warning);
}

.alert--error {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}
</style>
