<script setup>
/**
 * Create or edit an access policy.
 *
 * The hard part of this form is `conditions`, and it is worth saying why it is
 * a JSON editor rather than a row of dropdowns. Conditions are an open map of
 * `field -> operator -> value`, and the operator set is deliberately small and
 * fixed. A builder UI would have to enumerate every combination and would then
 * be the thing standing between an administrator and a rule they can express
 * on the server. So the raw shape is editable, and the guardrails are advisory
 * instead: the field list is shown, and a condition on a field the
 * authorization context never provides is called out before it is saved.
 *
 * That last check exists because the two examples this project shipped for
 * months - `request.hour` and a CIDR range passed to `in` - both silently
 * never matched. A deny that never fires looks exactly like protection.
 */

import { computed, ref, watch } from 'vue';
import api from '@/services/api';
import ModalDialog from '@/components/common/ModalDialog.vue';
import FormField from '@/components/common/FormField.vue';
import { provideRequiredFields } from '@/composables/useRequiredFields';

const props = defineProps({
  /** `null` creates; an existing policy edits. */
  policy: { type: Object, default: null },
  open: { type: Boolean, default: false },
  /** `[{ code, name }]` used for the subject checkboxes. */
  roles: { type: Array, default: () => [] }
});

const emit = defineEmits(['close', 'saved']);

/**
 * The fields `core/security/authorize.js` puts in the context. A condition on
 * anything else reads `undefined` and can never match.
 */
const CONTEXT_FIELDS = ['user.id', 'user.roles', 'request.ip', 'request.method', 'request.path', 'request.at'];

const OPERATORS = ['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'exists'];

const COMMON_ACTIONS = ['view', 'create', 'edit', 'delete', 'assign', 'export', '*'];

const saving = ref(false);
const error = ref('');

const { validate, clear } = provideRequiredFields();

const form = ref(blank());
/** Held as text so a half-typed object does not destroy what was typed. */
const conditionsText = ref('{}');
const resourcesText = ref('');
const actionsText = ref('');

function blank() {
  return {
    name: '',
    description: '',
    effect: 'deny',
    subjects: [],
    priority: 100,
    isActive: false
  };
}

/** Newline-separated text <-> string array, for resources and actions. */
function toLines(list) {
  return (list || []).join('\n');
}
function fromLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

watch(
  () => [props.open, props.policy],
  ([open]) => {
    if (!open) return;
    error.value = '';
    clear();

    const source = props.policy || {};
    form.value = {
      name: source.name || '',
      description: source.description || '',
      effect: source.effect || 'deny',
      subjects: [...(source.subjects || [])],
      priority: source.priority ?? 100,
      isActive: Boolean(source.isActive)
    };
    resourcesText.value = toLines(source.resources);
    actionsText.value = toLines(source.actions);
    conditionsText.value = JSON.stringify(source.conditions || {}, null, 2);
  },
  { immediate: true }
);

const parsedConditions = computed(() => {
  try {
    const value = JSON.parse(conditionsText.value || '{}');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, message: 'Conditions must be a JSON object.' };
    }
    return { ok: true, value };
  } catch (err) {
    return { ok: false, message: `Invalid JSON: ${err.message}` };
  }
});

/**
 * Advisory checks. These never block a save - the server is the authority, and
 * a future context field would otherwise be unusable until this list caught up.
 */
const conditionWarnings = computed(() => {
  const parsed = parsedConditions.value;
  if (!parsed.ok) return [];

  const warnings = [];
  for (const [field, rule] of Object.entries(parsed.value)) {
    if (!CONTEXT_FIELDS.includes(field)) {
      warnings.push(`"${field}" is not provided by the authorization context, so this condition can never match.`);
    }
    if (field === 'user.roles') {
      warnings.push('Match roles with Subjects instead: operators compare single values, and user.roles is a list.');
    }
    if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
      for (const operator of Object.keys(rule)) {
        if (!OPERATORS.includes(operator)) {
          warnings.push(`"${operator}" is not a supported operator and will be ignored.`);
        }
      }
      const listRule = rule.in || rule.nin;
      if (Array.isArray(listRule) && listRule.some((entry) => String(entry).includes('/'))) {
        warnings.push('in / nin compare exact values, not CIDR ranges. List each address in full.');
      }
    }
  }
  return warnings;
});

const conditionsEmpty = computed(() => {
  const parsed = parsedConditions.value;
  return parsed.ok && Object.keys(parsed.value).length === 0;
});

/** Whichever conditions problem applies, as one message for the field. */
const conditionsMessage = computed(() => {
  if (!parsedConditions.value.ok) return parsedConditions.value.message;
  if (conditionsEmpty.value) {
    return 'At least one condition is required. A rule that always applies belongs on a role, not a policy.';
  }
  return '';
});

/**
 * Conditions only. Whether a required box has text in it is `validate()`'s
 * job; this covers the part it cannot judge - that the JSON parses and says
 * something, which is the rule the server also enforces.
 */
const canSave = computed(() => parsedConditions.value.ok && !conditionsEmpty.value);

