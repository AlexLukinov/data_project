// @vitest-environment happy-dom
/**
 * Step 4 grades the prediction by the nut definition the panel shows (ADR-053): the Advanced fold
 * reaches the graded number, and once an answer is committed the definition stays put.
 *
 * And it does not print that number before asking for it (ADR-061): the nut split *is* the step's
 * question, so the panel withholds it until the gate is closed — while the equities beside it,
 * which are the work rather than the answer, stay on screen throughout.
 */
import type { EquityResult } from '@poker/core';
import { COMBO_COUNT, DEFAULT_NUT_CUTOFF, combosIn, parseRange } from '@poker/core';
import { EquityCalculator, RangeComparisonPanel } from '@poker/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

import type { AnalysisStep, Prediction } from '~/analyze/api';
import { emptyStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import StepShell from '~/components/analyze/StepShell.vue';

import Step4Nuts from './Step4Nuts.vue';

const HERO = parseRange('77,AKs').range;
const VILLAIN = parseRange('KK,JJ').range;

/** Per-combo equities with one value per hand class, NaN elsewhere. */
function equitiesOf(classes: Record<string, number>): Float32Array {
  const equities = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  for (const [text, equity] of Object.entries(classes)) for (const combo of combosIn(parseRange(text).range)) equities[combo] = equity;
  return equities;
}

/**
 * Sets at 70%, top pair at 60%, the overpair at 90%, the underpair at 40%: at the default 80% only
 * the villain's KK is nutted, at 55% the hero's 77 and AKs join it.
 */
const RESULT = {
  perComboEquity: equitiesOf({ '77': 0.7, AKs: 0.6 }),
  perComboEquityVillain: equitiesOf({ KK: 0.9, JJ: 0.4 }),
} as unknown as EquityResult;

const COMMITTED: Prediction = { question: 'q', answer_type: 'percent', answer: '40', actual: '', error: null, within_tolerance: null, committed_at: '2026-09-15T10:00:00Z' };
const PERCENT = 100;

type Wrapper = ReturnType<typeof mount>;

/** The step as the page holds it, so a test can commit an answer under a mounted component. */
function render(prediction: Prediction | null = null): { wrapper: Wrapper; commit: () => void } {
  const state = reactive<{ step: AnalysisStep }>({ step: { ...emptyStep(4), prediction } });
  const ctx: StepContext = {
    get step() {
      return state.step;
    },
    get steps() {
      return [state.step];
    },
    node: null,
    spot: { hero: HERO, villain: VILLAIN, board: [], heroCards: [] },
    pool: null,
    poolFacing: null,
    heuristic: '',
  };
  const wrapper = mount(Step4Nuts, { props: { ctx }, global: { stubs: { EquityCalculator: true } } });
  return { wrapper, commit: () => (state.step = { ...state.step, prediction: COMMITTED }) };
}

async function answered(wrapper: Wrapper) {
  wrapper.findComponent(EquityCalculator).vm.$emit('result', RESULT);
  await flushPromises();
}

const graded = (wrapper: Wrapper) => wrapper.findComponent(StepShell).props('actual');
const split = (wrapper: Wrapper) => wrapper.find('[data-testid="compare-nut-split"]').attributes('aria-label');
const has = (wrapper: Wrapper, id: string) => wrapper.find(`[data-testid="${id}"]`).exists();
const cutoff = (wrapper: Wrapper) => wrapper.find('input[aria-label="nut cutoff, percent"]');

describe('Step4Nuts — the graded nut split', () => {
  beforeEach(() => vi.stubGlobal('useEquityService', () => ({ service: { compute: vi.fn(), cancel: vi.fn() } })));
  afterEach(() => vi.unstubAllGlobals());

  it('locks the definition once an answer is committed, and says why', async () => {
    const { wrapper } = render(COMMITTED);
    await answered(wrapper);
    expect(cutoff(wrapper).attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="compare-nut-locked"]').text()).toContain('graded by');
    expect(graded(wrapper)).toBe('0.0');
    expect(split(wrapper)).toContain('Hero 0%');
  });

  it('withholds the split, the shares and the sentence until the answer is in — and nothing else', async () => {
    const { wrapper, commit } = render();
    await answered(wrapper);

    for (const id of ['compare-nut-split', 'compare-nut-threshold', 'compare-nut-explain']) expect(has(wrapper, id), id).toBe(false);
    expect(wrapper.find('[data-testid="compare-nut-hidden"]').text()).toContain('Commit your answer');
    // The work stays on screen: the equities either side of it, and the definition control itself.
    expect(has(wrapper, 'compare-mean')).toBe(true);
    expect(has(wrapper, 'compare-range-explain')).toBe(true);
    expect(cutoff(wrapper).attributes('disabled')).toBeUndefined();

    commit();
    await flushPromises();
    expect(has(wrapper, 'compare-nut-hidden')).toBe(false);
    expect(split(wrapper)).toContain('Hero 0%');
  });

  it('withholds the equity bands too: the top one is the nutted set, with its weight on hover', async () => {
    // 80-100% is exactly DEFAULT_NUT_CUTOFF, and each side of the band carries its weighted combos
    // in a title — so the two together are the graded number, one hover away from the gate.
    const { wrapper, commit } = render();
    await answered(wrapper);
    expect(wrapper.findAll('[data-testid^="bucket-"]')).toHaveLength(0);
    expect(wrapper.html()).not.toContain('weighted combos');

    commit();
    await flushPromises();
    // The top band is the last edge pair, 80–100%, which is DEFAULT_NUT_CUTOFF exactly.
    const bands = wrapper.findAll('[data-testid^="bucket-"]');
    expect(bands.length).toBeGreaterThan(0);
    expect(bands[0]!.text()).toContain(`${Math.round(PERCENT * DEFAULT_NUT_CUTOFF)}–100%`);
    expect(bands[0]!.html()).toContain('weighted combos');
  });

  it('grades by the definition the panel shows, before and after it changes', async () => {
    const { wrapper } = render();
    await answered(wrapper);
    expect(graded(wrapper)).toBe('0.0');

    await cutoff(wrapper).setValue('55');
    await flushPromises();
    expect(wrapper.findComponent(RangeComparisonPanel).props('nutOptions')).toMatchObject({ mode: 'cutoff', cutoff: 0.55 });
    // 77 (6 combos) and AKs (4) against KK (6): 10 of 16 nutted combos are the hero's.
    expect(graded(wrapper)).toBe('62.5');
    expect(has(wrapper, 'compare-nut-locked')).toBe(false);
  });
});
