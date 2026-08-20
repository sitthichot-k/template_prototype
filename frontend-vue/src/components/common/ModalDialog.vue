<script setup>
/**
 * Modal dialog.
 *
 * Wraps the native `<dialog>` element rather than reimplementing one. The
 * browser then supplies focus trapping, restoring focus to whatever opened it,
 * Esc to dismiss, inertness of the page behind, and the top-layer stacking that
 * makes `z-index` arguments unnecessary. A hand-rolled overlay gets each of
 * those wrong at least once.
 *
 * `open` is a prop rather than internal state so the dialog cannot drift out of
 * step with the parent's idea of what is being edited - closing is always the
 * parent's decision, which is what lets it clear the record at the same time.
 */

import { onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  /** Widen for dense forms; the default suits a single column of fields. */
  size: { type: String, default: 'md', validator: (value) => ['sm', 'md', 'lg'].includes(value) }
});

const emit = defineEmits(['close']);

const dialog = ref(null);

watch(
  () => props.open,
  (open) => {
    const element = dialog.value;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  },
  { flush: 'post' }
);

// A dialog left open in the top layer survives its own component being torn
// down - on a route change, for instance - and blocks the page underneath.
onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="modal"
    :class="`modal--${size}`"
    @close="emit('close')"
    @cancel.prevent="emit('close')"
  >
    <div class="modal__frame">
      <header class="modal__header">
        <h2 class="modal__title">{{ title }}</h2>
        <button type="button" class="modal__close" aria-label="Close" @click="emit('close')">×</button>
      </header>

      <div class="modal__body">
        <slot />
      </div>

      <footer v-if="$slots.footer" class="modal__footer">
        <slot name="footer" />
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.modal {
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text);
}

.modal--sm {
  width: min(28rem, 92vw);
}
.modal--md {
  width: min(38rem, 92vw);
}
.modal--lg {
  width: min(52rem, 94vw);
}

.modal::backdrop {
  background: rgb(0 0 0 / 55%);
}

.modal__frame {
  display: flex;
  flex-direction: column;
  max-height: 85vh;
}

.modal__header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}

.modal__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
}

.modal__close {
  margin-left: auto;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.modal__close:hover {
  color: var(--color-text);
}

.modal__body {
  overflow-y: auto;
  padding: 0.25rem 1.25rem 1rem;
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--color-border);
}
</style>
