// @vitest-environment happy-dom
/**
 * The advantage trainer's reveal panel (spec §16). Its equity run is the one the answer already
 * paid for — and when it throws, the panel used to leave "Working out both ranges' equities…" on
 * screen for good, which reads as a calculation still running (ADR-061).
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdvantageSpot } from '~/train/types';

import AdvantageTrainer from './AdvantageTrainer.vue';

const sides = vi.hoisted(() => vi.fn());
vi.mock('~/train/spot-advantage', () => ({ sides }));

const SPOT: AdvantageSpot = {
  mode: 'advantage',
  seed: 1,
  hash: 'advantage:1',
  label: 'BTN open vs BB call · flop Kd 9h 4h',
  questions: [],
  bucket: 'dry',
  heroText: 'AA,KK,AKs',
  villainText: 'QQ,JJ,T9s',
  heroLabel: 'BTN open',
  villainLabel: 'BB call',
  boardText: 'Kd 9h 4h',
};

const EQUITIES = {
  hero: { equities: new Float32Array(1326).fill(0.6), weights: new Float32Array(1326) },
  villain: { equities: new Float32Array(1326).fill(0.4), weights: new Float32Array(1326) },
  exact: true,
};

function render() {
  return mount(AdvantageTrainer, { props: { spot: SPOT, revealed: true }, global: { stubs: { RangeMatrix: true, RangeComparisonPanel: true } } });
}

const has = (w: ReturnType<typeof render>, id: string) => w.find(`[data-testid="${id}"]`).exists();
/** The panel is the `v-if` branch: neither the working line nor the failure is on screen. */
const comparing = (w: ReturnType<typeof render>) => !has(w, 'advantage-working') && !has(w, 'advantage-error');

describe('AdvantageTrainer — the reveal', () => {
  beforeEach(() => {
    sides.mockReset();
    vi.stubGlobal('useEquityService', () => ({ service: { compute: vi.fn(), cancel: vi.fn() } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the comparison once the equities are in', async () => {
    sides.mockResolvedValue(EQUITIES);
    const w = render();
    await flushPromises();
    expect(comparing(w)).toBe(true);
  });

  it('says the equities could not be worked out, instead of working them out for ever', async () => {
    sides.mockRejectedValue(new Error('the equity worker stopped answering'));
    const w = render();
    await flushPromises();

    expect(has(w, 'advantage-working')).toBe(false);
    const error = w.find('[data-testid="advantage-error"]');
    expect(error.attributes('role')).toBe('alert');
    expect(error.text()).toContain('could not be worked out');
    expect(error.text()).toContain('the equity worker stopped answering');
  });

  it('runs it again from the panel, and clears the failure when it answers', async () => {
    sides.mockRejectedValueOnce(new Error('once')).mockResolvedValue(EQUITIES);
    const w = render();
    await flushPromises();
    expect(has(w, 'advantage-error')).toBe(true);

    await w.find('[data-testid="advantage-retry"]').trigger('click');
    await flushPromises();
    expect(comparing(w)).toBe(true);
    expect(sides).toHaveBeenCalledTimes(2);
  });
});
