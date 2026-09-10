// @vitest-environment happy-dom
import type { WeightedRange } from '@poker/core';
import { COMBO_COUNT, combosIn, equityBuckets, parseRange } from '@poker/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EquityBucketBars from '../src/components/EquityBucketBars.vue';
import EquityDistributionChart from '../src/components/EquityDistributionChart.vue';
import RangeComparisonPanel from '../src/components/RangeComparisonPanel.vue';
import RangeDiffView from '../src/components/RangeDiffView.vue';

/** A range with one equity per hand class. */
function sideOf(classes: Record<string, number>): { range: WeightedRange; equities: Float32Array } {
  const range = parseRange(Object.keys(classes).join(',')).range;
  const equities = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  for (const [cls, equity] of Object.entries(classes)) for (const combo of combosIn(parseRange(cls).range)) equities[combo] = equity;
  return { range, equities };
}

// Hero: 6 combos at 85% and 4 at 35% → mean 65%, median 85%. Villain: 6 at 15%, 6 at 50% → mean 32.5%, median 15%.
const hero = sideOf({ AA: 0.85, '76s': 0.35 });
const villain = sideOf({ KK: 0.15, QQ: 0.5 });
const chartProps = { heroEquities: hero.equities, villainEquities: villain.equities, heroWeights: hero.range.weights, villainWeights: villain.range.weights };

describe('EquityDistributionChart', () => {
  it('draws one step per combo for both ranges and the threshold line', () => {
    const wrapper = mount(EquityDistributionChart, { props: { ...chartProps, threshold: 0.8 } });
    const heroPath = wrapper.find('[data-testid="chart-hero"]').attributes('d')!;
    expect(heroPath.startsWith('M34.0 33.5')).toBe(true); // x = left margin, y = 85% equity
    expect(heroPath.split(' L')).toHaveLength(11); // the start and 10 combos
    expect(wrapper.find('[data-testid="chart-villain"]').attributes('d')!.split(' L')).toHaveLength(13);
    expect(wrapper.find('[data-testid="chart-threshold"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Hero averages 65.0%, Villain 32.5%');
    expect(mount(EquityDistributionChart, { props: chartProps }).find('[data-testid="chart-threshold"]').exists()).toBe(false);
  });

  it('reads both curves at the pointer', async () => {
    const wrapper = mount(EquityDistributionChart, { props: chartProps });
    const svg = wrapper.find('svg');
    const rect = { left: 0, top: 0, width: 320, height: 200, right: 320, bottom: 200, x: 0, y: 0, toJSON: () => ({}) };
    Object.defineProperty(svg.element, 'getBoundingClientRect', { value: () => rect });
    await svg.trigger('pointermove', { clientX: 34 + 278 * 0.5, clientY: 100 }); // the plot spans x = 34..312
    const readout = wrapper.find('[data-testid="chart-readout"]').text();
    expect(readout).toContain('the top 50% of the range');
    expect(readout).toContain('Hero ≥ 85.0%'); // the top 60% of hero is AA
    expect(readout).toContain('Villain ≥ 50.0%'); // the top 50% of villain is QQ
    await svg.trigger('pointerleave');
    expect(wrapper.find('[data-testid="chart-readout"]').exists()).toBe(false);
  });
});

describe('EquityBucketBars', () => {
  it('sizes opposed bars by share, strongest band first', () => {
    const heroBuckets = equityBuckets({ equities: hero.equities, weights: hero.range.weights });
    const villainBuckets = equityBuckets({ equities: villain.equities, weights: villain.range.weights });
    const wrapper = mount(EquityBucketBars, { props: { heroBuckets, villainBuckets } });
    const rows = wrapper.findAll('[role="row"]').slice(1);
    expect(rows.map((r) => r.find('.pk-band').text())).toEqual(['80–100%', '60–80%', '40–60%', '20–40%', '0–20%']);
    expect(rows[0]!.find('.pk-hero').attributes('style')).toContain('width: 60%');
    expect(rows[3]!.find('.pk-hero').attributes('style')).toContain('width: 40%');
    expect(rows[2]!.find('.pk-villain').attributes('style')).toContain('width: 50%');
    expect(rows[4]!.find('.pk-villain').attributes('style')).toContain('width: 50%');
    expect(rows[0]!.find('.pk-villain').attributes('style')).toContain('width: 0%');
  });
});

describe('RangeComparisonPanel', () => {
  it('shows an empty state until the equities arrive', () => {
    const wrapper = mount(RangeComparisonPanel, { props: { hero: hero.range, villain: villain.range } });
    expect(wrapper.find('[data-testid="compare-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="chart-hero"]').exists()).toBe(false);
  });

  it('compares means, medians and nuts, explains them, and switches the nut definition', async () => {
    const wrapper = mount(RangeComparisonPanel, {
      props: { hero: { ...hero.range, label: 'Hero' }, villain: { ...villain.range, label: 'Villain' }, heroEquities: hero.equities, villainEquities: villain.equities, exact: true },
    });
    const cells = (id: string) => wrapper.find(`[data-testid="${id}"]`).findAll('td').map((td) => td.text());
    expect(cells('compare-mean')).toEqual(['65.0%', '32.5%', '+32.5 pp']);
    expect(cells('compare-median')).toEqual(['85.0%', '15.0%', '+70.0 pp']);
    expect(wrapper.find('[data-testid="compare-range-explain"]').text()).toContain('Hero has the range advantage');
    expect(wrapper.find('[data-testid="compare-nut-explain"]').text()).toContain('Hero holds 100% of the nutted combos (equity ≥ 80%)');
    expect(wrapper.find('[data-testid="chart-hero"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="bucket-4"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('from exact equities');
    await wrapper.find('input[value="topPercent"]').setValue();
    // The top 5% of the 22 combos together is 1.1 weight: reached inside AA, so the threshold is 85%.
    expect(wrapper.find('[data-testid="compare-nut-explain"]').text()).toContain('the top of both ranges, equity ≥ 85.0%');
  });
});

describe('RangeDiffView', () => {
  it('counts the overlap, tints the cells by difference and forwards cell clicks', async () => {
    const wrapper = mount(RangeDiffView, { props: { ranges: [{ label: 'Mine', range: parseRange('AA,KK').range }, { label: 'Solver', range: parseRange('KK,QQ').range }] } });
    expect(wrapper.find('[data-testid="diff-summary-0"]').text()).toBe('6 combos in both · only in Mine: 6 (6 weighted) · only in Solver: 6 (6 weighted) · weight moved 12');
    const cells = wrapper.findAll('[role="gridcell"]');
    const aa = cells.find((c) => c.attributes('title')?.startsWith('AA:'))!;
    expect(aa.attributes('title')).toContain('difference +100.0%');
    expect(aa.find('.pk-heat-more').exists()).toBe(true);
    const kk = cells.find((c) => c.attributes('title')?.startsWith('KK:'))!;
    expect(kk.find('.pk-heat').exists()).toBe(false); // no difference, no overlay
    const qq = cells.find((c) => c.attributes('title')?.startsWith('QQ:'))!;
    expect(qq.attributes('title')).toContain('difference -100.0%');
    expect(qq.find('.pk-heat-less').exists()).toBe(true);
    await aa.trigger('pointerdown');
    expect(wrapper.emitted('cellClick')![0]).toEqual([0]); // AA is hand class 0
  });

  it('asks for two ranges', () => {
    const wrapper = mount(RangeDiffView, { props: { ranges: [{ label: 'Mine', range: parseRange('AA').range }] } });
    expect(wrapper.text()).toContain('Give two or more ranges');
  });
});
