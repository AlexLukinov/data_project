// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import NumberInput from '../src/components/NumberInput.vue';
import { cleanDecimal, formatDecimal, parseDecimal, sameDecimal } from '../src/number';

describe('parseDecimal', () => {
  it('refuses anything that is not one plain number', () => {
    for (const text of ['', '   ', '-', ',', '.', '2..5', '2,,5', '2.5.1', '1,000.5', '1.000,5', '1e3', '5%', 'abc', '2 5', '0x10', 'Infinity']) {
      expect(parseDecimal(text), text).toBeNull();
    }
  });

  it('reads a dot and a comma as the same decimal separator', () => {
    expect(parseDecimal('2.5')).toBe(2.5);
    expect(parseDecimal('2,5')).toBe(2.5);
    expect(parseDecimal(' -0,75 ')).toBe(-0.75);
    expect(parseDecimal('+3')).toBe(3);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(parseDecimal(',5')).toBe(0.5);
    expect(parseDecimal('5.')).toBe(5);
    expect(parseDecimal('5,')).toBe(5);
  });

  it('never treats a comma as a thousands separator', () => {
    expect(parseDecimal('1,000')).toBe(1);
  });
});

describe('formatDecimal', () => {
  it('writes a dot with no float noise and no grouping', () => {
    expect(formatDecimal(2.5)).toBe('2.5');
    expect(formatDecimal(0.07 * 100)).toBe('7');
    expect(formatDecimal(0.285 * 100)).toBe('28.5');
    expect(formatDecimal(12345.5)).toBe('12345.5');
    expect(cleanDecimal(0.6 + 0.05)).toBe(0.65);
    expect(sameDecimal(28, 0.28 * 100)).toBe(true);
    expect(sameDecimal(28, 28.5)).toBe(false);
  });
});

function box(props: Record<string, unknown> = {}) {
  return mount(NumberInput, { props: { modelValue: 1, ...props } });
}

describe('NumberInput', () => {
  it('emits nothing for text it cannot read, marks it invalid, and restores the value on leaving', async () => {
    const wrapper = box({ modelValue: 1.5 });
    const input = wrapper.find('input');
    await input.setValue('2..5');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('title')).toContain('2.5 and 2,5 both work');
    await input.trigger('blur');
    expect(input.element.value).toBe('1.5');
    expect(input.attributes('aria-invalid')).toBeUndefined();
  });

  it('refuses a number outside min and max as unreadable, and says the range', async () => {
    const wrapper = box({ modelValue: 50, min: 0, max: 100 });
    const input = wrapper.find('input');
    await input.setValue('150');
    await input.setValue('-1');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(input.attributes('title')).toBe('A number from 0 to 100 — 2.5 and 2,5 both work.');
  });

  it('emits clear, not a number, when the box is emptied — and only once', async () => {
    const wrapper = box({ modelValue: 3 });
    const input = wrapper.find('input');
    await input.setValue('');
    expect(wrapper.emitted('clear')).toHaveLength(1);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(input.attributes('aria-invalid')).toBeUndefined();
    await wrapper.setProps({ modelValue: null });
    await input.setValue('  ');
    expect(wrapper.emitted('clear')).toHaveLength(1);
  });

  it('reads 2,5 and 2.5 as the same number and writes it back with a dot', async () => {
    const wrapper = box({ modelValue: null, 'onUpdate:modelValue': (v: number) => wrapper.setProps({ modelValue: v }) });
    const input = wrapper.find('input');
    await input.setValue('2,5');
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([2.5]);
    await input.trigger('blur');
    expect(input.element.value).toBe('2.5');
    await input.setValue('2.5');
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  });

  it('leaves half-typed text alone when the value it says comes back from the parent', async () => {
    // A parent that stores a fraction and shows a percent hands back 28.000000000000004 for 28.
    const wrapper = box({ modelValue: null, 'onUpdate:modelValue': (v: number) => wrapper.setProps({ modelValue: (v / 100) * 100 }) });
    const input = wrapper.find('input');
    await input.setValue('28,');
    await flushPromises();
    expect(wrapper.props('modelValue')).not.toBe(28);
    expect(input.element.value).toBe('28,');
    await input.trigger('blur');
    expect(input.element.value).toBe('28');
  });

  it('fills an emptied box when a value arrives from outside', async () => {
    const wrapper = box({ modelValue: 1 });
    const input = wrapper.find('input');
    await input.setValue('');
    await wrapper.setProps({ modelValue: 3 });
    expect(input.element.value).toBe('3');
  });

  it('replaces the text when the value changes from outside', async () => {
    const wrapper = box({ modelValue: 100 });
    await wrapper.setProps({ modelValue: 66.5 });
    expect(wrapper.find('input').element.value).toBe('66.5');
    await wrapper.setProps({ modelValue: null });
    expect(wrapper.find('input').element.value).toBe('');
  });

  it('emits only on change when lazy, while still marking bad text as it is typed', async () => {
    const wrapper = box({ modelValue: 40, lazy: true });
    const input = wrapper.find('input');
    (input.element as HTMLInputElement).value = 'x';
    await input.trigger('input');
    expect(input.attributes('aria-invalid')).toBe('true');
    (input.element as HTMLInputElement).value = '87,5';
    await input.trigger('input');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await input.trigger('change');
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([87.5]);
  });

  it('steps with the arrow keys inside min and max, without float noise', async () => {
    const wrapper = box({ modelValue: 0.95, min: 0, max: 1, step: 0.05, 'onUpdate:modelValue': (v: number) => wrapper.setProps({ modelValue: v }) });
    const input = wrapper.find('input');
    await input.trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([1]);
    await flushPromises();
    await input.trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
    await wrapper.setProps({ modelValue: 0.6 });
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.emitted('update:modelValue')![1]).toEqual([0.55]);
    expect(input.element.value).toBe('0.55');
  });

  it('is a text box in decimal mode, and passes its attributes through', () => {
    const wrapper = mount(NumberInput, { props: { modelValue: 2.5 }, attrs: { 'aria-label': 'pot', placeholder: 'bb', class: 'w-16' } });
    const input = wrapper.find('input');
    expect(input.attributes()).toMatchObject({ type: 'text', inputmode: 'decimal', 'aria-label': 'pot', placeholder: 'bb' });
    expect(input.classes()).toContain('w-16');
    expect(input.element.value).toBe('2.5');
  });
});
