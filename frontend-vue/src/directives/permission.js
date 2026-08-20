/**
 * `v-can` - removes an element the user has no permission to use.
 *
 *   <button v-can="'/security/users:create'">New user</button>
 *   <button v-can="['/security/users', 'delete']">Delete</button>
 *   <div v-can.any="[['/a','view'], ['/b','view']]">…</div>
 *
 * The element is removed from the DOM rather than disabled: a disabled
 * control still advertises that the capability exists, which is information
 * a user without the permission does not need.
 *
 * This is presentation only. The API enforces the same check on every
 * request, and that is the boundary that actually protects anything.
 */

import { usePlatformStore } from '@/stores/platform.store';

function parseBinding(value) {
  if (Array.isArray(value)) {
    return { resource: value[0], action: value[1] || 'view' };
  }
  const [resource, action] = String(value).split(':');
  return { resource, action: action || 'view' };
}

function evaluate(binding) {
  const platform = usePlatformStore();

  if (binding.modifiers.any) {
    const pairs = (binding.value || []).map((entry) => {
      const parsed = parseBinding(entry);
      return [parsed.resource, parsed.action];
    });
    return platform.canAny(pairs);
  }

  const { resource, action } = parseBinding(binding.value);
  return platform.can(resource, action);
}

function apply(el, binding) {
  const allowed = evaluate(binding);

  if (allowed) {
    // Restore an element a previous evaluation removed.
    if (el.__permissionPlaceholder) {
      el.__permissionPlaceholder.replaceWith(el);
      el.__permissionPlaceholder = null;
    }
    return;
  }

  if (!el.__permissionPlaceholder && el.parentNode) {
    // A comment node marks the position so the element can come back if the
    // permission set changes without a page reload.
    const placeholder = document.createComment('v-can');
    el.__permissionPlaceholder = placeholder;
    el.replaceWith(placeholder);
  }
}

export const permissionDirective = {
  mounted: apply,
  updated: apply
};

export default {
  install(app) {
    app.directive('can', permissionDirective);
  }
};
