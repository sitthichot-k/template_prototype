<script setup>
/**
 * Renders a whole settings group from its schema.
 *
 * Owns three things the individual fields cannot: section grouping,
 * conditional visibility (`dependsOn`), and dirty tracking so a save sends
 * only what actually changed. Sending only changes matters - a full-object
 * PUT would overwrite a value another administrator edited between load and
 * save, and would rewrite secrets the form never received.
 */

import { computed, reactive, ref, watch } from 'vue';
import SchemaField from './SchemaField.vue';

const props = defineProps({
  /** `[{ section, items: [descriptor] }]` from GET /settings/schema */
  sections: { type: Array, required: true },
  saving: { type: Boolean, default: false },
  /** `{ 'setting.key': 'message' }` from a 422 response */
  errors: { type: Object, default: () => ({}) }
});

const emit = defineEmits(['submit', 'cancel']);

/** Working copy; the descriptors keep the pristine values for comparison. */
const draft = reactive({});
const initial = ref({});

function seed() {
  const next = {};
  for (const section of props.sections) {
    for (const item of section.items) {
      // A secret's value is never sent to the client, so it starts empty and
      // is only submitted if the administrator types a new one.
      next[item.key] = item.secret ? '' : item.value;
    }
  }
  initial.value = JSON.parse(JSON.stringify(next));
  Object.keys(draft).forEach((key) => delete draft[key]);
  Object.assign(draft, next);
}

watch(() => props.sections, seed, { immediate: true, deep: false });

/** Keys whose value differs from what was loaded. */
const changedKeys = computed(() =>
  Object.keys(draft).filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(initial.value[key]))
);

const isDirty = computed(() => changedKeys.value.length > 0);

/**
 * A field with `dependsOn` is shown only when its controlling setting holds
 * the required value - so SMTP host and port disappear when mail is off,
 * rather than sitting there inert.
 */
function isVisible(descriptor) {
  if (!descriptor.dependsOn) return true;
  return draft[descriptor.dependsOn.key] === descriptor.dependsOn.equals;
}

function visibleItems(section) {
  return section.items.filter(isVisible);
}

function onSubmit() {
  const values = {};
  for (const key of changedKeys.value) {
    // An untouched secret is an empty string; submitting it would clear the
    // stored value.
    if (draft[key] === '' && findDescriptor(key)?.secret) continue;
    values[key] = draft[key];
  }
  emit('submit', values);
}

function findDescriptor(key) {
  for (const section of props.sections) {
    const found = section.items.find((item) => item.key === key);
    if (found) return found;
  }
  return null;
}

function onReset() {
  seed();
  emit('cancel');
}

function sectionTitle(name) {
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/([A-Z])/g, ' $1');
}

defineExpose({ isDirty, changedKeys });
</script>

<template>
  <form class="schema-form" @submit.prevent="onSubmit">
    <!-- `v-show` rather than `v-if`: a section whose every field is currently
         hidden by `dependsOn` would otherwise leave an empty card behind. -->
    <section
      v-for="section in sections"
      v-show="visibleItems(section).length"
      :key="section.section"
      class="card schema-form__section"
    >
      <h3 class="schema-form__section-title">{{ sectionTitle(section.section) }}</h3>

      <SchemaField
        v-for="item in visibleItems(section)"
        :key="item.key"
        v-model="draft[item.key]"
        :descriptor="item"
        :error="errors[item.key]"
        :disabled="saving"
      />
    </section>

    <footer class="schema-form__actions">
      <p v-if="isDirty" class="schema-form__dirty">
        {{ changedKeys.length }} unsaved change{{ changedKeys.length === 1 ? '' : 's' }}
      </p>

      <button type="button" class="btn btn--ghost" :disabled="!isDirty || saving" @click="onReset">
        Discard
      </button>
      <button type="submit" class="btn btn--primary" :disabled="!isDirty || saving">
        {{ saving ? 'Saving…' : 'Save changes' }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.schema-form__section {
  padding: var(--space-4) var(--space-6);
  margin-bottom: 1rem;
}

.schema-form__section-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  margin: 0;
  padding-bottom: 0.25rem;
}

/* The last field in a card would otherwise draw a rule against the card's own
   border. */
.schema-form__section :deep(.schema-field:last-child) {
  border-bottom: 0;
  padding-bottom: 0;
}

.schema-form__actions {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 0;
  background: var(--color-bg);
  border-top: 1px solid var(--color-border);
}

.schema-form__dirty {
  margin-right: auto;
  font-size: 0.8125rem;
  color: var(--color-warning);
}
</style>
