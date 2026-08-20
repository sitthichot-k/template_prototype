<script setup>
/**
 * Renders one setting from its descriptor.
 *
 * This component is the frontend half of the dynamic settings engine: the
 * backend declares `type`, `label`, constraints and `options`, and the right
 * control appears here. Adding a setting on the server therefore adds a
 * working, validated form control with no frontend change at all - which is
 * the property that keeps the Vue and React shells interchangeable.
 *
 * Adding a *new setting type* is the one case that needs a change here, and
 * it is a single branch below plus the same in the React equivalent.
 */

import { computed } from 'vue';

const props = defineProps({
  descriptor: { type: Object, required: true },
  modelValue: { type: [String, Number, Boolean, Array, Object], default: null },
  error: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
});

const emit = defineEmits(['update:modelValue']);

const value = computed({
  get: () => props.modelValue,
  set: (next) => emit('update:modelValue', next)
});

const isDisabled = computed(() => props.disabled || props.descriptor.readOnly || !props.descriptor.editable);

const inputId = computed(() => `setting-${props.descriptor.key.replace(/\./g, '-')}`);

/** `password` and other secret fields never receive a value from the server. */
const secretPlaceholder = computed(() =>
  props.descriptor.secret ? (props.descriptor.isSet ? '••••••••  (leave blank to keep)' : 'Not set') : ''
);

function onNumber(event) {
  const raw = event.target.value;
  value.value = raw === '' ? null : Number(raw);
}
</script>

<template>
  <div class="schema-field" :class="{ 'schema-field--disabled': isDisabled }">
    <label class="schema-field__label" :for="inputId">
      {{ descriptor.label }}
      <span v-if="descriptor.required" class="schema-field__required" aria-hidden="true">*</span>
    </label>

    <p v-if="descriptor.description" class="schema-field__description">
      {{ descriptor.description }}
    </p>

    <!-- Boolean -->
    <label v-if="descriptor.type === 'boolean'" class="schema-field__switch">
      <input :id="inputId" v-model="value" type="checkbox" :disabled="isDisabled" />
      <span class="schema-field__switch-track" />
    </label>

    <!-- Long text -->
    <textarea
      v-else-if="descriptor.type === 'text'"
      :id="inputId"
      v-model="value"
      class="schema-field__control"
      rows="4"
      :maxlength="descriptor.maxLength"
      :disabled="isDisabled"
    />

    <!-- Single choice -->
    <select
      v-else-if="descriptor.type === 'select'"
      :id="inputId"
      v-model="value"
      class="schema-field__control"
      :disabled="isDisabled"
    >
      <option v-for="option in descriptor.options" :key="String(option.value)" :value="option.value">
        {{ option.label }}
      </option>
    </select>

    <!-- Multiple choice -->
    <div v-else-if="descriptor.type === 'multiselect'" class="schema-field__checklist">
      <label v-for="option in descriptor.options" :key="String(option.value)" class="schema-field__check">
        <input v-model="value" type="checkbox" :value="option.value" :disabled="isDisabled" />
        {{ option.label }}
      </label>
      <p v-if="!descriptor.options?.length" class="schema-field__empty">No options are available.</p>
    </div>

    <!-- Numeric -->
    <input
      v-else-if="descriptor.type === 'number' || descriptor.type === 'duration'"
      :id="inputId"
      type="number"
      class="schema-field__control"
      :value="value"
      :min="descriptor.min"
      :max="descriptor.max"
      :disabled="isDisabled"
      @input="onNumber"
    />

    <!-- Colour: paired swatch and hex input so either can drive the value -->
    <div v-else-if="descriptor.type === 'color'" class="schema-field__color">
      <input :id="inputId" v-model="value" type="color" :disabled="isDisabled" />
      <input v-model="value" type="text" class="schema-field__control" maxlength="7" :disabled="isDisabled" />
    </div>

    <!-- Secret -->
    <input
      v-else-if="descriptor.type === 'password'"
      :id="inputId"
      v-model="value"
      type="password"
      class="schema-field__control"
      autocomplete="new-password"
      :placeholder="secretPlaceholder"
      :disabled="isDisabled"
    />

    <!-- Structured value -->
    <textarea
      v-else-if="descriptor.type === 'json'"
      :id="inputId"
      class="schema-field__control schema-field__control--mono"
      rows="6"
      :value="JSON.stringify(value, null, 2)"
      :disabled="isDisabled"
      @change="value = JSON.parse($event.target.value)"
    />

    <!-- string, email, url, date, file -->
    <input
      v-else
      :id="inputId"
      v-model="value"
      :type="descriptor.type === 'date' ? 'date' : descriptor.type === 'email' ? 'email' : 'text'"
      class="schema-field__control"
      :maxlength="descriptor.maxLength"
      :disabled="isDisabled"
    />

    <p v-if="error" class="schema-field__error">{{ error }}</p>
    <p v-else-if="descriptor.helpText" class="schema-field__help">{{ descriptor.helpText }}</p>

    <p v-if="descriptor.restartRequired" class="schema-field__notice">
      Changing this takes effect after the service restarts.
    </p>
  </div>
</template>

<style scoped>
.schema-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 1rem 0;
  border-bottom: 1px solid var(--color-border);
}

.schema-field--disabled {
  opacity: 0.6;
}

.schema-field__label {
  font-weight: 600;
  font-size: 0.9375rem;
}

.schema-field__required {
  color: var(--color-danger);
  margin-left: 0.125rem;
}

.schema-field__description,
.schema-field__help {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  margin: 0;
}

.schema-field__control {
  width: 100%;
  max-width: 32rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}

.schema-field__control:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.schema-field__control--mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
}

/* The boolean control. The checkbox stays in the DOM - it carries the focus
   ring, the keyboard behaviour and the screen-reader semantics - and the track
   beside it is what is actually drawn. */
.schema-field__switch {
  position: relative;
  display: inline-flex;
  width: 2.5rem;
  height: 1.375rem;
}

.schema-field__switch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.schema-field__switch input:disabled {
  cursor: not-allowed;
}

.schema-field__switch-track {
  display: block;
  position: relative;
  width: 100%;
  height: 100%;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  background: var(--color-surface-hover);
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.schema-field__switch-track::after {
  content: '';
  position: absolute;
  top: 0.1875rem;
  left: 0.1875rem;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: var(--radius-full);
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
  transition: transform 0.15s ease;
}

.schema-field__switch input:checked + .schema-field__switch-track {
  border-color: transparent;
  background: var(--color-primary);
}

.schema-field__switch input:checked + .schema-field__switch-track::after {
  transform: translateX(1.0625rem);
}

.schema-field__switch input:focus-visible + .schema-field__switch-track {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.schema-field__checklist {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.schema-field__check {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.875rem;
}

.schema-field__color {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.schema-field__color input[type='color'] {
  width: 2.5rem;
  height: 2.25rem;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  background: none;
}

.schema-field__error {
  font-size: 0.8125rem;
  color: var(--color-danger);
  margin: 0;
}

.schema-field__notice {
  font-size: 0.75rem;
  color: var(--color-warning);
  margin: 0;
}

.schema-field__empty {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
</style>
