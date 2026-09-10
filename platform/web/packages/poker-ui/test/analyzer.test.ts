// @vitest-environment happy-dom
/**
 * The two components the 9-step analyzer is built on (spec §15).
 *
 * The rule under test throughout: the gate must not show, hint at, or accept the answer before
 * the user has committed one. Everything else about the analyzer can be rebuilt; that cannot.
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PredictionGate from '../src/components/PredictionGate.vue';
import StepperNav from '../src/components/StepperNav.vue';
import { explainPrediction, scorePrediction } from '../src/prediction';

const STEPS = [
  { step: 1, title: 'Assign preflop ranges' },
  { step: 2, title: 'Subtract' },
  { step: 3, title: 'Bucket both ranges' },
];

function gate(props: Record<string, unknown> = {}) {
  return mount(PredictionGate, {
    props: { question: 'How often does the pool fold here?', answerType: 'percent', tolerance: 5, ...props },
  });
}

describe('PredictionGate', () => {
  it('asks the question and shows nothing else until an answer is committed', async () => {
    const wrapper = gate({ actual: '62' });

    expect(wrapper.find('[data-testid="gate-question"]').text()).toContain('How often');
    expect(wrapper.text()).not.toContain('62');
    expect(wrapper.find('[data-testid="gate-verdict"]').exists()).toBe(false);
    expect(wrapper.find<HTMLButtonElement>('[data-testid="gate-commit"]').element.disabled).toBe(true);
  });

  it('emits the answer on commit and never a second one', async () => {
    const wrapper = gate();
    await wrapper.find('[data-testid="gate-input"]').setValue('55');
    await wrapper.find('[data-testid="gate-commit"]').trigger('click');

    expect(wrapper.emitted('submit')).toEqual([['55']]);

    // Once the parent has stored the answer the gate is closed: no input, no second commit.
    await wrapper.setProps({ committed: '55' });
    expect(wrapper.find('[data-testid="gate-input"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="gate-answer"]').text()).toContain('55');
  });

  it('reveals the comparison only when the truth arrives, and says how far off it was', async () => {
    const wrapper = gate({ committed: '55' });
    expect(wrapper.find('[data-testid="gate-waiting"]').exists()).toBe(true);

    await wrapper.setProps({ actual: '62' });
    const verdict = wrapper.find('[data-testid="gate-verdict"]');
    expect(verdict.text()).toBe('You said 55%, it is 62% — 7.0 points too low.');
    expect(wrapper.emitted('reveal')).toHaveLength(1);
    expect(wrapper.emitted('reveal')![0]![0]).toMatchObject({ error: -7, withinTolerance: false });
  });

  it('counts an answer inside the tolerance as right', async () => {
    const wrapper = gate({ committed: '60', actual: '62' });
    expect(wrapper.find('[data-testid="gate-verdict"]').text()).toContain('close enough');
  });

  it('commits a choice with one click', async () => {
    const wrapper = gate({ answerType: 'choice', choices: ['bet', 'check'], question: 'Bet or check?' });
    await wrapper.find('[data-testid="gate-choice-bet"]').trigger('click');
    expect(wrapper.emitted('submit')).toEqual([['bet']]);
  });
});

describe('scorePrediction', () => {
  it('scores words by matching and numbers by distance', () => {
    expect(scorePrediction('bet', 'Bet', 'choice')).toMatchObject({ error: null, withinTolerance: true });
    expect(scorePrediction('bet', 'check', 'choice').withinTolerance).toBe(false);
    expect(scorePrediction('12', '9', 'number', 3)).toMatchObject({ error: 3, withinTolerance: true });
  });

  it('treats an answer that is not a number as wrong rather than throwing', () => {
    expect(scorePrediction('about half', '50', 'percent', 5)).toMatchObject({ error: null, withinTolerance: false });
  });

  it('names the unit of a plain number', () => {
    const outcome = scorePrediction('9', '6', 'number', 2);
    expect(explainPrediction(outcome, 'number', 'combos')).toBe('You said 9 combos, it is 6 combos — 3.0 combos too high.');
  });
});

describe('StepperNav', () => {
  it('marks what is done, shows where you are, and counts the progress', () => {
    const wrapper = mount(StepperNav, { props: { steps: STEPS, current: 2, completed: [1] } });

    expect(wrapper.find('[data-testid="stepper-1"]').text()).toContain('✓');
    expect(wrapper.find('[data-testid="stepper-2"]').attributes('aria-current')).toBe('step');
    expect(wrapper.find('[data-testid="stepper-progress"]').text()).toBe('1 of 3 committed');
  });

  it('navigates by click, by arrow key and by digit — and never off the ends', async () => {
    const wrapper = mount(StepperNav, { props: { steps: STEPS, current: 1, completed: [] } });

    await wrapper.find('[data-testid="stepper-3"]').trigger('click');
    await wrapper.find('[data-testid="stepper"]').trigger('keydown', { key: 'ArrowRight' });
    await wrapper.find('[data-testid="stepper"]').trigger('keydown', { key: 'ArrowLeft' });
    await wrapper.find('[data-testid="stepper"]').trigger('keydown', { key: '9' });

    // From step 1: click 3, right → 2, left → nowhere (already first), 9 → no such step.
    expect(wrapper.emitted('navigate')).toEqual([[3], [2]]);
  });
});