async function save() {
  if (!canSave.value || !validate()) return;

  saving.value = true;
  error.value = '';

  const payload = {
    name: form.value.name.trim(),
    description: form.value.description || '',
    effect: form.value.effect,
    subjects: form.value.subjects,
    resources: fromLines(resourcesText.value),
    actions: fromLines(actionsText.value),
    conditions: parsedConditions.value.value,
    priority: Number(form.value.priority),
    isActive: form.value.isActive
  };

  try {
    if (props.policy?.id) {
      await api.patch(`/policies/${props.policy.id}`, payload);
    } else {
      await api.post('/policies', payload);
    }
    emit('saved');
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

function toggleSubject(code) {
  const index = form.value.subjects.indexOf(code);
  if (index === -1) form.value.subjects.push(code);
  else form.value.subjects.splice(index, 1);
}

function addAction(action) {
  const current = fromLines(actionsText.value);
  if (current.includes(action)) return;
  actionsText.value = toLines([...current, action]);
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="props.policy ? 'Edit policy' : 'New policy'"
    size="lg"
    @close="emit('close')"
  >
    <form id="policy-form" @submit.prevent="save">
      <p v-if="error" class="form-alert form-alert--danger" role="alert">{{ error }}</p>

      <FormField label="Name" required>
        <input v-model="form.name" class="form-field__control" maxlength="150" />
      </FormField>

      <FormField label="Description">
        <textarea v-model="form.description" class="form-field__control" rows="2" maxlength="500" />
      </FormField>

      <div class="form-row">
        <FormField label="Effect" help="A deny outranks every role grant, and even super-admin.">
          <select v-model="form.effect" class="form-field__control">
            <option value="deny">deny</option>
            <option value="allow">allow</option>
          </select>
        </FormField>

        <FormField label="Priority" help="Higher is evaluated first. The first match decides.">
          <input v-model.number="form.priority" type="number" class="form-field__control" min="0" max="1000" />
        </FormField>
      </div>

      <div class="form-field">
        <span class="form-field__label">Subjects</span>
        <div class="form-field__checks">
          <label v-for="role in props.roles" :key="role.code" class="form-field__check">
            <input type="checkbox" :checked="form.subjects.includes(role.code)" @change="toggleSubject(role.code)" />
            {{ role.name }}
          </label>
        </div>
        <span class="form-field__help">
          {{ form.subjects.length ? 'Applies only to the roles ticked.' : 'No roles ticked — applies to everyone.' }}
        </span>
      </div>

      <FormField label="Resources" required>
        <textarea
          v-model="resourcesText"
          class="form-field__control form-field__control--mono"
          rows="3"
          placeholder="/security/*"
        />
        <template #help>
          <span class="form-field__help">
            One per line. A trailing <code>/*</code> matches a subtree; <code>*</code> matches everything.
          </span>
        </template>
      </FormField>

      <FormField label="Actions" required help="One per line.">
        <textarea
          v-model="actionsText"
          class="form-field__control form-field__control--mono"
          rows="3"
          placeholder="edit"
        />
        <span class="chips">
          <button v-for="action in COMMON_ACTIONS" :key="action" type="button" class="chip" @click="addAction(action)">
            + {{ action }}
          </button>
        </span>
      </FormField>

      <FormField label="Conditions" required :error="conditionsMessage">
        <textarea
          v-model="conditionsText"
          class="form-field__control form-field__control--mono"
          rows="6"
          spellcheck="false"
        />

        <span v-for="warning in conditionWarnings" :key="warning" class="form-field__warning">{{ warning }}</span>

        <details class="reference">
          <summary>Available fields and operators</summary>
          <p class="reference__group">
            <strong>Fields</strong>
            <code v-for="field in CONTEXT_FIELDS" :key="field">{{ field }}</code>
          </p>
          <p class="reference__group">
            <strong>Operators</strong>
            <code v-for="operator in OPERATORS" :key="operator">{{ operator }}</code>
          </p>
          <p class="form-field__help">
            Values are compared exactly — <code>in</code> is list membership, not a CIDR or pattern match. Dates work as
            ISO-8601 UTC text: <code>{ "request.at": { "gte": "2026-12-24T00:00:00.000Z" } }</code>
          </p>
        </details>
      </FormField>

      <FormField inline label="Active" help="Check the rule with the simulator before switching it on.">
        <input v-model="form.isActive" type="checkbox" />
      </FormField>
    </form>

    <template #footer>
      <button type="button" class="btn btn--ghost" @click="emit('close')">Cancel</button>
      <button type="submit" form="policy-form" class="btn btn--primary" :disabled="!canSave || saving">
        {{ saving ? 'Saving…' : 'Save policy' }}
      </button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.chip {
  padding: 0.125rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface-hover);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  cursor: pointer;
}

.chip:hover {
  color: var(--color-text);
}

.reference {
  margin-top: 0.25rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.reference summary {
  cursor: pointer;
}

.reference__group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  margin: 0.5rem 0 0;
}

.reference code {
  padding: 0.0625rem 0.375rem;
  border-radius: var(--radius-sm);
  background: var(--color-surface-hover);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}
</style>
