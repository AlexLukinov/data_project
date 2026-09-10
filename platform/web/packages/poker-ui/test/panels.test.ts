// @vitest-environment happy-dom
import type { DistributionGroup, WeightedRange } from '@poker/core';
import { parseCard, parseCards, parseCombo, parseRange } from '@poker/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import BlockerPanel from '../src/components/BlockerPanel.vue';
import CardBlockerHeatmap from '../src/components/CardBlockerHeatmap.vue';
import ComboDistributionPanel from '../src/components/ComboDistributionPanel.vue';
import ComboDrilldown from '../src/components/ComboDrilldown.vue';

const board = parseCards('Kd 9h 4h');
const range = parseRange('AA,KK,AK,76s').range;

describe('ComboDistributionPanel', () => {
  it('renders the tree with counts and emits the clicked group', async () => {
    const wrapper = mount(ComboDistributionPanel, { props: { range, board, groupBy: ['made', 'draw'] } });
    expect(wrapper.text()).toContain('Top pair');
    expect(wrapper.text()).toContain('12 · 12 · 48.0%');
    const topPair = wrapper.findAll('button.pk-name').find((b) => b.text() === 'Top pair')!;
    await topPair.trigger('click');
    const group = wrapper.emitted('groupClick')![0]![0] as DistributionGroup;
    expect(group.key).toBe('top_pair');
    expect(group.comboList).toHaveLength(12);
  });

  it('shows the compare column with deltas', () => {
    const wrapper = mount(ComboDistributionPanel, { props: { range, compareRange: parseRange('QQ').range, board, groupBy: ['made'] } });
    expect(wrapper.text()).toContain('Underpair');
    expect(wrapper.text()).toContain('+100.0 pp');
  });

  it('emits CSV on export and toggles axes', async () => {
    const wrapper = mount(ComboDistributionPanel, { props: { range, board, groupBy: ['made'] } });
    await wrapper.findAll('button.pk-btn')[0]!.trigger('click');
    expect((wrapper.emitted('export')![0]![0] as string).split('\n')[0]).toBe('axis,level,group,combos,weighted_combos,share');
    await wrapper.find('input[type="checkbox"]:not(:checked)').trigger('change');
    expect(wrapper.emitted('update:groupBy')![0]![0]).toEqual(['made', 'draw']);
  });

  it('explains a missing input instead of failing', () => {
    const wrapper = mount(ComboDistributionPanel, { props: { range, board, groupBy: ['strategic'] } });
    expect(wrapper.find('[role="alert"]').text()).toContain('needs per-combo equities');
  });
});

describe('BlockerPanel', () => {
  const props = { heroRange: parseRange('AhKh,JhTh').range, villainCall: parseRange('AA,KK,QQ').range, villainFold: parseRange('JJ,TT').range };

  it('lists hero combos sorted by bluff score and selects on click', async () => {
    const wrapper = mount(BlockerPanel, { props });
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0]!.text()).toContain('AhKh');
    expect(rows[0]!.text()).toContain('+33.3');
    await rows[1]!.trigger('click');
    expect(wrapper.emitted('comboSelect')![0]).toEqual([parseCombo('JhTh')]);
    await wrapper.findAll('th button')[0]!.trigger('click'); // sort by combo
    expect(wrapper.findAll('tbody tr')[0]!.text()).toContain('JhTh');
  });

  it('explains what the selected hand kills, class by class', () => {
    const wrapper = mount(BlockerPanel, {
      props: { heroRange: parseRange('Ah5s').range, villainCall: parseRange('AQs,AJs,ATs').range, villainFold: parseRange('QJs,76s').range, board: parseCards('Kh 9h 4c'), selectedCombo: parseCombo('Ah5s') },
    });
    const hand = wrapper.find('[data-testid="hand-removal"]').text();
    expect(hand).toContain('Ah5s kills 3 of villain\'s 12 calling combos and 0 of 8 folds');
    expect(hand).toContain("villain's flush draw: 5 → 2");
    expect(hand).toContain("villain's ace high: 12 → 9");
    expect(hand).not.toContain('gutshot'); // unchanged classes are not listed
  });

  it('sizes the bluff count to the bet', () => {
    const wrapper = mount(BlockerPanel, { props: { ...props, pot: 100, bet: 100, isValue: (c: number) => c === parseCombo('AhKh') } });
    expect(wrapper.find('[data-testid="bluff-ranking"]').text()).toContain('0.5 bluffs per value combo');
    expect(wrapper.find('[data-testid="bluff-ranking"]').text()).toContain('0.5 bluffs for 1 value combos');
  });
});

describe('CardBlockerHeatmap', () => {
  it('renders 52 cards and describes the hovered one', async () => {
    const wrapper = mount(CardBlockerHeatmap, { props: { villainRange: parseRange('AA,KK').range, board } });
    const cards = wrapper.findAll('button');
    expect(cards).toHaveLength(52);
    const as = cards.find((c) => c.attributes('aria-label')?.startsWith('A♠ removes'))!;
    await as.trigger('pointerenter');
    expect(wrapper.emitted('cardHover')![0]).toEqual([parseCard('As')]);
    expect(wrapper.find('.pk-detail').text()).toContain('removes 33.3% of the range');
    expect(wrapper.find('.pk-detail').text()).toContain('overpair 50%');
  });
});

describe('ComboDrilldown', () => {
  it('lists the combos of a class with weights, classes and blocks', async () => {
    const wrapper = mount(ComboDrilldown, { props: { handClass: 1, range, board } }); // 1 = AKs
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(4);
    expect(wrapper.text()).toContain('blocked by the board'); // AdKd
    expect(wrapper.text()).toContain('top pair');
    await rows.find((r) => r.text().includes('AsKs'))!.find('input').setValue('0.25');
    const next = wrapper.emitted('update:range')![0]![0] as WeightedRange;
    expect(next.weights[parseCombo('AsKs')]).toBe(0.25);
    await wrapper.findAll('button.pk-btn')[1]!.trigger('click'); // none
    expect((wrapper.emitted('update:range')![1]![0] as WeightedRange).weights[parseCombo('AsKs')]).toBe(0);
  });
});
