// @vitest-environment happy-dom
/**
 * RangeMatrix's strokes and keyboard click (audit §2.7, §2.8): one drag is one `update:range`, so
 * an undo takes back the stroke rather than the last cell it crossed; and Enter/Space on a focused
 * cell is the keyboard's click, so a page that selects on `cellClick` works without a mouse.
 */
import type { WeightedRange } from '@poker/core';
import { HAND_CLASS_COMBOS, handClassOfName, parseRange } from '@poker/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import RangeMatrix from '../src/components/RangeMatrix.vue';

const range = parseRange('AA,AKs:0.5').range;
const cell = (wrapper: ReturnType<typeof mount>, name: string) => wrapper.find(`[data-cls="${handClassOfName(name)}"]`);
const weightsOf = (r: WeightedRange, name: string) => HAND_CLASS_COMBOS[handClassOfName(name)]!.map((combo) => r.weights[combo]);

/** The pointer lifting anywhere on the page, where the stroke's end is listened for. */
async function lift(type: 'pointerup' | 'pointercancel' = 'pointerup'): Promise<void> {
  window.dispatchEvent(new Event(type));
  await nextTick();
}

describe('RangeMatrix — a stroke', () => {
  it('emits nothing for a stroke that changed no weight', async () => {
    const wrapper = mount(RangeMatrix, { props: { range, brush: 1 } });
    await cell(wrapper, 'AA').trigger('pointerdown');
    await lift();
    expect(wrapper.emitted('update:range')).toBeUndefined();
    expect(wrapper.emitted('cellClick')).toEqual([[handClassOfName('AA')]]);
  });

  it('drops a stroke whose matrix is unmounted before the pointer lifts', async () => {
    const wrapper = mount(RangeMatrix, { props: { range } });
    await cell(wrapper, 'KK').trigger('pointerdown');
    wrapper.unmount();
    await lift();
    expect(wrapper.emitted('update:range')).toBeUndefined();
  });

  it('paints nothing in view mode, but still reports the click', async () => {
    const wrapper = mount(RangeMatrix, { props: { range, mode: 'view' } });
    await cell(wrapper, 'KK').trigger('pointerdown');
    await cell(wrapper, 'QQ').trigger('pointerenter');
    await lift();
    expect(wrapper.emitted('update:range')).toBeUndefined();
    expect(wrapper.emitted('cellClick')).toEqual([[handClassOfName('KK')]]);
  });

  it('shows the stroke while it is painted and emits it once, whole, when the pointer lifts', async () => {
    const wrapper = mount(RangeMatrix, { props: { range, brush: 0.75 } });
    await cell(wrapper, 'KK').trigger('pointerdown');
    expect(wrapper.emitted('cellClick')).toEqual([[handClassOfName('KK')]]); // at once, not on lift
    await cell(wrapper, 'QQ').trigger('pointerenter');
    await cell(wrapper, 'JJ').trigger('pointerenter');

    expect(wrapper.emitted('update:range')).toBeUndefined();
    expect(cell(wrapper, 'JJ').find('.pk-fill').attributes('style')).toContain('height: 75%');
    expect(cell(wrapper, 'QQ').attributes('aria-label')).toContain('weight 75%');

    await lift();
    const strokes = wrapper.emitted('update:range')!;
    expect(strokes).toHaveLength(1);
    const stroke = strokes[0]![0] as WeightedRange;
    for (const name of ['KK', 'QQ', 'JJ']) expect(weightsOf(stroke, name)).toEqual([0.75, 0.75, 0.75, 0.75, 0.75, 0.75]);
    expect(weightsOf(stroke, 'AA')).toEqual([1, 1, 1, 1, 1, 1]); // untouched
    expect(cell(wrapper, 'JJ').find('.pk-fill').attributes('style')).toContain('height: 0%'); // back to the prop until the parent applies it
  });

  it('erases a shift-drag as one edit, ended by a pointercancel as well as a pointerup', async () => {
    const wrapper = mount(RangeMatrix, { props: { range } });
    await cell(wrapper, 'AA').trigger('pointerdown', { shiftKey: true });
    await cell(wrapper, 'AKs').trigger('pointerenter');
    await lift('pointercancel');
    const strokes = wrapper.emitted('update:range')!;
    expect(strokes).toHaveLength(1);
    expect(weightsOf(strokes[0]![0] as WeightedRange, 'AA').every((w) => w === 0)).toBe(true);
    expect(weightsOf(strokes[0]![0] as WeightedRange, 'AKs').every((w) => w === 0)).toBe(true);

    await cell(wrapper, 'QQ').trigger('pointerenter'); // the stroke is over: hovering paints nothing
    await lift();
    expect(wrapper.emitted('update:range')).toHaveLength(1);
  });
});

describe('RangeMatrix — Enter and Space', () => {
  it('select the focused cell in view mode and change nothing', async () => {
    const wrapper = mount(RangeMatrix, { props: { range, mode: 'view' } });
    const grid = wrapper.find('[role="grid"]');
    await grid.trigger('keydown', { key: 'ArrowRight' }); // AA → AKs
    await grid.trigger('keydown', { key: 'Enter' });
    await grid.trigger('keydown', { key: ' ' });
    expect(wrapper.emitted('cellClick')).toEqual([[handClassOfName('AKs')], [handClassOfName('AKs')]]);
    expect(wrapper.emitted('update:range')).toBeUndefined();
  });

  it('select the focused cell and toggle it at once in edit mode — a key press is not a stroke', async () => {
    const wrapper = mount(RangeMatrix, { props: { range } });
    const grid = wrapper.find('[role="grid"]');
    await grid.trigger('keydown', { key: 'ArrowDown' }); // AA → AKo
    await grid.trigger('keydown', { key: ' ' });
    expect(wrapper.emitted('cellClick')).toEqual([[handClassOfName('AKo')]]);
    const toggled = wrapper.emitted('update:range')![0]![0] as WeightedRange;
    expect(weightsOf(toggled, 'AKo').every((w) => w === 1)).toBe(true);
  });
});
