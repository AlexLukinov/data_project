// @vitest-environment happy-dom
/**
 * Step 4 grades the prediction by the nut definition the panel shows (ADR-053): the Advanced fold
 * reaches the graded number, and once an answer is committed the definition stays put.
 */
import type { EquityResult } from '@poker/core';
import { COMBO_COUNT, combosIn, parseRange } from '@poker/core';
import { EquityCalculator, RangeComparisonPanel } from '@poker/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function render(prediction: Prediction | null = null) {
  const step: AnalysisStep = { ...emptyStep(4), prediction };
  const ctx: StepContext = { step, steps: [step], node: null, spot: { hero: HERO, villain: VILLAIN, board: [], heroCards: [] }, hand: null, pool: null, poolFacing: null, heuristic: '' };
  return mount(Step4Nuts, { props: { ctx }, global: { stubs: { EquityCalculator: true } } });
}

async function answered(wrapper: ReturnType<typeof render>) {
  wrapper.findComponent(EquityCalculator).vm.$emit('result', RESULT);
  await flushPromises();
}

const graded = (wrapper: ReturnType<typeof render>) => wrapper.findComponent(StepShell).props('actual');
const split = (wrapper: ReturnType<typeof render>) => wrapper.find('[data-testid="compare-nut-split"]').attributes('aria-label');
const cutoff = (wrapper: ReturnType<typeof render>) => wrapper.find('input[aria-label="nut cutoff, percent"]');

describe('Step4Nuts — the graded nut split', () => {
  beforeEach(() => vi.stubGlobal('useEquityService', () => ({ service: { compute: vi.fn(), cancel: vi.fn() } })));
  afterEach(() => vi.unstubAllGlobals());

  it('locks the definition once an answer is committed, and says why', async () => {
    const wrapper = render(COMMITTED);
    await answered(wrapper);
    expect(cutoff(wrapper).attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="compare-nut-locked"]').text()).toContain('graded by');
    expect(graded(wrapper)).toBe('0.0');
  });

  it('grades by the definition the panel shows, before and after it changes', async () => {
    const wrapper = render();
    await answered(wrapper);
    expect(split(wrapper)).toContain('Hero 0%');
    expect(graded(wrapper)).toBe('0.0');

    await cutoff(wrapper).setValue('55');
    await flushPromises();
    expect(wrapper.findComponent(RangeComparisonPanel).props('nutOptions')).toMatchObject({ mode: 'cutoff', cutoff: 0.55 });
    // 77 (6 combos) and AKs (4) against KK (6): 10 of 16 nutted combos are the hero's.
    expect(split(wrapper)).toContain('Hero 63%');
    expect(graded(wrapper)).toBe('62.5');
    expect(wrapper.find('[data-testid="compare-nut-locked"]').exists()).toBe(false);
  });
});
