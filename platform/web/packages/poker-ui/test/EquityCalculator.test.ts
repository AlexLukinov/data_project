// @vitest-environment happy-dom
import type { EquityRequest, EquityResult } from '@poker/core';
import { computeEquity, parseCards, parseRange } from '@poker/core';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EquityCalculator from '../src/components/EquityCalculator.vue';
import type { EquityServiceLike, EquityServiceOptions } from '../src/service';

/** An in-process stand-in for the Worker service, built on poker-core alone. */
function fakeService(): EquityServiceLike & { calls: string[]; cancelled: string[] } {
  const calls: string[] = [];
  const cancelled: string[] = [];
  const controllers = new Map<string, AbortController>();
  return {
    calls,
    cancelled,
    compute(request: EquityRequest, options?: EquityServiceOptions, jobId?: string, onProgress?: (done: number, total: number) => void): Promise<EquityResult> {
      const controller = new AbortController();
      if (jobId) controllers.set(jobId, controller);
      calls.push(jobId ?? '?');
      return computeEquity(request, { ...options, signal: controller.signal, onProgress });
    },
    cancel(jobId: string): boolean {
      const c = controllers.get(jobId);
      if (!c) return false;
      cancelled.push(jobId);
      c.abort();
      return true;
    },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('EquityCalculator', () => {
  it('answers with Monte Carlo first, then the exact result, and says which', async () => {
    const service = fakeService();
    const wrapper = mount(EquityCalculator, {
      props: { ranges: [parseRange('AA,KK').range, parseRange('QQ,AKs').range], board: parseCards('Kh 7d 2c 9s'), service, fastIterations: 2000, debounceMs: 0 },
    });
    await wait(400);
    await flushPromises();
    const results = wrapper.emitted('result')!.map((e) => e[0] as EquityResult);
    expect(results.length).toBe(2);
    expect(results[0]!.exact).toBe(false);
    expect(results[1]!.exact).toBe(true);
    expect(wrapper.find('[data-testid="equity-label"]').text()).toMatch(/^exact · \d+ runouts/);
    expect(wrapper.find('[data-testid="equity-0"]').text()).toMatch(/\d+\.\d%/);
    expect(service.calls).toEqual(['fast-1', 'exact-1']);
  });

  it('cancels superseded jobs when the inputs change', async () => {
    const service = fakeService();
    const wrapper = mount(EquityCalculator, {
      props: { ranges: [parseRange('22+').range, parseRange('22+').range], board: parseCards('Kh 7d 2c'), service, fastIterations: 200_000, debounceMs: 0 },
    });
    await wait(20);
    await wrapper.setProps({ board: parseCards('Kh 7d 3c') });
    await wait(50);
    expect(service.cancelled.length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it('shows a preflop answer as Monte Carlo only', async () => {
    const service = fakeService();
    const wrapper = mount(EquityCalculator, { props: { ranges: [parseRange('AA').range, parseRange('KK').range], board: [], service, fastIterations: 2000, debounceMs: 0 } });
    await wait(300);
    await flushPromises();
    expect(wrapper.find('[data-testid="equity-label"]').text()).toMatch(/^Monte Carlo · 2,000 samples · ±/);
    expect(wrapper.emitted('result')).toHaveLength(1);
  });
});
