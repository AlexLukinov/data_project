// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
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
