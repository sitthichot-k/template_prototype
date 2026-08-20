<script setup>
/**
 * Create or edit a role's identity.
 *
 * Grants are absent from this form by design, and the reason is recorded on
 * the role detail screen: the permission matrix is the single editing surface
 * for them, so an audit asking "who changed this grant" has one place to look
 * and the two screens cannot disagree about what a partially-granted resource
 * looks like. This form owns the role's identity and lifecycle; the matrix owns
 * what it can do.
 *
 * A new role is therefore created with no grants at all, and the footer says so
 * rather than leaving someone to discover it after the fact.
 */

import { computed, ref, watch } from 'vue';
import api from '@/services/api';
import ModalDialog from '@/components/common/ModalDialog.vue';
import FormField from '@/components/common/FormField.vue';
import { provideRequiredFields } from '@/composables/useRequiredFields';

const props = defineProps({
  /** `null` creates; an existing role edits. */
  role: { type: Object, default: null },
  open: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'saved']);

const saving = ref(false);
const error = ref('');
const form = ref(blank());

const { validate, clear } = provideRequiredFields();

const isCreate = computed(() => !props.role);
/** System roles are the platform's own; the API refuses to change them. */
const isSystem = computed(() => Boolean(props.role?.isSystem));

function blank() {
  return {
    code: '',
    name: '',
    description: '',
    priority: 100,
    isActive: true,
    isSuperAdmin: false
  };
}

watch(
  () => [props.open, props.role],
  ([open]) => {
    if (!open) return;
    error.value = '';
    clear();

    const source = props.role || {};
    form.value = {
      code: source.code || '',
      name: source.name || '',
      description: source.description || '',
      priority: source.priority ?? 100,
      isActive: source.isActive ?? true,
      isSuperAdmin: Boolean(source.isSuperAdmin)
    };
  },
  { immediate: true }
);

/** `^[A-Za-z][A-Za-z0-9_]{1,40}$`, mirroring the API so the error arrives sooner. */
const codeError = computed(() => {
  const value = form.value.code.trim();
  if (!value) return '';
  if (!/^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(value)) {
    return 'Start with a letter, then letters, digits or underscores — 2 to 41 characters.';
  }
  return '';
});

/**
 * Only the conditions the form itself can judge. Emptiness is left to
 * `validate()`, so a blank required field produces a message pointing at the
 * field rather than a permanently greyed-out button that explains nothing.
 */
const canSave = computed(() => !isSystem.value && !codeError.value);

async function save() {
  if (!canSave.value || !validate()) return;

  saving.value = true;
  error.value = '';

  const payload = {
    code: form.value.code.trim(),
    name: form.value.name.trim(),
    description: form.value.description || '',
    priority: Number(form.value.priority),
    isActive: form.value.isActive,
    isSuperAdmin: form.value.isSuperAdmin
  };

  try {
    if (props.role?.id) {
      await api.patch(`/roles/${props.role.id}`, payload);
    } else {
      await api.post('/roles', payload);
    }
    emit('saved');
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

/**
 * Uppercase snake case is the convention the seeded roles already follow.
 *
 * Only applied while creating. Reformatting an existing role's code on blur
 * would be an edit nobody asked for, of the one field this form warns is
 * referenced by policies - so a stray focus could break a rule silently.
 */
function normaliseCode() {
  if (!isCreate.value) return;
  form.value.code = form.value.code.trim().replace(/[\s-]+/g, '_').toUpperCase();
}
</script>

<template>
  <ModalDialog :open="open" :title="isCreate ? 'New role' : 'Edit role'" @close="emit('close')">
    <form id="role-form" @submit.prevent="save">
      <p v-if="error" class="form-alert form-alert--danger" role="alert">{{ error }}</p>

      <p v-if="isSystem" class="form-alert form-alert--warning">
        This is a system role. The platform depends on it, so the API will not accept changes to it.
      </p>

      <FormField
        label="Code"
        required
        :error="codeError"
        help="The stable identifier used in policies and permission links. Changing it later breaks any policy that names this role as a subject."
      >
        <input
          v-model="form.code"
          class="form-field__control form-field__control--mono"
          maxlength="41"
          placeholder="DEPARTMENT_MANAGER"
          :disabled="isSystem"
          @blur="normaliseCode"
        />
      </FormField>

      <FormField label="Name" required help="Shown wherever the role is offered — keep it readable.">
        <input v-model="form.name" class="form-field__control" maxlength="150" :disabled="isSystem" />
      </FormField>

      <FormField label="Description">
        <textarea
          v-model="form.description"
          class="form-field__control"
          rows="2"
          maxlength="500"
          :disabled="isSystem"
        />
      </FormField>

      <FormField
        label="Priority"
        help="Orders the role lists, so the roles people reach for most sit at the top. It does not affect what the role is allowed to do — grants are additive."
      >
        <input
          v-model.number="form.priority"
          type="number"
          class="form-field__control"
          min="0"
          max="1000"
          :disabled="isSystem"
        />
      </FormField>

      <FormField
        inline
        label="Active"
        help="An inactive role keeps its assignments but grants nothing until it is switched back on."
      >
        <input v-model="form.isActive" type="checkbox" :disabled="isSystem" />
      </FormField>

      <FormField
        inline
        label="Super administrator"
        help="Allows everything without consulting grants at all, so the permission matrix stops describing what this role can do. Only an explicit deny or a deny policy still applies. Reserve it for break-glass accounts."
      >
        <input v-model="form.isSuperAdmin" type="checkbox" :disabled="isSystem" />
      </FormField>

      <p v-if="form.isSuperAdmin && !props.role?.isSuperAdmin" class="form-alert form-alert--warning">
        Anyone holding this role will be able to do anything in the application.
      </p>

      <p v-if="isCreate" class="form-field__help create-note">
        The role is created with no grants. Open it in the permission matrix afterwards to choose what it can do.
      </p>
    </form>

    <template #footer>
      <button type="button" class="btn btn--ghost" @click="emit('close')">Cancel</button>
      <button type="submit" form="role-form" class="btn btn--primary" :disabled="!canSave || saving">
        {{ saving ? 'Saving…' : isCreate ? 'Create role' : 'Save changes' }}
      </button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.create-note {
  display: block;
  margin: 0.75rem 0 0;
}
</style>
