<script setup>
/**
 * One form field: label, required marker, control, help and error.
 *
 * This is where the red asterisk is decided. Before it existed, every editor
 * dialog wrote `<span class="form-field__required">*</span>` by hand, which
 * means the day the marker changes - a tooltip, an "(optional)" suffix instead,
 * a different colour - is the day someone has to find all of them.
 *
 * The control is a slot rather than a prop-driven input, because the set of
 * controls is open: text, select, textarea, a checkbox row, a JSON editor. The
 * field cares only whether the control it wraps has a value.
 *
 *   <FormField label="Name" required>
 *     <input v-model="form.name" class="form-field__control" />
 *   </FormField>
 *
 * When `required` and inside a `provideRequiredFields()` form, the field
 * registers itself and takes part in `validate()`. Outside one it still draws
 * the asterisk - marking and validating are separate concerns, and a page that
 * validates some other way should not lose the marker.
 */

import { computed, onBeforeUnmount, ref, useId } from 'vue';
import { useRequiredFields } from '@/composables/useRequiredFields';

const props = defineProps({
  label: { type: String, default: '' },
  required: { type: Boolean, default: false },
  /** Guidance shown under the control; hidden while an error is displayed. */
  help: { type: String, default: '' },
  /** A message the parent computed. Takes precedence over `help`. */
  error: { type: String, default: '' },
  /** Lays the control out beside the label, for a single checkbox. */
  inline: { type: Boolean, default: false }
});

const root = ref(null);
const fieldId = useId();

/** Set by `validate()`, cleared as soon as the control has a value. */
const missing = ref(false);

const message = computed(() => props.error || (missing.value ? `${props.label || 'This field'} is required.` : ''));

/**
 * The control this field wraps.
 *
 * Scoped to this component's own element, so a field can never inspect a
 * sibling's input - the flaw in doing this with a document-wide selector.
 */
function control() {
  return root.value?.querySelector('input, select, textarea') || null;
}

function isEmpty() {
  const element = control();
  if (!element) return false;

  // A required checkbox means "must be ticked", not "must have a value".
  if (element.type === 'checkbox') return !element.checked;

  return String(element.value ?? '').trim() === '';
}

const form = useRequiredFields();

if (props.required && form) {
  const unregister = form.register({
    isEmpty,
    setInvalid(value) {
      missing.value = value;
    },
    focus() {
      const element = control();
      if (!element) return;

      element.focus({ preventScroll: true });

      // Guarded because a throw here would abort `validate()` and leave the
      // form unable to submit at all - trading a missing scroll for a dead
      // button. Absent in jsdom, and in a few embedded browsers.
      if (typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });

  onBeforeUnmount(unregister);
}

/** Typing into a field the form just flagged clears the flag immediately. */
function onInput() {
  if (missing.value && !isEmpty()) missing.value = false;
}
</script>

<template>
  <label
    ref="root"
    class="form-field"
    :class="{ 'form-field--inline': inline, 'form-field--invalid': missing }"
    :for="fieldId"
    @input="onInput"
    @change="onInput"
  >
    <span v-if="label && !inline" class="form-field__label">
      {{ label }}<span v-if="required" class="form-field__required" aria-hidden="true">*</span>
    </span>

    <slot :id="fieldId" :invalid="missing" />

    <template v-if="inline">
      <span>
        <span v-if="label" class="form-field__label">
          {{ label }}<span v-if="required" class="form-field__required" aria-hidden="true">*</span>
        </span>
        <span v-if="message" class="form-field__error">{{ message }}</span>
        <span v-else-if="help" class="form-field__help">{{ help }}</span>
        <slot name="help" />
      </span>
    </template>

    <template v-else>
      <span v-if="message" class="form-field__error" role="alert">{{ message }}</span>
      <span v-else-if="help" class="form-field__help">{{ help }}</span>
      <slot name="help" />
    </template>
  </label>
</template>
