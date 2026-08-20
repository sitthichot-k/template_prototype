import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import FormField from './FormField.vue';
import { provideRequiredFields } from '@/composables/useRequiredFields';

/**
 * These cover the shared form contract, which every editor dialog now depends
 * on. A regression here does not break one screen - it breaks validation
 * everywhere at once, silently, in the direction of letting bad data through.
 */

/** A host form: renders whatever fields a test needs and exposes `validate`. */
function makeForm(fields) {
  return defineComponent({
    setup(_, { expose }) {
      const { validate, clear } = provideRequiredFields();
      expose({ validate, clear });
      return () => h('form', fields());
    }
  });
}

function field(props, control) {
  return h(FormField, props, { default: () => control });
}

describe('FormField marking', () => {
  it('draws the asterisk only when required', () => {
    const wrapper = mount(FormField, {
      props: { label: 'Name', required: true },
      slots: { default: '<input />' }
    });
    expect(wrapper.find('.form-field__required').exists()).toBe(true);

    const optional = mount(FormField, {
      props: { label: 'Nickname' },
      slots: { default: '<input />' }
    });
    expect(optional.find('.form-field__required').exists()).toBe(false);
  });

  it('shows help text, and lets an error replace it', async () => {
    const wrapper = mount(FormField, {
      props: { label: 'Code', help: 'Letters only' },
      slots: { default: '<input />' }
    });
    expect(wrapper.text()).toContain('Letters only');

    await wrapper.setProps({ error: 'Not a valid code' });
    expect(wrapper.text()).toContain('Not a valid code');
    expect(wrapper.text()).not.toContain('Letters only');
  });
});

describe('required validation', () => {
  it('fails when a required field is blank and passes once filled', async () => {
    const Form = makeForm(() => [field({ label: 'Name', required: true }, h('input'))]);
    const wrapper = mount(Form, { attachTo: document.body });

    expect(wrapper.vm.validate()).toBe(false);
    await nextTick();
    expect(wrapper.find('.form-field--invalid').exists()).toBe(true);

    await wrapper.find('input').setValue('Something');
    expect(wrapper.vm.validate()).toBe(true);

    wrapper.unmount();
  });

  it('ignores fields that are not required', () => {
    const Form = makeForm(() => [field({ label: 'Nickname' }, h('input'))]);
    const wrapper = mount(Form, { attachTo: document.body });

    expect(wrapper.vm.validate()).toBe(true);
    wrapper.unmount();
  });

  it('marks every blank field, not just the first', async () => {
    const Form = makeForm(() => [
      field({ label: 'One', required: true }, h('input')),
      field({ label: 'Two', required: true }, h('input')),
      field({ label: 'Three', required: true }, h('input'))
    ]);
    const wrapper = mount(Form, { attachTo: document.body });

    expect(wrapper.vm.validate()).toBe(false);
    await nextTick();

    // Reporting one gap per submit turns a three-field form into three
    // round trips.
    expect(wrapper.findAll('.form-field--invalid')).toHaveLength(3);
    wrapper.unmount();
  });

  it('clears the mark as soon as the field is filled', async () => {
    const Form = makeForm(() => [field({ label: 'Name', required: true }, h('input'))]);
    const wrapper = mount(Form, { attachTo: document.body });

    wrapper.vm.validate();
    await nextTick();
    expect(wrapper.find('.form-field--invalid').exists()).toBe(true);

    await wrapper.find('input').setValue('typed');
    expect(wrapper.find('.form-field--invalid').exists()).toBe(false);

    wrapper.unmount();
  });

  it('treats whitespace as blank', () => {
    const Form = makeForm(() => [field({ label: 'Name', required: true }, h('input'))]);
    const wrapper = mount(Form, { attachTo: document.body });

    wrapper.find('input').element.value = '   ';
    expect(wrapper.vm.validate()).toBe(false);

    wrapper.unmount();
  });

  it('requires a required checkbox to be ticked, not merely to have a value', async () => {
    const Form = makeForm(() => [
      field({ label: 'Accept', required: true, inline: true }, h('input', { type: 'checkbox' }))
    ]);
    const wrapper = mount(Form, { attachTo: document.body });

    expect(wrapper.vm.validate()).toBe(false);

    await wrapper.find('input').setValue(true);
    expect(wrapper.vm.validate()).toBe(true);

    wrapper.unmount();
  });

  it('validates selects and textareas, not only inputs', async () => {
    const Form = makeForm(() => [
      field({ label: 'Choice', required: true }, h('select', [h('option', { value: '' }, ''), h('option', { value: 'a' }, 'A')])),
      field({ label: 'Notes', required: true }, h('textarea'))
    ]);
    const wrapper = mount(Form, { attachTo: document.body });

    expect(wrapper.vm.validate()).toBe(false);

    await wrapper.find('select').setValue('a');
    await wrapper.find('textarea').setValue('text');
    expect(wrapper.vm.validate()).toBe(true);

    wrapper.unmount();
  });

  it('forgets a field that has been unmounted', async () => {
    // A `v-if` field still registered would block submission from behind a
    // branch that is not on screen - the hardest kind of failure to diagnose.
    const Form = defineComponent({
      props: { showOptionalSection: { type: Boolean, default: true } },
      setup(props, { expose }) {
        const { validate } = provideRequiredFields();
        expose({ validate });
        return () =>
          h('form', [
            field({ label: 'Always', required: true }, h('input', { value: 'filled' })),
            props.showOptionalSection ? field({ label: 'Sometimes', required: true }, h('input')) : null
          ]);
      }
    });

    const wrapper = mount(Form, { attachTo: document.body });
    expect(wrapper.vm.validate()).toBe(false);

    await wrapper.setProps({ showOptionalSection: false });
    expect(wrapper.vm.validate()).toBe(true);

    wrapper.unmount();
  });

  it('scopes validation to its own form', () => {
    // Two dialogs open at once is normal here. A document-wide selector - the
    // approach this replaced - would let one form fail on the other's fields.
    const Other = makeForm(() => [field({ label: 'Other', required: true }, h('input'))]);
    const other = mount(Other, { attachTo: document.body });

    const Mine = makeForm(() => [field({ label: 'Mine', required: true }, h('input', { value: 'ok' }))]);
    const mine = mount(Mine, { attachTo: document.body });
    mine.find('input').element.value = 'ok';

    expect(mine.vm.validate()).toBe(true);
    expect(other.vm.validate()).toBe(false);

    mine.unmount();
    other.unmount();
  });

  it('clear() drops every mark, for reopening a dialog on a fresh record', async () => {
    const Form = makeForm(() => [field({ label: 'Name', required: true }, h('input'))]);
    const wrapper = mount(Form, { attachTo: document.body });

    wrapper.vm.validate();
    await nextTick();
    expect(wrapper.find('.form-field--invalid').exists()).toBe(true);

    wrapper.vm.clear();
    await nextTick();
    expect(wrapper.find('.form-field--invalid').exists()).toBe(false);

    wrapper.unmount();
  });
});
