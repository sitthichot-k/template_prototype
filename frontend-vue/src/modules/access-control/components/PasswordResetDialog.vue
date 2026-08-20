<script setup>
/**
 * Administrative password reset.
 *
 * Kept out of the user editor on purpose. Setting someone else's password is a
 * different decision from correcting their department, it is guarded by its own
 * permission (`/security/users:reset-password`), and it is audited separately.
 * A single form that did both would be reached by anyone holding either
 * permission and would have to hide half of itself.
 *
 * The typed password is shown rather than masked. It has to be read out to the
 * person it belongs to, and a masked field that must then be re-typed
 * correctly into a chat message is how administrators end up pasting it
 * somewhere to check it first.
 */

import { computed, ref, watch } from 'vue';
import api from '@/services/api';
import ModalDialog from '@/components/common/ModalDialog.vue';
import FormField from '@/components/common/FormField.vue';
import { provideRequiredFields } from '@/composables/useRequiredFields';
import { usePlatformStore } from '@/stores/platform.store';
import { describePasswordProblem, suggestPassword } from '../password-policy';

const props = defineProps({
  user: { type: Object, default: null },
  open: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'done']);

const platform = usePlatformStore();

const password = ref('');
const saving = ref(false);
const error = ref('');
const done = ref(false);

const { validate, clear } = provideRequiredFields();

const minLength = computed(() => Number(platform.setting('security.password.minLength', 12)));

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    password.value = '';
    error.value = '';
    done.value = false;
    clear();
  }
);

const problem = computed(() => describePasswordProblem(password.value, minLength.value));
const canSave = computed(() => !problem.value && !done.value);

function suggest() {
  password.value = suggestPassword(minLength.value);
}

async function submit() {
  if (!canSave.value || !validate()) return;

  saving.value = true;
  error.value = '';

  try {
    await api.post(`/users/${props.user.id}/password/reset`, { newPassword: password.value });
    done.value = true;
    emit('done');
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog :open="open" title="Reset password" size="sm" @close="emit('close')">
    <form id="password-reset-form" @submit.prevent="submit">
      <p v-if="error" class="form-alert form-alert--danger" role="alert">{{ error }}</p>

      <p v-if="done" class="form-alert form-alert--info">
        Password set for {{ props.user?.displayName }}. Every existing session has been signed out, and they must
        change it at next sign-in. Pass it on now — it is not recoverable from here.
      </p>

      <FormField
        :label="`New password for ${props.user?.displayName || 'this account'}`"
        required
        :error="problem"
        help="Shown in the clear so it can be read out accurately. Copy it before closing."
      >
        <input
          v-model="password"
          type="text"
          class="form-field__control form-field__control--mono"
          autocomplete="off"
          spellcheck="false"
          :readonly="done"
          :placeholder="`At least ${minLength} characters`"
        />
      </FormField>

      <button v-if="!done" type="button" class="btn btn--ghost btn--sm" @click="suggest">Suggest a password</button>
    </form>

    <template #footer>
      <button type="button" class="btn btn--ghost" @click="emit('close')">
        {{ done ? 'Done' : 'Cancel' }}
      </button>
      <button
        v-if="!done"
        type="submit"
        form="password-reset-form"
        class="btn btn--primary"
        :disabled="!canSave || saving"
      >
        {{ saving ? 'Setting…' : 'Set password' }}
      </button>
    </template>
  </ModalDialog>
</template>
