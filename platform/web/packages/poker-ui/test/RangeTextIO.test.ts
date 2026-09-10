// @vitest-environment happy-dom
import type { WeightedRange } from '@poker/core';
import { parseRange, totalCombos } from '@poker/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import RangeTextIO from '../src/components/RangeTextIO.vue';

describe('RangeTextIO', () => {
  it('shows the range in class notation and re-parses on Apply', async () => {
    const wrapper = mount(RangeTextIO, { props: { range: parseRange('QQ+,AKs').range } });
    const textarea = wrapper.find('textarea');
    expect((textarea.element as HTMLTextAreaElement).value).toBe('QQ+,AKs');
    await textarea.setValue('KK, AhKh: 0.5'.replace('KK, AhKh: 0.5', 'KK'));
    await wrapper.find('button.pk-primary').trigger('click');
    const next = wrapper.emitted('update:range')![0]![0] as WeightedRange;
    expect(totalCombos(next)).toBe(6);
  });

  it('explains a parse error and keeps the range', async () => {
    const wrapper = mount(RangeTextIO, { props: { range: parseRange('AA').range } });
    await wrapper.find('textarea').setValue('AA, AKx');
    await wrapper.find('button.pk-primary').trigger('click');
    expect(wrapper.find('[role="alert"]').text()).toContain('entry 2: `AKx` isn\'t valid notation. Did you mean `AKs` or `AKo`?');
    expect(wrapper.emitted('update:range')).toBeUndefined();
  });

  it('switches to combo notation and reports it', async () => {
    const wrapper = mount(RangeTextIO, { props: { range: parseRange('AKs:0.5').range } });
    await wrapper.find('input[value="combo"]').trigger('change');
    expect(wrapper.emitted('formatChange')![0]).toEqual(['combo']);
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('AcKc: 0.5,AdKd: 0.5,AhKh: 0.5,AsKs: 0.5');
  });

  it('says when class notation would lose weights', () => {
    const range = parseRange('AcKc: 1,AdKd: 0.5').range;
    const wrapper = mount(RangeTextIO, { props: { range } });
    expect(wrapper.text()).toContain('cannot keep every weight');
  });
});
