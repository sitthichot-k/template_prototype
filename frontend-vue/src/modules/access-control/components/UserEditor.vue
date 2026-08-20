<script setup>
/**
 * Create a user, or edit an existing one's identity.
 *
 * The two modes send to different endpoints with deliberately different
 * shapes, and the form reflects that rather than hiding it:
 *
 *   create  POST  /users      email, displayName, optional username/password,
 *                             initial roles
 *   edit    PATCH /users/:id  displayName, username, profile
 *
 * Email is not editable after creation because it is the account's identity -
 * changing it is an account migration, not a correction, and the API does not
 * accept it on update. Roles are not editable here either: assignment is
 * guarded by `/security/roles:assign`, a different permission from editing a
 * user, and the detail screen owns it. Offering it here would let someone with
 * only `users:edit` believe they could grant a role, and be refused by the
 * server after filling in a form.
 */

import { computed, ref, watch } from 'vue';
import api from '@/services/api';
import ModalDialog from '@/components/common/ModalDialog.vue';
import FormField from '@/components/common/FormField.vue';
import { provideRequiredFields } from '@/composables/useRequiredFields';
import { usePlatformStore } from '@/stores/platform.store';
import { describePasswordProblem } from '../password-policy';

const props = defineProps({
  /** `null` creates; an existing user edits. */
  user: { type: Object, default: null },
  open: { type: Boolean, default: false },
  /** `[{ id, name, code }]`, offered as initial roles when creating. */
  roles: { type: Array, default: () => [] }
});

const emit = defineEmits(['close', 'saved']);

const platform = usePlatformStore();

const saving = ref(false);
const error = ref('');
const form = ref(blank());

const { validate, clear } = provideRequiredFields();

const isCreate = computed(() => !props.user);

/** The live policy, so the hint cannot drift from what the server enforces. */
const minPasswordLength = computed(() => Number(platform.setting('security.password.minLength', 12)));

function blank() {
  return {
    email: '',
    displayName: '',
    username: '',
    password: '',
    mustChangePassword: true,
    roleIds: [],
    profile: { phone: '', department: '', position: '' }
  };
}

watch(
  () => [props.open, props.user],
  ([open]) => {
    if (!open) return;
    error.value = '';
    clear();

    const source = props.user;
    if (!source) {
      form.value = blank();
      return;
    }

    form.value = {
      email: source.email || '',
      displayName: source.displayName || '',
      username: source.username || '',
      password: '',
      mustChangePassword: true,
      roleIds: [],
      profile: {
        phone: source.profile?.phone || '',
        department: source.profile?.department || '',
        position: source.profile?.position || ''
      }
    };
  },
  { immediate: true }
);

/** `alphanum`, 3-40, per the API. Empty is allowed - username is optional. */
const usernameError = computed(() => {
  const value = form.value.username.trim();
  if (!value) return '';
  if (!/^[a-zA-Z0-9]+$/.test(value)) return 'Letters and digits only — no spaces, dots or dashes.';
  if (value.length < 3 || value.length > 40) return 'Must be between 3 and 40 characters.';
  return '';
});

/**
 * Mirrors `assertPasswordPolicy` on the server. Duplicated deliberately: the
 * alternative is letting someone fill in the whole form and submit it to be
 * told the password lacks a symbol.
 */
const passwordError = computed(() => describePasswordProblem(form.value.password, minPasswordLength.value));

/**
 * Only format problems. Emptiness is `validate()`'s job, so a blank required
 * field is answered with a message on the field rather than a disabled button
 * that never says which one is missing.
 */
const canSave = computed(() => !usernameError.value && !passwordError.value);

