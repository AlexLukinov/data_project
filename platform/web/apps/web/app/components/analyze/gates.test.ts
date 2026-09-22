// @vitest-environment happy-dom
/**
 * No step prints the number its own gate grades before the gate is closed (ADR-034's rule, ADR-061).
 *
 * Step 4 was the one the round was sent to fix; reviewing it found two siblings, both of which an
 * example now puts in front of a first-time reader. Step 5's blocker panel says "kills N of
 * villain's calls", which on a rainbow board is exactly what the step asks for. Step 8 printed the
 * bluff-to-value ratio as soon as both halves were marked, which is exactly what it grades.
 *
 * The honest limit, stated rather than pretended away: step 5's per-combo table stays, because
 * "see exactly which of their combos your own two cards make impossible" is the step's whole
 * subject, and a reader who finds their own hand in it can read a percentage off that row. What is
 * withheld is the line that does the arithmetic for them. Step 4's equity bands were hidden
 * instead, because there the summary row *is* the graded number — see `Step4Nuts.test.ts`.
 *
 * **Step 3 is step 5's case, deliberately, and this is where that is written down (ADR-071).**
 * Its gate grades villain's top-pair-or-better share, and a reader can add the made-class rows at
 * or above "Top pair" in the villain panel and arrive at exactly it — more exactly since the
 * denominator fix, which made the panel and the reveal agree. That is not a leak to be closed:
 * the step is titled "Bucket both ranges on the board", its purpose is "Count what each range
 * actually hit — by made-hand class, side by side", and its hint is "Count the classes, not the
 * feeling". The panel is the instrument the step hands the reader for the counting it asks for,
 * so withholding it would make the step's own hint a lie and leave nothing to work with. What is
 * withheld is what always was: `step3-comparison`, the sentence that states the share in words
 * and says who the board favours, gated on the commit — the one summary arithmetically equal to
 * the graded figure. The test below holds that line.
 */
import { parseCards, parseRange } from '@poker/core';
import { ComboDistributionPanel } from '@poker/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

import type { AnalysisStep, Prediction } from '~/analyze/api';
import { emptyStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';

import Step3Buckets from './Step3Buckets.vue';
import Step5Blockers from './Step5Blockers.vue';
import Step8ValueBluffs from './Step8ValueBluffs.vue';

/** A rainbow flop: step 5 then asks how many combos the hand removes, which is what the panel prints. */
const RAINBOW = 'Kh 9d 4s';
const HERO = parseRange('AA,KK,QQ,AKs,AKo,77').range;
const VILLAIN = parseRange('TT-22,AJs-A2s,KTs+,QTs+,JTs,AJo-ATo,KQo').range;

const COMMITTED: Prediction = { question: 'q', answer_type: 'number', answer: '12', actual: '', error: null, within_tolerance: null, committed_at: '2026-09-20T10:00:00Z' };

function render(component: typeof Step3Buckets | typeof Step5Blockers | typeof Step8ValueBluffs, step: AnalysisStep) {
  const state = reactive<{ step: AnalysisStep }>({ step });
  const ctx: StepContext = {
    get step() {
      return state.step;
    },
    get steps() {
      return [state.step];
    },
    node: null,
    spot: { hero: HERO, villain: VILLAIN, board: parseCards(RAINBOW), heroCards: parseCards('AcKc') },
    pool: null,
    poolFacing: null,
    heuristic: '',
  };
  const wrapper = mount(component, { props: { ctx }, global: { stubs: { CardPicker: true, CardBlockerHeatmap: true } } });
  return { wrapper, commit: () => (state.step = { ...state.step, prediction: COMMITTED }) };
}

function step3(): AnalysisStep {
  const step = emptyStep(3);
  step.work.board = RAINBOW;
  return step;
}

function step5(): AnalysisStep {
  const step = emptyStep(5);
  step.work.hero_cards = 'AcKc';
  return step;
}

function step8(): AnalysisStep {
  const step = emptyStep(8);
  step.work.value_weights = 'AA,KK';
  step.work.bluff_weights = 'AKo';
  return step;
}

describe('no step gives its own answer away before the gate', () => {
  beforeEach(() => vi.stubGlobal('useEquityService', () => ({ service: { compute: vi.fn(), cancel: vi.fn() } })));
  afterEach(() => vi.unstubAllGlobals());

  it('step 5 keeps the per-hand removal count until the prediction is in', async () => {
    const { wrapper, commit } = render(Step5Blockers, step5());
    await flushPromises();
    // The table and the heatmap are the work and stay; the line naming hero's own hand is the answer.
    expect(wrapper.find('[data-testid="hand-removal"]').exists()).toBe(false);

    commit();
    await flushPromises();
    const removal = wrapper.find('[data-testid="hand-removal"]');
    expect(removal.exists()).toBe(true);
    expect(removal.text()).toContain('kills');
  });

  it('step 3 keeps the sentence that states the share, and keeps both panels either way', async () => {
    const { wrapper, commit } = render(Step3Buckets, step3());
    await flushPromises();
    expect(wrapper.find('[data-testid="step3-comparison"]').exists()).toBe(false);
    // The two distribution panels are the step's subject and are on screen before the answer.
    expect(wrapper.findAllComponents(ComboDistributionPanel)).toHaveLength(2);

    commit();
    await flushPromises();
    expect(wrapper.find('[data-testid="step3-comparison"]').text()).toContain('top pair or better');
    expect(wrapper.findAllComponents(ComboDistributionPanel)).toHaveLength(2);
  });

  it('step 8 keeps the bluff-to-value ratio until the prediction is in', async () => {
    const { wrapper, commit } = render(Step8ValueBluffs, step8());
    await flushPromises();
    expect(wrapper.find('[data-testid="step8-ratio"]').exists()).toBe(false);

    commit();
    await flushPromises();
    const ratio = wrapper.find('[data-testid="step8-ratio"]');
    expect(ratio.exists()).toBe(true);
    expect(ratio.text()).toContain('bluffs per value combo');
  });
});
