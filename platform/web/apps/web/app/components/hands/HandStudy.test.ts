// @vitest-environment happy-dom
/**
 * The replayer's two F.12a fixes where they are wired (ADR-053): "Compare here" carries the whole
 * situation, and the pot-odds panels take the reader's numbers and give the hand's back.
 *
 * Then F.12c's half: every question this component asks can come back refused, and none of those
 * refusals may reach the screen as "there is nothing here".
 */
import type { HandState, NodeKey } from '@poker/core';
import { nodeKey, nodeKeyEquals, step } from '@poker/core';
import { HandReplayer } from '@poker/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { situationFromQuery } from '~/ranges/situation';

import { GG_HAND } from '../../../../../packages/poker-core/test/fixtures/hand';
import HandStudy from './HandStudy.vue';

/** The three services the component asks, mutable per test: every one of them can refuse. */
const library = vi.hoisted(() => ({ lookup: vi.fn(), status: 'ready', error: null as string | null }));
const pool = vi.hoisted(() => ({ frequencies: vi.fn(), realization: vi.fn() }));
const analyses = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('~/stores/ranges', () => ({ useRangesStore: () => library }));
vi.mock('~/pool/api', () => ({ createPoolApi: () => pool }));
vi.mock('~/analyze/api', () => ({ createAnalysesApi: () => analyses }));

/** ClickHouse's "Too many simultaneous queries" as the browser meets it: the API's sanitized 500. */
function refusedUnderLoad(): Error {
  return Object.assign(new Error('FetchError'), { name: 'FetchError', status: 500, data: { detail: 'Internal server error' } });
}

const NODE: NodeKey = nodeKey('BB', {
  villain_position: 'CO',
  street: 'flop',
  stake: 'NL10',
  action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call'), step('CO', 'bet', { size_pct: 0.33 })],
});

/** A `NuxtLink` that keeps its `to`, so the test can read the query the page built. */
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup: (props, { slots }) => () => h('a', { 'data-to': JSON.stringify(props.to) }, slots.default?.()),
});

function at(pot: number, toCall: number): HandState {
  return { index: 7, street: 'flop', board: ['Kh', '7d', '2c'], pot, actor: 0, toAct: 0, toCall } as unknown as HandState;
}

async function study() {
  const wrapper = mount(HandStudy, {
    props: { hand: GG_HAND },
    global: { components: { NuxtLink }, stubs: { HandReplayer: true, EquityCalculator: true, ComboDistributionPanel: true, RangeMatrix: true } },
  });
  return wrapper;
}

async function reach(wrapper: Awaited<ReturnType<typeof study>>, node: NodeKey, state: HandState) {
  wrapper.findComponent(HandReplayer).vm.$emit('nodeChange', node, state);
  await flushPromises();
}

const oddsInput = (wrapper: Awaited<ReturnType<typeof study>>, n: number) => wrapper.find('[data-testid="study-pot-odds"]').findAll('input')[n]!;
const has = (wrapper: Awaited<ReturnType<typeof study>>, id: string) => wrapper.find(`[data-testid="${id}"]`).exists();

const said = (wrapper: Awaited<ReturnType<typeof study>>, id: string) => wrapper.find(`[data-testid="${id}"]`).text();

