// @vitest-environment happy-dom
/**
 * Step 1's "Load my chart for this spot" (audit §2.6, §2.11): the button must never do nothing
 * silently, and a range that came from the library must say which chart it came from. And its
 * undo (audit §2.7): one history over both seats, every step of it saved as a patch.
 */
import type { NodeKey } from '@poker/core';
import { nodeKey, nodeKeyLabel, parseRange, serializeRange } from '@poker/core';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** Every step mounted by a test, unmounted after it so its window shortcuts do not outlive it. */
const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

/** The page's part: a context read through getters, and every patch applied to the step. */
function mountStep(node: NodeKey | null = KEY, ranges: RangeAssignment[] = [], libraryMissing = '') {
  const state = reactive<{ step: AnalysisStep }>({ step: { ...emptyStep(1), work: { ...emptyWork(), ranges } } });
  const ctx: StepContext = {
    get step() {
      return state.step;
    },
    steps: [],
    node,
    spot: EMPTY_SPOT,
    pool: null,
    poolFacing: null,
    libraryMissing,
    heuristic: '',
  };
  const onPatch = (patch: Partial<AnalysisStep>) => (state.step = { ...state.step, ...patch });
  const wrapper = mount(Step1Ranges, { props: { ctx, onPatch }, global: { components: { NuxtLink } } });
  mounted.push(wrapper);
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

    const failed = wrapper.find('[data-testid="step1-load-error"]');
    expect(failed.attributes('role')).toBe('alert');
    expect(failed.text()).toContain('could not be read');
    // Why, and the way to ask again — not a bare "no chart" (ADR-057 decision 8, ADR-061).
    expect(failed.text()).toContain('IndexedDB is unavailable');
    expect(failed.text()).toContain('Press the button again');
    expect(has(wrapper, 'step1-none')).toBe(false);
    expect(button(wrapper).element.disabled).toBe(false);
    expect(state.step.work.ranges).toEqual([]);
  });

  it('does not offer the button at all when the analysis has no library behind it', () => {
    const { wrapper } = mountStep();
    expect(has(wrapper, 'step1-load')).toBe(true);

    const noLibrary = mountStep(KEY, [], 'An example has no range library behind it.');
    expect(has(noLibrary.wrapper, 'step1-load')).toBe(false);
    expect(noLibrary.wrapper.find('[data-testid="step1-no-library"]').text()).toBe('An example has no range library behind it.');
  });

  it('says no chart of yours is stored for this situation, and links to the import', async () => {
    library.lookup.mockResolvedValue([]);
    const { wrapper, state } = mountStep();

    await button(wrapper).trigger('click');
    await flushPromises();

    const none = wrapper.find('[data-testid="step1-none"]');
    // The situation is a `NodeLabel`, so its own tooltip text sits inside this paragraph too.
    expect(none.text()).toContain('No chart of yours is stored for');
    expect(none.get('.pk-term-text').text()).toBe(nodeKeyLabel(KEY));
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

/** The combo text a painted class is stored as. */
const comboText = (classes: string) => serializeRange(parseRange(classes).range, 'combo');
const AA = 0;
const KK = 14;
const QQ = 28;

/** A stroke over one cell of seat `seat`'s matrix (0 = hero): down on it, up anywhere on the page. */
async function paint(wrapper: ReturnType<typeof mount>, cls: number, seat = 0): Promise<void> {
  await wrapper.findAll('[role="grid"]')[seat]!.find(`[data-cls="${cls}"]`).trigger('pointerdown');
  window.dispatchEvent(new Event('pointerup'));
  await flushPromises();
}

async function press(key: string, mods: KeyboardEventInit = {}): Promise<void> {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
  await flushPromises();
}

const undoButton = (w: ReturnType<typeof mount>) => w.find<HTMLButtonElement>('[data-testid="step1-undo"]');
const redoButton = (w: ReturnType<typeof mount>) => w.find<HTMLButtonElement>('[data-testid="step1-redo"]');

describe('Step1Ranges — undo and redo across both seats', () => {
  beforeEach(() => {
    library.lookup.mockReset();
    library.status = 'idle';
  });

  it('has nothing to undo or redo before an edit, and a shortcut then patches nothing', async () => {
    const { wrapper, state } = mountStep();
    const before = state.step;
    expect(undoButton(wrapper).element.disabled).toBe(true);
    expect(redoButton(wrapper).element.disabled).toBe(true);
    await press('z', { metaKey: true });
    expect(state.step).toBe(before);
  });

  it('starts the history again when the step changes from outside to different ranges', async () => {
    const { wrapper, state } = mountStep();
    await paint(wrapper, AA);

    state.step = { ...state.step, work: { ...state.step.work, ranges: [{ position: 'CO', weights: AK_SUITED, label: '' }] } };
    await flushPromises();

    expect(undoButton(wrapper).element.disabled).toBe(true);
    await press('z', { metaKey: true });
    expect(state.step.work.ranges).toEqual([{ position: 'CO', weights: AK_SUITED, label: '' }]);
  });

  it('keeps the history when the same ranges come back in another order, as a save may send them', async () => {
    const { wrapper, state } = mountStep();
    await paint(wrapper, AA, 0);
    await paint(wrapper, KK, 1);

    state.step = { ...state.step, work: { ...state.step.work, ranges: [...state.step.work.ranges].reverse().map((r) => ({ ...r })) } };
    await flushPromises();

    await undoButton(wrapper).trigger('click');
    expect(state.step.work.ranges).toEqual([{ position: 'BB', weights: comboText('AA'), label: '' }]);
  });

  it('undoes a stroke as a patch of the ranges and redoes it, from the buttons and from the keys', async () => {
    const { wrapper, state } = mountStep();
    await paint(wrapper, AA);
    expect(state.step.work.ranges).toEqual([{ position: 'BB', weights: comboText('AA'), label: '' }]);

    await undoButton(wrapper).trigger('click');
    expect(state.step.work.ranges).toEqual([]);
    await redoButton(wrapper).trigger('click');
    expect(state.step.work.ranges).toEqual([{ position: 'BB', weights: comboText('AA'), label: '' }]);

    await press('z', { ctrlKey: true });
    expect(state.step.work.ranges).toEqual([]);
    await press('z', { metaKey: true, shiftKey: true });
    expect(state.step.work.ranges).toEqual([{ position: 'BB', weights: comboText('AA'), label: '' }]);
    expect(undoButton(wrapper).attributes('title')).toBe('⌘Z');
    expect(redoButton(wrapper).attributes('title')).toBe('⌘⇧Z');
  });

  it('walks back across both seats, and a new edit after an undo clears the redo', async () => {
    const { wrapper, state } = mountStep();
    await paint(wrapper, AA, 0);
    await paint(wrapper, KK, 1);

    await undoButton(wrapper).trigger('click');
    expect(state.step.work.ranges).toEqual([{ position: 'BB', weights: comboText('AA'), label: '' }]);
    await paint(wrapper, QQ, 0);

    expect(redoButton(wrapper).element.disabled).toBe(true);
    expect(state.step.work.ranges).toEqual([{ position: 'BB', weights: comboText('AA,QQ'), label: '' }]);
  });

  it('takes back a loaded chart in one undo, name and all', async () => {
    library.lookup.mockResolvedValue([stored()]);
    const { wrapper, state } = mountStep(KEY, [{ position: 'CO', weights: AK_SUITED, label: '' }]);

    await button(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="seat-source-BB"]').exists()).toBe(true);

    await undoButton(wrapper).trigger('click');
    expect(state.step.work.ranges).toEqual([{ position: 'CO', weights: AK_SUITED, label: '' }]);
    expect(wrapper.find('[data-testid="seat-source-BB"]').exists()).toBe(false);
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
