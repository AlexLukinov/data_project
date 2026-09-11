// @vitest-environment happy-dom
/**
 * The two tier-3 panels (plan F.10). Both exist to stop a number being read as more than it is,
 * so that is what the tests check: the reconstruction always shows its gap against tier 1 and
 * names the direction, and an EQR never appears without the equity it was divided by.
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EstimatedRangePanel from '../src/components/EstimatedRangePanel.vue';
import PoolRealizationPanel from '../src/components/PoolRealizationPanel.vue';
import type { EstimatedClass, RealizationRow } from '../src/estimate';
import { poolEqr } from '../src/estimate';

function cls(hand_class: string, over: Partial<EstimatedClass> = {}): EstimatedClass {
  return { hand_class, prior: 0.25, posterior: 0.4, likelihood: 1.6, action_rate: 0.23, sample_size: 1633, fallback: false, ...over };
}

function row(hand_class: string, over: Partial<RealizationRow> = {}): RealizationRow {
  return { hand_class, sample_size: 400, mean_net_bb: 9, mean_pot_bb: 10, realized: 0.9, ...over };
}

const BASE = { action: 'bet', measured: 35, total: 51, minBucketN: 200 };

describe('EstimatedRangePanel', () => {
  it('puts what the range implies next to what tier 1 measured', () => {
    const w = mount(EstimatedRangePanel, { props: { ...BASE, observed: 0.1413, implied: 0.1319, classes: [] } });
    expect(w.get('[data-testid="tier3-implied"]').text()).toBe('13.2%');
    expect(w.get('[data-testid="tier3-observed"]').text()).toBe('14.1%');
    expect(w.get('[data-testid="tier3-gap"]').text()).toBe('-0.9 pts');
  });

  it('names which way a big gap runs rather than only that there is one', () => {
    const heavy = mount(EstimatedRangePanel, { props: { ...BASE, observed: 0.14, implied: 0.30, classes: [] } });
    expect(heavy.get('[data-testid="tier3-verdict"]').text()).toContain('too heavy on hands that bet here');

    const light = mount(EstimatedRangePanel, { props: { ...BASE, observed: 0.30, implied: 0.14, classes: [] } });
    expect(light.get('[data-testid="tier3-verdict"]').text()).toContain('too heavy on hands that do not bet here');
  });

  it('calls a small gap agreement, not a failure', () => {
    const w = mount(EstimatedRangePanel, { props: { ...BASE, observed: 0.1413, implied: 0.1319, classes: [] } });
    expect(w.get('[data-testid="tier3-verdict"]').text()).toContain('about as often as it really does');
    expect(w.get('[data-testid="tier3-gap"]').classes()).toContain('pk-near');
  });

  it('says how many classes could be measured and what happened to the rest', () => {
    const w = mount(EstimatedRangePanel, { props: { ...BASE, observed: 0.14, implied: 0.13, classes: [] } });
    const text = w.get('[data-testid="tier3-coverage"]').text();
    expect(text).toContain('35 of the 51');
    expect(text).toContain('the other 16');
    expect(text).toContain('fewer than 200 times');
    expect(text).toContain('left exactly as you drew them');
  });

  it('does not promise a remainder when every class was measured', () => {
    // Once the corpus re-parse took pool card coverage to 100%, whole charts began clearing
    // MIN_BUCKET_N at busy nodes -- and the sentence still read "the rest were shown fewer
    // than 200 times", describing a set with nothing in it.
    const w = mount(EstimatedRangePanel, {
      props: { ...BASE, measured: 51, observed: 0.147, implied: 0.191, classes: [] },
    });
    const text = w.get('[data-testid="tier3-coverage"]').text();
    expect(text).toContain('every one of the 51');
    expect(text).not.toContain('the rest');
    expect(text).not.toContain('left exactly as you drew them');
  });

  it('shows a class that could not be measured as kept, with no multiplier', () => {
    const classes = [cls('KK'), cls('22', { likelihood: 1, posterior: 0.25, sample_size: 12, fallback: true })];
    const w = mount(EstimatedRangePanel, { props: { ...BASE, observed: 0.14, implied: 0.13, classes } });
    expect(w.get('[data-testid="tier3-row-KK"]').text()).toContain('1.60×');
    expect(w.get('[data-testid="tier3-row-22"]').text()).toContain('kept');
    expect(w.get('[data-testid="tier3-row-22"]').classes()).toContain('pk-kept');
  });

  it('has nothing to say when the node was never played enough to ask', () => {
    const w = mount(EstimatedRangePanel, { props: { ...BASE, observed: null, implied: null, classes: [] } });
    expect(w.get('[data-testid="tier3-gap"]').text()).toBe('—');
    expect(w.get('[data-testid="tier3-verdict"]').text()).toContain('not played this situation often enough');
  });
});

describe('poolEqr', () => {
  it('is realization over equity, and nothing at all without both', () => {
    expect(poolEqr(0.9, 0.75)).toBeCloseTo(1.2, 6);
    expect(poolEqr(0.9, null)).toBeNull();
    expect(poolEqr(null, 0.75)).toBeNull();
    expect(poolEqr(0.9, 0)).toBeNull();
  });
});

describe('PoolRealizationPanel', () => {
  const props = { action: 'bet', overall: row('', { sample_size: 3000, mean_net_bb: 2.4, mean_pot_bb: 8, realized: 0.3 }), rows: [row('AA')], covers: 0.018, minBucketN: 200 };

  it('completes EQR only where an equity was handed in', () => {
    const blank = mount(PoolRealizationPanel, { props });
    expect(blank.get('[data-testid="realization-eqr"]').text()).toContain('needs an equity to divide by');
    expect(blank.get('[data-testid="realization-AA"]').text()).toContain('—');

    const filled = mount(PoolRealizationPanel, { props: { ...props, equity: { AA: 0.75 }, overallEquity: 0.25 } });
    expect(filled.get('[data-testid="realization-eqr"]').text()).toContain('1.2');
    expect(filled.get('[data-testid="realization-AA"]').text()).toContain('1.2');
  });

  it('says the per-hand rows only see the hands that were turned over', () => {
    const w = mount(PoolRealizationPanel, { props });
    const note = w.get('[data-testid="realization-covers"]').text();
    expect(note).toContain('1.8%');
    expect(note).toContain('favours hands that saw a showdown');
  });

  it('gives a thin class its count and no number', () => {
    const thin = row('72o', { sample_size: 41, mean_net_bb: null, mean_pot_bb: null, realized: null });
    const w = mount(PoolRealizationPanel, { props: { ...props, rows: [thin], equity: { '72o': 0.3 } } });
    const cell = w.get('[data-testid="realization-72o"]');
    expect(cell.text()).toContain('41');
    expect(cell.text()).toContain('too few');
    expect(cell.classes()).toContain('pk-thin');
  });

  it('says so plainly when the field has not taken the action enough', () => {
    const w = mount(PoolRealizationPanel, { props: { ...props, overall: null, rows: [] } });
    expect(w.get('[data-testid="realization-empty"]').text()).toContain('not bet here often enough');
  });
});
