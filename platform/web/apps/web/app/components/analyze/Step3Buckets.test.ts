// @vitest-environment happy-dom
/**
 * Step 3 reads its two distributions out as one comparison — but only once the prediction is
 * committed: the sentence carries villain's top-pair-or-better share, which is exactly what the
 * step asks the reader to predict, so showing it earlier would hand over the answer.
 */
import type { Card, WeightedRange } from '@poker/core';
import { parseCards, parseRange } from '@poker/core';
import { explainHitShares } from '@poker/ui';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { AnalysisStep, Prediction } from '~/analyze/api';
import { emptyStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { topPairOrBetterShare } from '~/analyze/reveals';

import Step3Buckets from './Step3Buckets.vue';

const BOARD = parseCards('Ks 7d 2c');
/** AA is an overpair on K-7-2 and QJs has nothing: 6 of 10 combos. */
const HERO = parseRange('AA,QJs').range;
/** The same six AA against eight suited connectors that missed: 6 of 14. */
const VILLAIN = parseRange('AA,JTs,T9s').range;

const COMMITTED: Prediction = { question: 'q', answer_type: 'percent', answer: '40', actual: '', error: null, within_tolerance: null, committed_at: '2026-09-15T10:00:00Z' };

function render(prediction: Prediction | null, seats: { villain?: WeightedRange | null; board?: Card[] } = {}) {
  const step: AnalysisStep = { ...emptyStep(3), prediction };
  const spot = { hero: HERO, villain: seats.villain === undefined ? VILLAIN : seats.villain, board: seats.board ?? BOARD, heroCards: [] };
  const ctx: StepContext = { step, steps: [step], node: null, spot, pool: null, poolFacing: null, heuristic: '' };
  return mount(Step3Buckets, { props: { ctx } });
}

const comparison = (wrapper: ReturnType<typeof render>) => wrapper.find('[data-testid="step3-comparison"]');

describe('Step3Buckets — the comparison sentence', () => {
  it('says nothing before the prediction is committed, since it would give the answer away', () => {
    const wrapper = render(null);
    expect(wrapper.text()).toContain('Their range');
    expect(comparison(wrapper).exists()).toBe(false);
  });

  it("has nothing to compare without the other seat's range or a dealt board", () => {
    expect(comparison(render(COMMITTED, { villain: null })).exists()).toBe(false);
    expect(comparison(render(COMMITTED, { board: parseCards('Ks 7d') })).exists()).toBe(false);
  });

  it('compares both ranges once committed, with the shares counted by hand', () => {
    const text = comparison(render(COMMITTED)).text();
    expect(text).toBe(explainHitShares(topPairOrBetterShare(HERO, BOARD), topPairOrBetterShare(VILLAIN, BOARD), 'your range', 'their range'));
    expect(text).toBe(
      'On this board 60.0% of your range is top pair or better, against 42.9% of their range: the board hits your range harder, by 17.1 points, so that side has more strong hands to bet for value.',
    );
  });
});
