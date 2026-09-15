// @vitest-environment happy-dom
import type { EquityRequest, EquityResult } from '@poker/core';
import { computeEquity, parseCards, parseRange } from '@poker/core';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

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
    const method = wrapper.find('[data-testid="equity-label"] .pk-term-text');
    expect(method.attributes('data-term')).toBe('exact');
    expect(method.text()).toBe('exact');
    expect(wrapper.find('[data-testid="equity-work"]').text()).toMatch(/^\d{1,3}(,\d{3})* runouts$/);
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

  it('does not recompute when a parent re-render passes the same inputs in a new array', async () => {
    const service = fakeService();
    const hero = parseRange('AA,KK').range;
    const villain = parseRange('QQ,AKs').range;
    const board = parseCards('Kh 7d 2c 9s');
    const wrapper = mount(EquityCalculator, { props: { ranges: [hero, villain], board, service, fastIterations: 2000, debounceMs: 0 } });
    await wait(400);
    await flushPromises();
    expect(service.calls).toEqual(['fast-1', 'exact-1']);
    // A result arriving re-renders the parent, which hands over fresh arrays of the same ranges.
    await wrapper.setProps({ ranges: [hero, villain], board: [...board] });
    await wait(100);
    await flushPromises();
    expect(service.calls).toEqual(['fast-1', 'exact-1']);
    expect(service.cancelled).toEqual([]);
    expect(wrapper.emitted('result')).toHaveLength(2);
    // A real change does recompute.
    await wrapper.setProps({ ranges: [hero, parseRange('QQ').range] });
    await wait(400);
    await flushPromises();
    expect(service.calls).toEqual(['fast-1', 'exact-1', 'fast-2', 'exact-2']);
  });

  it('writes an exact count of a thousand runouts or more with a comma on a ru-RU machine', async () => {
    const toLocaleString = Number.prototype.toLocaleString;
    const onRussianMachine = vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (this: number, locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
      return toLocaleString.call(this, locales ?? 'ru-RU', options);
    });
    try {
      const service = fakeService();
      // On a flop the exact pass enumerates turn and river: 1,176 runouts for these ranges.
      const wrapper = mount(EquityCalculator, { props: { ranges: [parseRange('AA,KK').range, parseRange('QQ,AKs').range], board: parseCards('Kh 7d 2c'), service, fastIterations: 2000, debounceMs: 0 } });
      const work = () => wrapper.find('[data-testid="equity-work"]');
      for (let tries = 0; tries < 40 && !(work().exists() && work().text().includes('runouts')); tries += 1) await wait(100);
      await flushPromises();
      expect(work().text()).toBe('1,176 runouts');
    } finally {
      onRussianMachine.mockRestore();
    }
  });

  it('shows a preflop answer as Monte Carlo only, its count written with a comma on any machine', async () => {
    // The founder's Mac is ru_RU, where a bare toLocaleString() prints "2 000".
    const toLocaleString = Number.prototype.toLocaleString;
    const onRussianMachine = vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (this: number, locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
      return toLocaleString.call(this, locales ?? 'ru-RU', options);
    });
    try {
      const service = fakeService();
      const wrapper = mount(EquityCalculator, { props: { ranges: [parseRange('AA').range, parseRange('KK').range], board: [], service, fastIterations: 2000, debounceMs: 0 } });
      await wait(300);
      await flushPromises();
      const method = wrapper.find('[data-testid="equity-label"] .pk-term-text');
      expect(method.attributes('data-term')).toBe('monteCarlo');
      expect(method.text()).toBe('Monte Carlo');
      expect(wrapper.find('[data-testid="equity-work"]').text()).toMatch(/^2,000 samples · ±\d+\.\d{2} pp$/);
      expect(wrapper.emitted('result')).toHaveLength(1);
    } finally {
      onRussianMachine.mockRestore();
    }
  });
});
