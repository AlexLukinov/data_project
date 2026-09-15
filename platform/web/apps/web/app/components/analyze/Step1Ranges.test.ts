// @vitest-environment happy-dom
/**
 * Step 1's "Load my chart for this spot" (audit §2.6, §2.11): the button must never do nothing
 * silently, and a range that came from the library must say which chart it came from.
 */
import type { NodeKey } from '@poker/core';
import { nodeKey, nodeKeyLabel } from '@poker/core';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';

import type { AnalysisStep, RangeAssignment } from '~/analyze/api';
import { emptyStep, emptyWork } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { EMPTY_SPOT } from '~/analyze/spot';
import type { StoredRange } from '~/ranges/api';

import SeatRange from './SeatRange.vue';
import Step1Ranges from './Step1Ranges.vue';

const library = vi.hoisted(() => ({ lookup: vi.fn(), status: 'idle', error: null as string | null }));
vi.mock('~/stores/ranges', () => ({ useRangesStore: () => library }));

const KEY = nodeKey('BB', { villain_position: 'CO', street: 'preflop' });
const CHART_NAME = 'BB defend vs CO';
const AK_SUITED = 'AsKs: 1,AhKh: 1';

/** A `NuxtLink` for a test with no Nuxt: an anchor that keeps the target. */
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()),
});

function stored(over: Partial<StoredRange> = {}): StoredRange {
  return {
    id: 'r1',
    name: CHART_NAME,
    node_key: KEY,
    source: 'own',
    source_tool: '',
    format: 'combo',
    tags: [],
    version: 3,
    created_at: '2026-09-14T12:00:00Z',
    updated_at: '2026-09-14T12:00:00Z',
    weights: AK_SUITED,
    note: '',
    ...over,
  };
}

/** The page's part: a context read through getters, and every patch applied to the step. */
function mountStep(node: NodeKey | null = KEY, ranges: RangeAssignment[] = []) {
  const state = reactive<{ step: AnalysisStep }>({ step: { ...emptyStep(1), work: { ...emptyWork(), ranges } } });
  const ctx: StepContext = {
    get step() {
      return state.step;
    },
    steps: [],
    node,
    spot: EMPTY_SPOT,
    hand: null,
    pool: null,
    poolFacing: null,
    heuristic: '',
  };
  const onPatch = (patch: Partial<AnalysisStep>) => (state.step = { ...state.step, ...patch });
  const wrapper = mount(Step1Ranges, { props: { ctx, onPatch }, global: { components: { NuxtLink } } });
  return { wrapper, state };
}

