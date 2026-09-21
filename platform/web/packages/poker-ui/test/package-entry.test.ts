// @vitest-environment happy-dom
/**
 * Acceptance 12 (spec §18): a consumer that is not `apps/web` mounts `RangeMatrix` and
 * `EquityCalculator` through the package name alone, with no app-specific wiring.
 *
 * Everything under test is imported from `'@poker/ui'` — resolved through `node_modules/@poker/ui`
 * → `packages/poker-ui/package.json` "exports" — never from `../src/...`, because a relative
 * import would prove nothing about the package entry. The equity service is the one the package
 * itself ships, so nothing outside these lines is needed to make the calculator work.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { EquityResult } from '@poker/core';
import { handClassOfName, parseCards, parseRange } from '@poker/core';
import * as packageEntry from '@poker/ui';
import { EquityCalculator, RangeMatrix, createLocalEquityService, explainEquity, percent } from '@poker/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import * as localEntry from '../src/index';

const HAND_CLASSES = 169;
const VUE_EXTENSION = '.vue';
const SETTLE_TRIES = 40;
const SETTLE_STEP_MS = 100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * SFCs deliberately left out of `src/index.ts`, with the reason. Empty today: every component in
 * `src/components` is exported, and a new one that should not be has to be listed here.
 */
const NOT_EXPORTED: readonly string[] = [];

describe('@poker/ui — the package entry', () => {
  it('is this package, reached by its bare name', () => {
    expect(packageEntry).toBe(localEntry);
  });

  it('exports every component in src/components', () => {
    const components = readdirSync(join(import.meta.dirname, '../src/components'))
      .filter((file) => file.endsWith(VUE_EXTENSION))
      .map((file) => file.slice(0, -VUE_EXTENSION.length));
    expect(components.length).toBeGreaterThan(0);
    const missing = components.filter((name) => !NOT_EXPORTED.includes(name) && !(name in packageEntry));
    expect(missing).toEqual([]);
  });
});

describe('RangeMatrix from the package entry', () => {
  it('mounts and renders the 169 hand classes', () => {
    const wrapper = mount(RangeMatrix, { props: { range: parseRange('AA').range } });
    expect(wrapper.findAll('[data-cls]')).toHaveLength(HAND_CLASSES);
  });

  it('paints a stroke: pointer down on a cell, pointer up on the window, one update:range', async () => {
    const wrapper = mount(RangeMatrix, { props: { range: parseRange('AA').range, brush: 1 } });
    await wrapper.find(`[data-cls="${handClassOfName('KK')}"]`).trigger('pointerdown');
    expect(wrapper.emitted('update:range')).toBeUndefined(); // the stroke is not an edit until it ends
    window.dispatchEvent(new Event('pointerup'));
    await flushPromises();
    expect(wrapper.emitted('update:range')).toHaveLength(1);
  });

  it('reports the focused cell when Enter is pressed on the grid', async () => {
    const wrapper = mount(RangeMatrix, { props: { range: parseRange('AA').range, mode: 'view' } });
    await wrapper.find('[role="grid"]').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('cellClick')).toEqual([[handClassOfName('AA')]]);
  });
});

describe('EquityCalculator from the package entry', () => {
  it('computes with the package’s own service and nothing app-specific', async () => {
    const wrapper = mount(EquityCalculator, {
      props: {
        ranges: [parseRange('AA,KK').range, parseRange('QQ,AKs').range],
        board: parseCards('Kh 7d 2c 9s'),
        service: createLocalEquityService(),
        fastIterations: 2000,
        debounceMs: 0,
      },
    });
    for (let tries = 0; tries < SETTLE_TRIES && (wrapper.emitted('result')?.length ?? 0) < 2; tries += 1) await wait(SETTLE_STEP_MS);
    await flushPromises();

    const results = wrapper.emitted('result')!.map((event) => event[0] as EquityResult);
    const exact = results[results.length - 1]!;
    expect(exact.exact).toBe(true);
    expect(exact.equities[0]! + exact.equities[1]!).toBeCloseTo(1, 6);
    expect(wrapper.find('[data-testid="equity-0"]').text()).toBe(percent(exact.equities[0]!));
    expect(wrapper.find('[data-testid="equity-1"]').text()).toBe(percent(exact.equities[1]!));
    // Enumerated, so the numbers are the same on every machine and every run.
    expect(wrapper.find('[data-testid="equity-0"]').text()).toBe('96.9%');
    expect(wrapper.find('[data-testid="equity-1"]').text()).toBe('3.1%');

    const method = wrapper.find('[data-testid="equity-label"] .pk-term-text');
    expect(method.attributes('data-term')).toBe('exact');
    expect(method.text()).toBe('exact');
    expect(wrapper.find('[data-testid="equity-work"]').text()).toMatch(/^\d{1,3}(,\d{3})* runouts$/);
    expect(wrapper.find('[data-testid="equity-explain"]').text()).toBe(explainEquity(exact, ['Hero', 'Villain']));
    wrapper.unmount();
  });
});
