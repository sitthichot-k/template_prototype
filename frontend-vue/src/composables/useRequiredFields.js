/**
 * Required-field marking and validation.
 *
 * Ported from the `requiredValidation` mixin used in the canteen project. The
 * contract is deliberately the same, because it is a good one:
 *
 *   1. a field is marked required in one place, and the red asterisk is drawn
 *      from that mark rather than typed into each form;
 *   2. `validate()` at the top of a submit handler returns false when any
 *      required field is blank;
 *   3. the offending fields are highlighted and the first is scrolled to and
 *      focused, so a long form does not just refuse silently;
 *   4. the highlight clears as soon as the value is supplied.
 *
 * The implementation is not a copy. That mixin is Vue 2 Options API and finds
 * fields with `document`-wide `querySelectorAll('label.required')`, which in
 * this codebase would reach into any other form mounted at the same time - and
 * two dialogs plus a page form is the normal case here. This version is a
 * composable, and each `FormField` registers itself with the form that
 * provides the context, so a form can only ever validate its own fields.
 *
 * Usage - the form owner:
 *
 *   const { validate } = provideRequiredFields();
 *
 *   async function save() {
 *     if (!validate()) return;
 *     …
 *   }
 *
 * Usage - the fields: `<FormField label="Name" required>` and nothing else.
 * See `components/common/FormField.vue`.
 */

import { inject, provide } from 'vue';

const REQUIRED_FIELDS = Symbol('required-fields');

/**
 * Installs a validation context for everything rendered beneath it.
 *
 * @returns {{ validate: () => boolean, clear: () => void, size: () => number }}
 */
export function provideRequiredFields() {
  /** @type {Set<{ isEmpty: () => boolean, setInvalid: (v: boolean) => void, focus: () => void }>} */
  const fields = new Set();

  provide(REQUIRED_FIELDS, {
    register(field) {
      fields.add(field);
      // Returned so the field can unregister on unmount. A `v-if` field that
      // stayed registered would block submission from behind a hidden branch -
      // the failure that is hardest to diagnose, because nothing is on screen.
      return () => fields.delete(field);
    }
  });

  /**
   * Checks every registered field.
   *
   * Every field is evaluated, not just up to the first failure, so the form
   * marks all of its gaps at once rather than revealing them one submit at a
   * time.
   */
  function validate() {
    let firstInvalid = null;

    for (const field of fields) {
      const empty = field.isEmpty();
      field.setInvalid(empty);
      if (empty && !firstInvalid) firstInvalid = field;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }
    return true;
  }

  /** Drops every highlight, for reopening a dialog on a fresh record. */
  function clear() {
    for (const field of fields) field.setInvalid(false);
  }

  return { validate, clear, size: () => fields.size };
}

/**
 * Field side. Returns `null` outside a provider, which is what lets a
 * `FormField` be used on a page that does not validate.
 */
export function useRequiredFields() {
  return inject(REQUIRED_FIELDS, null);
}