const has = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-testid="${id}"]`).exists();
const button = (w: ReturnType<typeof mount>) => w.find<HTMLButtonElement>('[data-testid="step1-load"]');

describe('Step1Ranges — loading my chart', () => {
  // A block body: a function returned from beforeEach runs as its cleanup, and the mock is a function.
  beforeEach(() => {
    library.lookup.mockReset();
    library.status = 'idle';
    library.error = null;
  });

  it('says the API did not answer, not that no chart is stored, when only the offline copy was searched', async () => {
    // The real store never rejects for a stopped API: it answers from the cache and marks itself offline.
    library.lookup.mockImplementation(async () => {
      library.status = 'offline';
      library.error = 'The API did not answer; showing the cached copy.';
      return [];
    });
    const { wrapper } = mountStep();

    await button(wrapper).trigger('click');
    await flushPromises();

    const offline = wrapper.find('[data-testid="step1-offline"]');
    expect(offline.attributes('role')).toBe('alert');
    expect(offline.text()).toContain('The API did not answer');
    expect(offline.text()).toContain(`no chart of yours for ${nodeKeyLabel(KEY)}`);
    expect(has(wrapper, 'step1-none')).toBe(false);
  });

  it('says the library could not be read when the lookup fails, and lets the reader try again', async () => {
    library.lookup.mockRejectedValue(new Error('IndexedDB is unavailable'));
    const { wrapper, state } = mountStep();

    await button(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="step1-load-error"]').attributes('role')).toBe('alert');
    expect(wrapper.find('[data-testid="step1-load-error"]').text()).toContain('could not be read');
    expect(has(wrapper, 'step1-none')).toBe(false);
    expect(button(wrapper).element.disabled).toBe(false);
    expect(state.step.work.ranges).toEqual([]);
  });

  it('says no chart of yours is stored for this situation, and links to the import', async () => {
    library.lookup.mockResolvedValue([]);
    const { wrapper, state } = mountStep();

    await button(wrapper).trigger('click');
    await flushPromises();

    const none = wrapper.find('[data-testid="step1-none"]');
    expect(none.text()).toContain(`No chart of yours is stored for ${nodeKeyLabel(KEY)}.`);
    expect(none.find('a').attributes('href')).toBe('/ranges/import');
    expect(has(wrapper, 'step1-load-error')).toBe(false);
    expect(state.step.work.ranges).toEqual([]);
  });

  it('does not load a solver range as my chart, and says no chart of mine is stored', async () => {
    library.lookup.mockResolvedValue([stored({ id: 'gtow', name: 'GTOW BB vs CO', source: 'solver' })]);
    const { wrapper, state } = mountStep();

    await button(wrapper).trigger('click');
    await flushPromises();

    expect(state.step.work.ranges).toEqual([]);
    expect(has(wrapper, 'seat-source-BB')).toBe(false);
    expect(wrapper.find('[data-testid="step1-none"]').text()).toContain('No chart of yours is stored');
  });

  it('disables the button and says it is looking while the lookup runs', async () => {
    let answer: (found: StoredRange[]) => void = () => undefined;
    library.lookup.mockReturnValue(new Promise<StoredRange[]>((resolve) => (answer = resolve)));
    const { wrapper } = mountStep();

    await button(wrapper).trigger('click');
    expect(button(wrapper).element.disabled).toBe(true);
    expect(has(wrapper, 'step1-loading')).toBe(true);

    answer([stored()]);
    await flushPromises();
    expect(has(wrapper, 'step1-loading')).toBe(false);
    expect(button(wrapper).element.disabled).toBe(false);
  });

  it('cannot be pressed when the analysis has no situation to look up', () => {
    const { wrapper } = mountStep(null);
    expect(button(wrapper).element.disabled).toBe(true);
  });

  it('stores the chart name as the label and names the chart beside the seat', async () => {
    library.lookup.mockResolvedValue([stored(), stored({ id: 'r2', name: 'an older one' })]);
    const { wrapper, state } = mountStep();

    await button(wrapper).trigger('click');
    await flushPromises();

    expect(library.lookup).toHaveBeenCalledWith(KEY);
    expect(state.step.work.ranges).toEqual([{ position: 'BB', weights: AK_SUITED, label: CHART_NAME }]);
    expect(wrapper.find('[data-testid="seat-source-BB"]').text()).toBe(`started from your chart “${CHART_NAME}”`);
    expect(has(wrapper, 'seat-source-CO')).toBe(false);
    expect(has(wrapper, 'step1-none') || has(wrapper, 'step1-loading') || has(wrapper, 'step1-load-error')).toBe(false);
  });

  it('keeps naming the chart after the loaded range is repainted', async () => {
    const { wrapper, state } = mountStep(KEY, [{ position: 'BB', weights: AK_SUITED, label: CHART_NAME }]);

    wrapper.findAllComponents(SeatRange)[0]!.vm.$emit('update:weights', 'AsKs: 1');
    await flushPromises();

    expect(state.step.work.ranges).toEqual([{ position: 'BB', weights: 'AsKs: 1', label: CHART_NAME }]);
    expect(wrapper.find('[data-testid="seat-source-BB"]').text()).toContain(CHART_NAME);
  });
});

describe('SeatRange — where the range came from', () => {
  it('says nothing about a source for a range painted here', () => {
    const wrapper = mount(SeatRange, { props: { label: 'BB', weights: AK_SUITED } });
    expect(has(wrapper, 'seat-source-BB')).toBe(false);
  });

  it('names the chart the range was loaded from', () => {
    const wrapper = mount(SeatRange, { props: { label: 'BB', weights: AK_SUITED, source: CHART_NAME } });
    expect(wrapper.find('[data-testid="seat-source-BB"]').text()).toBe(`started from your chart “${CHART_NAME}”`);
  });
});
