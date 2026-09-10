// @vitest-environment happy-dom
import type { RakeConfig } from '@poker/core';
import { COMBO_COUNT, combosIn, parseRange } from '@poker/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EQRPanel from '../src/components/EQRPanel.vue';
import MDFPanel from '../src/components/MDFPanel.vue';
import MetricLabel from '../src/components/MetricLabel.vue';
import PotOddsPanel from '../src/components/PotOddsPanel.vue';

/** GG-style rake: 5% of the pot, capped at 3. */
const GG_RAKE: RakeConfig = { rakePct: 0.05, rakeCapBB: 3 };

/** Per-combo equities with one value per hand class, NaN elsewhere. */
function equitiesOf(classes: Record<string, number>): Float32Array {
  const eq = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  for (const [text, equity] of Object.entries(classes)) for (const combo of combosIn(parseRange(text).range)) eq[combo] = equity;
  return eq;
}

describe('PotOddsPanel', () => {
  it('shows every figure raw and after rake (pot 100, bet 50, rake 5% capped at 3)', () => {
    const wrapper = mount(PotOddsPanel, { props: { pot: 100, bet: 50, rakeConfig: GG_RAKE } });
    const cells = (id: string) => wrapper.find(`[data-testid="${id}"]`).findAll('td').map((td) => td.text());
    // After rake the pot a fold wins is 97, a call wins 197 − 50 = 147.
    expect(cells('odds-potOdds')).toEqual(['3 : 1', '2.9 : 1']);
    expect(cells('odds-requiredEquity')).toEqual(['25.0%', '25.4%']);
    expect(cells('odds-mdf')).toEqual(['66.7%', '66.0%']);
    expect(cells('odds-alpha')).toEqual(['33.3%', '34.0%']);
    expect(cells('odds-bluffBreakeven')).toEqual(['33.3%', '34.0%']);
    expect(cells('odds-bluffsPerValue')).toEqual(['0.33', '0.34']);
    expect(wrapper.find('[data-testid="odds-explain"]').text()).toContain('Calling 50 to win 150 is 3 : 1');
    expect(wrapper.find('[data-testid="odds-implied"]').exists()).toBe(false);
  });

  it('adds implied odds as an estimate and emits edits', async () => {
    const wrapper = mount(PotOddsPanel, { props: { pot: 100, bet: 50, impliedExtra: 100 } });
    expect(wrapper.find('[data-testid="odds-implied"]').text()).toContain('16.7%'); // 50 / 300
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('120');
    expect(wrapper.emitted('update:pot')![0]).toEqual([120]);
    await inputs[3]!.setValue('4'); // rake %
    expect(wrapper.emitted('update:rakeConfig')![0]).toEqual([{ rakePct: 0.04, rakeCapBB: null }]);
    await inputs[4]!.setValue('2'); // cap
    expect(wrapper.emitted('update:rakeConfig')![1]).toEqual([{ rakePct: 0, rakeCapBB: 2 }]);
  });

  it('explains a pot of zero instead of failing', () => {
    const wrapper = mount(PotOddsPanel, { props: { pot: 0, bet: 50 } });
    expect(wrapper.find('[role="alert"]').text()).toContain('pot must be positive');
  });
});

describe('MDFPanel', () => {
  it('shows MDF and alpha and names the defending set by equity', async () => {
    const range = parseRange('AA,KK,QQ').range;
    const wrapper = mount(MDFPanel, { props: { pot: 100, bet: 50, range, equities: equitiesOf({ AA: 0.9, KK: 0.6, QQ: 0.3 }) } });
    expect(wrapper.find('[data-testid="mdf-value"]').text()).toContain('66.7%');
    expect(wrapper.find('[data-testid="alpha-value"]').text()).toContain('33.3%');
    // MDF 2/3 of 18 weighted combos = 12: AA (6) and KK (6); the cutoff is KK's 60%.
    expect(wrapper.find('[data-testid="mdf-explain"]').text()).toContain('12 combos (12 weighted) with at least 60.0% equity');
    await wrapper.find('[data-testid="mdf-show"]').trigger('click');
    const combos = wrapper.emitted('defendClick')![0]![0] as number[];
    expect(combos).toHaveLength(12);
    expect(combos.every((c) => range.weights[c]! > 0)).toBe(true);
  });

  it('waits for the equities before naming the defending set', () => {
    const wrapper = mount(MDFPanel, { props: { pot: 100, bet: 50, range: parseRange('AA').range } });
    expect(wrapper.text()).toContain('appears when the equities have been computed');
    expect(wrapper.find('[data-testid="mdf-show"]').exists()).toBe(false);
  });
});

describe('EQRPanel', () => {
  it('turns an entered EV into EQR, shows the pool figure with n, and explains', async () => {
    const wrapper = mount(EQRPanel, { props: { equity: 0.45, pot: 100, ev: 38, poolEqr: { eqr: 0.91, sampleSize: 900 } } });
    expect(wrapper.find('[data-testid="eqr-full"]').text()).toBe('45');
    expect(wrapper.find('[data-testid="eqr-value"]').text()).toContain('0.84'); // 38 / 45
    expect(wrapper.find('[data-testid="eqr-pool"]').text()).toContain('0.91');
    expect(wrapper.find('[data-testid="eqr-pool"]').text()).toContain('n = 900');
    const explain = wrapper.find('[data-testid="eqr-explain"]').text();
    expect(explain).toContain('84% of the 45');
    expect(explain).toContain('under-realizes');
    await wrapper.find('input').setValue('50');
    expect(wrapper.emitted('update:ev')![0]).toEqual([50]);
  });

  it('refuses an equity of zero', () => {
    const wrapper = mount(EQRPanel, { props: { equity: 0, pot: 100 } });
    expect(wrapper.find('[role="alert"]').text()).toContain('positive pot and an equity above 0');
  });
});

describe('MetricLabel', () => {
  it('renders the term with its glossary tooltip', () => {
    const wrapper = mount(MetricLabel, { props: { term: 'mdf' } });
    const text = wrapper.find('.pk-term-text');
    expect(text.text()).toBe('MDF');
    const tip = wrapper.find('[role="tooltip"]');
    expect(tip.text()).toContain('Minimum defence frequency');
    expect(tip.text()).toContain('pot / (pot + bet)');
    expect(text.attributes('aria-describedby')).toBe(tip.attributes('id'));
  });

  it('keeps the tooltip when the visible label is overridden', () => {
    const wrapper = mount(MetricLabel, { props: { term: 'eqr', label: 'EQR, pool' } });
    expect(wrapper.find('.pk-term-text').text()).toBe('EQR, pool');
    expect(wrapper.find('[role="tooltip"]').text()).toContain('Equity realization');
  });
});
