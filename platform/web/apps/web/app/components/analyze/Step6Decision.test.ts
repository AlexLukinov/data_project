// @vitest-environment happy-dom
import type { EquityResult, WeightedRange } from '@poker/core';
import { COMBO_COUNT, combosIn, parseRange, rangeAdvantage } from '@poker/core';
import { EquityCalculator, explainRangeAdvantage } from '@poker/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalysisStep, StepWork } from '~/analyze/api';
import { emptyStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { EMPTY_SPOT } from '~/analyze/spot';

import Step6Decision from './Step6Decision.vue';

/** Step 6 with its patches applied back, as the analyzer page does. */
function render(work: Partial<StepWork> = {}) {
  const base = emptyStep(6);
  const step: AnalysisStep = { ...base, work: { ...base.work, ...work } };
  const ctx: StepContext = { step, steps: [step], node: null, spot: EMPTY_SPOT, hand: null, pool: null, poolFacing: null, heuristic: '' };
  const wrapper = mount(Step6Decision, {
    props: {
      ctx,
      onPatch: (patch: Partial<AnalysisStep>): void => {
        const current = wrapper.props('ctx');
        void wrapper.setProps({ ctx: { ...current, step: { ...current.step, ...patch } } });
      },
    },
  });
  return wrapper;
}

const box = (w: ReturnType<typeof render>, id: string) => w.find(`[data-testid="${id}"]`);
const work = (w: ReturnType<typeof render>) => w.props('ctx').step.work;

describe('Step6Decision — frequency and size', () => {
  beforeEach(() => vi.stubGlobal('useEquityService', () => ({ service: { compute: vi.fn(), cancel: vi.fn() } })));
  afterEach(() => vi.unstubAllGlobals());

  it('stores nothing for a frequency above 100 or text that is not a number', async () => {
    const w = render({ frequency: 0.4 });
    await box(w, 'step6-frequency').setValue('150');
    await box(w, 'step6-frequency').setValue('4..5');
    expect(w.emitted('patch')).toBeUndefined();
    expect(work(w).frequency).toBe(0.4);
  });

  it('never stores a size of 0, which is no bet, and keeps the size that stood', async () => {
    const w = render({ size_pct: 0.33 });
    await box(w, 'step6-size').setValue('0');
    await box(w, 'step6-size').setValue('0,');
    expect(w.emitted('patch')).toBeUndefined();
    await box(w, 'step6-size').setValue('0,5');
    expect(work(w).size_pct).toBeCloseTo(0.005);
  });

  it('clears an answer when its box is emptied', async () => {
    const w = render({ frequency: 0.4, size_pct: 0.75 });
    await box(w, 'step6-frequency').setValue('');
    await box(w, 'step6-size').setValue('');
    expect([work(w).frequency, work(w).size_pct]).toEqual([null, null]);
  });

  it('stores a comma-typed percent as a share and leaves the text as typed', async () => {
    const w = render();
    await box(w, 'step6-frequency').setValue('45,5');
    await box(w, 'step6-size').setValue('33');
    expect(work(w).frequency).toBeCloseTo(0.455);
    expect(work(w).size_pct).toBeCloseTo(0.33);
    expect((box(w, 'step6-frequency').element as HTMLInputElement).value).toBe('45,5');
  });

  it('shows a stored share in percent without rounding it away', () => {
    const w = render({ frequency: 0.285, size_pct: 0.07 });
    expect((box(w, 'step6-frequency').element as HTMLInputElement).value).toBe('28.5');
    expect((box(w, 'step6-size').element as HTMLInputElement).value).toBe('7');
  });
});

const HERO: WeightedRange = { ...parseRange('77,AKs').range, label: 'BTN' };
const VILLAIN: WeightedRange = { ...parseRange('KK,JJ').range, label: 'BB' };

/** Per-combo equities with one value per hand class, NaN elsewhere. */
function equitiesOf(classes: Record<string, number>): Float32Array {
  const equities = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  for (const [text, equity] of Object.entries(classes)) for (const combo of combosIn(parseRange(text).range)) equities[combo] = equity;
  return equities;
}

/** Step 6 with both seats' ranges and the calculator stubbed, answered with these equities. */
async function answered(villain: Record<string, number>) {
  const step = emptyStep(6);
  const ctx: StepContext = { step, steps: [step], node: null, spot: { hero: HERO, villain: VILLAIN, board: [], heroCards: [] }, hand: null, pool: null, poolFacing: null, heuristic: '' };
  const wrapper = mount(Step6Decision, { props: { ctx }, global: { stubs: { EquityCalculator: true } } });
  expect(wrapper.find('[data-testid="step6-advantage"]').exists()).toBe(false);
  const result = { perComboEquity: equitiesOf({ '77': 0.7, AKs: 0.6 }), perComboEquityVillain: equitiesOf(villain) } as unknown as EquityResult;
  wrapper.findComponent(EquityCalculator).vm.$emit('result', result);
  await flushPromises();
  return { wrapper, result };
}

describe('Step6Decision — the range advantage in words', () => {
  beforeEach(() => vi.stubGlobal('useEquityService', () => ({ service: { compute: vi.fn(), cancel: vi.fn() } })));
  afterEach(() => vi.unstubAllGlobals());

  it("is the shared template's sentence, naming the seats as the calculator does", async () => {
    const { wrapper, result } = await answered({ KK: 0.3, JJ: 0.4 });
    const advantage = rangeAdvantage({ equities: result.perComboEquity, weights: HERO.weights }, { equities: result.perComboEquityVillain, weights: VILLAIN.weights });
    const text = wrapper.find('[data-testid="step6-advantage"]').text();
    expect(text).toBe(explainRangeAdvantage(advantage, 'BTN', 'BB'));
    // 77 (6 combos) at 70% and AKs (4) at 60% average 66%; KK at 30% and JJ at 40% average 35%.
    expect(text).toBe('BTN has the range advantage: 66.0% average equity against 35.0% for BB, 31.0 points more.');
  });

  it('calls a gap inside the even-range margin no advantage at all', async () => {
    const { wrapper } = await answered({ KK: 0.65, JJ: 0.65 });
    expect(wrapper.find('[data-testid="step6-advantage"]').text()).toContain('within 1.0 points: no real range advantage either way');
  });
});
