// @vitest-environment happy-dom
import type { WeightedRange } from '@poker/core';
import { HAND_CLASS_COMBOS, handClassOfName, parseCards, parseCombo, parseRange } from '@poker/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import RangeMatrix from '../src/components/RangeMatrix.vue';

const range = parseRange('AA,AKs:0.5').range;
const cell = (wrapper: ReturnType<typeof mount>, name: string) => wrapper.find(`[data-cls="${handClassOfName(name)}"]`);

describe('RangeMatrix', () => {
  it('renders 169 cells with partial fills from the weights', () => {
    const wrapper = mount(RangeMatrix, { props: { range } });
    expect(wrapper.findAll('[role="gridcell"]')).toHaveLength(169);
    expect(cell(wrapper, 'AA').find('.pk-fill').attributes('style')).toContain('height: 100%');
    expect(cell(wrapper, 'AKs').find('.pk-fill').attributes('style')).toContain('height: 50%');
    expect(cell(wrapper, 'AKo').find('.pk-fill').attributes('style')).toContain('height: 0%');
    expect(cell(wrapper, 'AKs').attributes('title')).toContain('4 of 4 combos');
  });

  // A stroke is one edit and it lands when the pointer lifts, so undo walks back whole strokes
  // rather than single cells; the cell itself is painted under the pointer as it goes.
  it('paints a cell with the brush, erases with shift, one edit per stroke', async () => {
    const wrapper = mount(RangeMatrix, { props: { range, brush: 0.75 } });
    await cell(wrapper, 'KK').trigger('pointerdown');
    expect(wrapper.emitted('cellClick')![0]).toEqual([handClassOfName('KK')]);
    window.dispatchEvent(new Event('pointerup'));
    const painted = wrapper.emitted('update:range')![0]![0] as WeightedRange;
    for (const combo of HAND_CLASS_COMBOS[handClassOfName('KK')]!) expect(painted.weights[combo]).toBe(0.75);
    expect(painted.weights[parseCombo('AsAh')]).toBe(1); // untouched
    await cell(wrapper, 'AA').trigger('pointerdown', { shiftKey: true });
    window.dispatchEvent(new Event('pointerup'));
    const erased = wrapper.emitted('update:range')![1]![0] as WeightedRange;
    expect(erased.weights[parseCombo('AsAh')]).toBe(0);
  });

  it('does not paint in view mode', async () => {
    const wrapper = mount(RangeMatrix, { props: { range, mode: 'view' } });
    await cell(wrapper, 'KK').trigger('pointerdown');
    expect(wrapper.emitted('update:range')).toBeUndefined();
    expect(wrapper.emitted('cellClick')).toHaveLength(1);
  });

  it('is keyboard operable: arrows move, Enter toggles', async () => {
    const wrapper = mount(RangeMatrix, { props: { range } });
    const grid = wrapper.find('[role="grid"]');
    await grid.trigger('keydown', { key: 'ArrowRight' }); // AA → AKs
    await grid.trigger('keydown', { key: 'Enter' }); // AKs has weight → cleared
    const cleared = wrapper.emitted('update:range')![0]![0] as WeightedRange;
    expect(cleared.weights[parseCombo('AsKs')]).toBe(0);
    await grid.trigger('keydown', { key: 'ArrowDown' }); // → KKo row? no: row 1, column 1 = KK
    await grid.trigger('keydown', { key: ' ' });
    const painted = wrapper.emitted('update:range')![1]![0] as WeightedRange;
    expect(painted.weights[parseCombo('KsKh')]).toBe(1);
  });

  it('shades blocked combos and rings highlighted ones', () => {
    const wrapper = mount(RangeMatrix, { props: { range, blockedCards: parseCards('As'), highlightCombos: [parseCombo('AdKd')] } });
    expect(cell(wrapper, 'AA').find('.pk-blocked').attributes('style')).toContain('width: 50%'); // 3 of 6 combos hold the As
    expect(cell(wrapper, 'AKs').find('.pk-highlight').exists()).toBe(true);
    expect(cell(wrapper, 'KK').find('.pk-highlight').exists()).toBe(false);
  });

  it('overlays a heatmap averaged over the combos in range', () => {
    const heat = new Float32Array(1326).fill(Number.NaN);
    for (const combo of HAND_CLASS_COMBOS[handClassOfName('AA')]!) heat[combo] = 0.8;
    const wrapper = mount(RangeMatrix, { props: { range, heatmap: heat, heatmapLabel: 'equity' } });
    expect(cell(wrapper, 'AA').find('.pk-heat').exists()).toBe(true);
    expect(cell(wrapper, 'AA').attributes('title')).toContain('equity 80.0%');
    expect(cell(wrapper, 'KK').find('.pk-heat').exists()).toBe(false);
  });
});