async function save() {
  if (!canSave.value || !validate()) return;

  saving.value = true;
  error.value = '';

  const username = form.value.username.trim();

  try {
    if (isCreate.value) {
      const payload = {
        email: form.value.email.trim(),
        displayName: form.value.displayName.trim(),
        mustChangePassword: form.value.mustChangePassword,
        roleIds: form.value.roleIds,
        profile: cleanProfile()
      };
      // Both are optional on the API, and an empty string is not the same as
      // absent: it would fail the format rules instead of being skipped.
      if (username) payload.username = username;
      if (form.value.password) payload.password = form.value.password;

      await api.post('/users', payload);
    } else {
      await api.patch(`/users/${props.user.id}`, {
        displayName: form.value.displayName.trim(),
        // `null` clears it; the API accepts null but not ''.
        username: username || null,
        profile: cleanProfile()
      });
    }
    emit('saved');
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

function cleanProfile() {
  return {
    phone: form.value.profile.phone || '',
    department: form.value.profile.department || '',
    position: form.value.profile.position || ''
  };
}

function toggleRole(id) {
  const index = form.value.roleIds.indexOf(id);
  if (index === -1) form.value.roleIds.push(id);
  else form.value.roleIds.splice(index, 1);
}
</script>

<template>
  <ModalDialog :open="open" :title="isCreate ? 'New user' : 'Edit user'" @close="emit('close')">
    <form id="user-form" @submit.prevent="save">
      <p v-if="error" class="form-alert form-alert--danger" role="alert">{{ error }}</p>

      <FormField
        label="Email"
        :required="isCreate"
        :help="isCreate ? '' : 'The email identifies the account and cannot be changed here.'"
      >
        <input
          v-model="form.email"
          type="email"
          class="form-field__control"
          :disabled="!isCreate"
          autocomplete="off"
        />
      </FormField>

      <FormField label="Display name" required>
        <input v-model="form.displayName" class="form-field__control" maxlength="150" />
      </FormField>

      <FormField
        label="Username"
        :error="usernameError"
        help="Optional. An alternative to the email at sign-in."
      >
        <input v-model="form.username" class="form-field__control" autocomplete="off" />
      </FormField>

      <template v-if="isCreate">
        <FormField label="Initial password" :error="passwordError">
          <input
            v-model="form.password"
            type="password"
            class="form-field__control"
            autocomplete="new-password"
            :placeholder="`At least ${minPasswordLength} characters`"
          />
          <template #help>
            <span v-if="!passwordError" class="form-field__help">
              Set one and the account is created <strong>active</strong>. Leave it blank and the account is created
              <strong>pending</strong> with no password — give it one later with Reset password on the user's page.
            </span>
          </template>
        </FormField>

        <FormField
          inline
          label="Require a password change at first sign-in"
          :help="
            form.password
              ? 'Leave this on for any password an administrator has seen.'
              : 'Only applies when an initial password is set.'
          "
        >
          <input v-model="form.mustChangePassword" type="checkbox" :disabled="!form.password" />
        </FormField>

        <div class="form-field">
          <span class="form-field__label">Initial roles</span>
          <div class="form-field__checks">
            <label v-for="role in props.roles" :key="role.id" class="form-field__check">
              <input type="checkbox" :checked="form.roleIds.includes(role.id)" @change="toggleRole(role.id)" />
              {{ role.name }}
            </label>
          </div>
          <span class="form-field__help">
            Roles can be changed later from the user's page. Without one the account can sign in but see nothing.
          </span>
        </div>
      </template>

      <fieldset class="profile">
        <legend class="profile__legend">Profile</legend>
        <div class="form-row">
          <FormField label="Department">
            <input v-model="form.profile.department" class="form-field__control" maxlength="120" />
          </FormField>
          <FormField label="Position">
            <input v-model="form.profile.position" class="form-field__control" maxlength="120" />
          </FormField>
        </div>
        <FormField label="Phone">
          <input v-model="form.profile.phone" class="form-field__control" maxlength="30" />
        </FormField>
      </fieldset>
    </form>

    <template #footer>
      <button type="button" class="btn btn--ghost" @click="emit('close')">Cancel</button>
      <button type="submit" form="user-form" class="btn btn--primary" :disabled="!canSave || saving">
        {{ saving ? 'Saving…' : isCreate ? 'Create user' : 'Save changes' }}
      </button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.profile {
  margin-top: 0.5rem;
  padding: 0 0 0.25rem;
  border: 0;
  border-top: 1px solid var(--color-border);
}

.profile__legend {
  padding-right: 0.5rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
</style>