describe('HandStudy — the situation link and the bound panels', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('useApi', () => ({}));
    vi.stubGlobal('useEquityService', () => ({ service: { compute: vi.fn(), cancel: vi.fn() } }));
    vi.stubGlobal('navigateTo', vi.fn());
    library.lookup.mockResolvedValue([]);
    library.status = 'ready';
    library.error = null;
    pool.frequencies.mockResolvedValue(null);
    pool.realization.mockResolvedValue(null);
    analyses.create.mockResolvedValue({ id: 'a1' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('links to the compare page with the whole situation, which reads back as the same node', async () => {
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));
    const to = JSON.parse(wrapper.find('[data-testid="study-compare"]').attributes('data-to')!) as { path: string; query: Record<string, string> };
    expect(to.path).toBe('/ranges/compare');
    expect(Object.keys(to.query)).toEqual(['node']);
    const read = situationFromQuery(to.query);
    expect(read.problem).toBeNull();
    expect(nodeKeyEquals(read.key!, NODE)).toBe(true);
  });

  it("takes an edited bet, lets the call follow it, says so, and gives the hand's numbers back", async () => {
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));
    // The pot before the bet is 13 - 4 = 9; the call is the bet.
    expect([oddsInput(wrapper, 0).element.value, oddsInput(wrapper, 1).element.value]).toEqual(['9', '4']);
    expect(has(wrapper, 'study-odds-edited')).toBe(false);

    await oddsInput(wrapper, 1).setValue('9');
    await flushPromises();
    expect(wrapper.find('[data-testid="odds-explain"]').text()).toContain('Calling 9 to win 18');
    expect(has(wrapper, 'study-odds-edited')).toBe(true);

    await wrapper.find('[data-testid="study-odds-reset"]').trigger('click');
    await flushPromises();
    expect(oddsInput(wrapper, 1).element.value).toBe('4');
    expect(has(wrapper, 'study-odds-edited')).toBe(false);
  });

  it("starts the next step with different numbers on that step's numbers", async () => {
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));
    await oddsInput(wrapper, 1).setValue('9');
    await reach(wrapper, NODE, at(30, 10));
    expect([oddsInput(wrapper, 0).element.value, oddsInput(wrapper, 1).element.value]).toEqual(['20', '10']);
    expect(has(wrapper, 'study-odds-edited')).toBe(false);
  });

  it('mounts neither pot-odds panel while the blinds are still going in, and says why once', async () => {
    const wrapper = await study();
    // The big blind's post: 0.5 to call with nothing behind it. Both panels used to mount and
    // print "There is no pot to work from…" of their own accord, one under the other.
    await reach(wrapper, NODE, at(0.5, 0.5));
    expect(has(wrapper, 'study-pot-odds')).toBe(false);
    expect(said(wrapper, 'study-nothing-faced')).toContain('nothing in the pot behind this bet yet');
  });
});

describe('HandStudy — a question that came back refused', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('useApi', () => ({}));
    vi.stubGlobal('useEquityService', () => ({ service: { compute: vi.fn(), cancel: vi.fn() } }));
    vi.stubGlobal('navigateTo', vi.fn());
    library.lookup.mockResolvedValue([]);
    library.status = 'ready';
    library.error = null;
    pool.frequencies.mockResolvedValue(null);
    pool.realization.mockResolvedValue(null);
    analyses.create.mockResolvedValue({ id: 'a1' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('says the pool was not asked, rather than showing nothing, when the database refuses under load', async () => {
    pool.frequencies.mockRejectedValue(refusedUnderLoad());
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));

    const message = said(wrapper, 'study-pool-error');
    expect(message).toContain('The pool could not be asked what the field does here.');
    expect(message).toContain('only a few of them are answered at a time');
    expect(message).toContain('Stepping to this spot again asks afresh.');
  });

  it('keeps the other answer when only one of the two is refused', async () => {
    pool.realization.mockRejectedValue(refusedUnderLoad());
    pool.frequencies.mockResolvedValue({ tier: 1, sample_size: 400, enough: true, min_n: 100, actions: { fold: 200, call: 200 }, frequencies: { fold: 0.5, call: 0.5 } });
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));

    expect(has(wrapper, 'study-pool')).toBe(true);
    expect(has(wrapper, 'study-pool-error')).toBe(false);
    expect(said(wrapper, 'study-realization-error')).toContain('What the field won from this situation could not be asked.');
  });

  it('does not read a library it could not open as "nothing stored"', async () => {
    library.lookup.mockRejectedValue(new Error('the offline copy failed too'));
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));

    expect(has(wrapper, 'study-no-range')).toBe(false);
    expect(said(wrapper, 'study-range-error')).toContain('neither the API nor this browser’s offline copy answered');
  });

  it('says whose empty answer it is when the library is the browser’s own copy', async () => {
    library.status = 'offline';
    library.error = 'The API did not answer; showing the cached copy.';
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));

    const message = said(wrapper, 'study-no-range');
    expect(message).toContain('The API did not answer; showing the cached copy.');
    expect(message).toContain('This browser’s offline copy has no chart of yours for this situation.');
  });

  it('answers a failed "Analyze this node" on the page, not in the console', async () => {
    analyses.create.mockRejectedValue(refusedUnderLoad());
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));

    await wrapper.find('[data-testid="study-analyze"]').trigger('click');
    await flushPromises();
    expect(said(wrapper, 'study-analyze-error')).toContain('Press Analyze this node again to try once more.');
    expect(wrapper.find('[data-testid="study-analyze"]').attributes('disabled')).toBeUndefined();
  });
});
