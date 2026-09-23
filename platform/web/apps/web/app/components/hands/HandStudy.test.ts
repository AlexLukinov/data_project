// @vitest-environment happy-dom
/**
 * The replayer's two F.12a fixes where they are wired (ADR-053): "Compare here" carries the whole
 * situation, and the pot-odds panels take the reader's numbers and give the hand's back.
 *
 * Then F.12c's half: every question this component asks can come back refused, and none of those
 * refusals may reach the screen as "there is nothing here".
 */
import type { HandState, NodeKey } from '@poker/core';
import { COMBO_COUNT, comboIndex, nodeKey, nodeKeyEquals, parseCard, parseRange, step } from '@poker/core';
import { ComboDistributionPanel, EquityCalculator, HandReplayer, MDFPanel, RangeMatrix } from '@poker/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import type * as PoolApiModule from '~/pool/api';
import type { StoredRange } from '~/ranges/api';
import { situationFromQuery } from '~/ranges/situation';

import { GG_HAND } from '../../../../../packages/poker-core/test/fixtures/hand';
import HandStudy from './HandStudy.vue';
import PoolBlockers from './PoolBlockers.vue';
import RangeReveal from './RangeReveal.vue';

/** The four services the component asks, mutable per test: every one of them can refuse. */
const library = vi.hoisted(() => ({ lookup: vi.fn(), status: 'ready', error: null as string | null }));
const pool = vi.hoisted(() => ({ frequencies: vi.fn(), realization: vi.fn(), showdownRange: vi.fn(), estimatedRange: vi.fn() }));
const poolStats = vi.hoisted(() => ({ cohorts: vi.fn(), presets: vi.fn() }));
const analyses = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('~/stores/ranges', () => ({ useRangesStore: () => library }));
// The key helpers stay real: `hands/reveal.ts` builds `group:` keys with them.
vi.mock('~/pool/api', async (importOriginal) => ({ ...(await importOriginal<typeof PoolApiModule>()), createPoolApi: () => pool }));
vi.mock('~/pool/stats', () => ({ createPoolStatsApi: () => poolStats }));
vi.mock('~/analyze/api', () => ({ createAnalysesApi: () => analyses }));

/** ClickHouse's "Too many simultaneous queries" as the browser meets it since plan H.0: `stats/tenancy.py`'s 429. */
function refusedUnderLoad(): Error {
  return Object.assign(new Error('FetchError'), {
    name: 'FetchError',
    status: 429,
    data: { detail: 'The account is already running as many queries at once as it may; ask again in a moment.' },
  });
}

const NODE: NodeKey = nodeKey('BB', {
  villain_position: 'CO',
  street: 'flop',
  stake: 'NL10',
  action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call'), step('CO', 'bet', { size_pct: 0.33 })],
});

/** CO's own bet on the flop — a step somebody (BB) has to answer, which is what the blocker table needs. */
const BET_NODE: NodeKey = nodeKey('CO', {
  villain_position: 'BB',
  street: 'flop',
  stake: 'NL10',
  action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call'), step('CO', 'bet', { size_pct: 0.33 })],
});

/** A chart of mine at this node, so the panels that need one mount at all. */
function storedRange(name = 'BB defence vs CO'): StoredRange {
  return {
    id: 'r1',
    name,
    node_key: NODE,
    source: 'own',
    source_tool: '',
    format: 'combo',
    tags: [],
    version: 1,
    created_at: '2026-09-21T00:00:00',
    updated_at: '2026-09-21T00:00:00',
    weights: 'AA,KK,AKs,QQ',
    note: '',
  };
}

/** A `NuxtLink` that keeps its `to`, so the test can read the query the page built. */
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup: (props, { slots }) => () => h('a', { 'data-to': JSON.stringify(props.to) }, slots.default?.()),
});

function at(pot: number, toCall: number, extra: Partial<HandState> = {}): HandState {
  return { index: 7, street: 'flop', board: ['Kh', '7d', '2c'], pot, actor: 0, toAct: 0, toCall, ...extra } as unknown as HandState;
}

/**
 * The two steps of `GG_HAND` the defending set turns on (ADR-068).
 *
 * At state 10 the flop bet has been made by the small blind and the button is the seat to act:
 * `nodeKeyAt(hand, 10)` is the SB's bet, `villainStep` lands on the button's own last node, and
 * those two agree — so the button's chart is the range that faces the bet. At state 7 the small
 * blind has 3-bet, the big blind is the seat to act, and the other seat's last node is the
 * *button's* open: a third player's range, which must never be presented as the defender's.
 */
const DEFENDER_KNOWN = { index: 10, toAct: 1, actor: 1 } as const;
const DEFENDER_IS_A_THIRD_SEAT = { index: 7, toAct: 3, actor: 3 } as const;

/** One chart per seat, named after it, so a test can say *whose* range a panel was handed. */
function chartPerSeat(): void {
  library.lookup.mockImplementation((key: NodeKey) => Promise.resolve([storedRange(`chart for ${key.hero_position}`)]));
}

/** Villain's per-combo equities, distinct enough that the defending set is a real subset. */
const VILLAIN_EQUITIES = new Float32Array(COMBO_COUNT).fill(Number.NaN);
for (const [combo, equity] of [
  ['AsAh', 0.9],
  ['KsKh', 0.6],
  ['QsQh', 0.3],
] as const) {
  VILLAIN_EQUITIES[comboIndex(parseCard(combo.slice(0, 2)), parseCard(combo.slice(2)))] = equity;
}

/** What the calculator beside the panels emits; only the two per-combo arrays matter here. */
function equityResult(): Record<string, unknown> {
  return {
    heroEquity: 0.55,
    exact: true,
    perComboEquity: new Float32Array(COMBO_COUNT).fill(Number.NaN),
    perComboEquityVillain: VILLAIN_EQUITIES,
  };
}

async function study() {
  const wrapper = mount(HandStudy, {
    props: { hand: GG_HAND },
    global: { components: { NuxtLink }, stubs: { HandReplayer: true, EquityCalculator: true, ComboDistributionPanel: true, RangeMatrix: true, RangeDiffView: true } },
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

  /*
   * Audit §2.1's "controls that render editable and do nothing", the last live one on this screen
   * (plan F.12). The panel was mounted with a literal `:group-by="['made', 'draw']"` and neither
   * listener, so ticking an axis emitted into nothing — the checkbox stayed as it was, the tree
   * went on grouping the old way — and Export CSV did nothing whatsoever.
   */
  it('lets the distribution panel change its own axes, and hands its export back', async () => {
    library.lookup.mockResolvedValue([storedRange()]);
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));

    const panel = wrapper.findComponent(ComboDistributionPanel);
    expect(panel.exists()).toBe(true);
    expect(panel.props('groupBy')).toEqual(['made', 'draw']);

    panel.vm.$emit('update:groupBy', ['made', 'draw', 'strategic']);
    await flushPromises();
    expect(wrapper.findComponent(ComboDistributionPanel).props('groupBy')).toEqual(['made', 'draw', 'strategic']);

    expect(has(wrapper, 'study-dist-export')).toBe(false);
    panel.vm.$emit('export', 'group,combos\nTop pair,12');
    await flushPromises();
    expect(said(wrapper, 'study-dist-export')).toContain('Top pair,12');
  });

  it('gives the distribution the equities the calculator beside it already worked out', async () => {
    library.lookup.mockResolvedValue([storedRange()]);
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));
    // Null until the calculator answers — but bound, which is what the `equity` and `nut` axes need.
    expect(wrapper.findComponent(ComboDistributionPanel).props('equities')).toBeNull();
  });

  it('drops an export taken at the previous step rather than showing it under the next one', async () => {
    library.lookup.mockResolvedValue([storedRange()]);
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));
    wrapper.findComponent(ComboDistributionPanel).vm.$emit('export', 'group,combos\nTop pair,12');
    await flushPromises();
    expect(has(wrapper, 'study-dist-export')).toBe(true);

    await reach(wrapper, NODE, at(21, 8));
    expect(has(wrapper, 'study-dist-export')).toBe(false);
  });

  /*
   * ADR-068. MDF is the obligation of the seat that faces the bet, and on this screen that is
   * never the seat `mine` describes: `toCall` belongs to the next action, while `nodeKeyAt` ends
   * its sequence with the action just taken. The panel used to be handed `mine` — the bettor —
   * with no equities at all, so "the defending set appears when the equities have been computed"
   * was permanent and `mdf-show` could not exist.
   */
  it('hands the defending seat its own chart and its own equities, never the bettor’s', async () => {
    chartPerSeat();
    const wrapper = await study();
    await reach(wrapper, NODE, at(19.5, 7, DEFENDER_KNOWN));

    const panel = wrapper.findComponent(MDFPanel);
    // The bettor at this step is SB and the defender BTN; the panel must hold the second.
    expect(panel.props('range')?.label).toBe('chart for BTN');
    expect(wrapper.find('[data-testid="study-my-range"]').text()).toBe('chart for SB');
    expect(said(wrapper, 'study-mdf-whose')).toContain('What BTN has to defend against it');
    expect(has(wrapper, 'study-mdf-no-chart')).toBe(false);

    wrapper.findComponent(EquityCalculator).vm.$emit('result', equityResult());
    await flushPromises();
    expect(wrapper.findComponent(MDFPanel).props('equities')).toBe(VILLAIN_EQUITIES);
    expect(has(wrapper, 'mdf-show')).toBe(true);
  });

  it('refuses the defending set, and says which chart it would need, when a third seat is the one to act', async () => {
    chartPerSeat();
    const wrapper = await study();
    await reach(wrapper, NODE, at(8, 5.5, DEFENDER_IS_A_THIRD_SEAT));

    const panel = wrapper.findComponent(MDFPanel);
    expect(panel.props('range')).toBeNull();
    expect(panel.props('equities')).toBeNull();
    // The pot arithmetic is always true and stays on screen; only the named combos go.
    expect(has(wrapper, 'mdf-value')).toBe(true);
    expect(has(wrapper, 'mdf-show')).toBe(false);
    expect(said(wrapper, 'study-mdf-no-chart')).toContain('needs your chart for BB here');
  });

  it('rings the defending set on the defender’s own matrix, and drops it at the next step', async () => {
    chartPerSeat();
    const wrapper = await study();
    await reach(wrapper, NODE, at(19.5, 7, DEFENDER_KNOWN));
    wrapper.findComponent(EquityCalculator).vm.$emit('result', equityResult());
    await flushPromises();

    expect(has(wrapper, 'study-defend-matrix')).toBe(false);
    await wrapper.find('[data-testid="mdf-show"]').trigger('click');
    await flushPromises();
    expect(said(wrapper, 'study-defend-matrix')).toContain('combos BTN continues with');

    await reach(wrapper, NODE, at(19.5, 7, DEFENDER_KNOWN));
    expect(has(wrapper, 'study-defend-matrix')).toBe(false);
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

/*
 * Plan H.7, the reveal half and the pool-fed blocker table. Both hang off the same node the other
 * panels rebind to, both ask the pool only on a press, and the two share one choice of group.
 */
describe('HandStudy — the pool’s ranges, on a press', () => {
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
    poolStats.cohorts.mockResolvedValue([{ id: 'c1', name: 'regs', criteria: { rules: [] }, created_at: '', updated_at: '' }]);
    poolStats.presets.mockResolvedValue({ reports: [], cohorts: [], groups: [{ key: 'all', label: 'everyone', cohorts: [] }, { key: 'fish', label: 'fish', cohorts: ['fish'] }] });
    analyses.create.mockResolvedValue({ id: 'a1' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the pool’s groups and the saved cohorts in the one chooser both panels read', async () => {
    const wrapper = await study();
    await reach(wrapper, BET_NODE, at(13, 4));
    expect(wrapper.find('[data-testid="reveal-group"]').findAll('option').map((option) => option.text())).toEqual(['nobody — the field alone', 'fish', 'regs']);
    await wrapper.find('[data-testid="reveal-group"]').setValue('group:fish');
    await flushPromises();
    expect(wrapper.findComponent(PoolBlockers).props('group')).toEqual({ key: 'group:fish', label: 'fish' });
  });

  it('mounts the reveal at the node and asks the pool for a range only when Reveal is pressed', async () => {
    pool.showdownRange.mockResolvedValue({ tier: 2, sample_size: 300, enough: true, min_n: 100, decisions_at_node: 9000, covers: 0.03, classes: { AA: 6 }, weights: {} });
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));
    expect(has(wrapper, 'study-reveal')).toBe(true);
    expect(pool.showdownRange).not.toHaveBeenCalled();

    wrapper.findComponent(RangeReveal).findComponent(RangeMatrix).vm.$emit('update:range', parseRange('AA').range);
    await flushPromises();
    await wrapper.find('[data-testid="reveal-button"]').trigger('click');
    await flushPromises();
    expect(pool.showdownRange).toHaveBeenCalledTimes(1);
    expect(pool.showdownRange).toHaveBeenCalledWith(NODE, '');
  });

  it('mounts the blocker table only at a step where a bet was just made, on the defender’s node, sharing the group', async () => {
    const wrapper = await study();
    // BET_NODE ends with CO's own bet: BB is the seat that must answer it.
    await reach(wrapper, BET_NODE, at(13, 4));
    expect(has(wrapper, 'study-blockers')).toBe(true);
    await wrapper.find('[data-testid="reveal-group"]').setValue('c1');
    await flushPromises();
    const blockers = wrapper.findComponent(PoolBlockers);
    expect(blockers.props('facing').hero_position).toBe('BB');
    expect(blockers.props('facing').action_sequence.at(-1)).toEqual(step('BB', 'fold'));
    expect(blockers.props('group')).toEqual({ key: 'c1', label: 'regs' });

    // NODE is BB's own node, whose last step is CO's bet rather than BB's: nobody is answering BB.
    await reach(wrapper, NODE, at(21, 0));
    expect(has(wrapper, 'study-blockers')).toBe(false);
  });

  it('rings the pinned blocker row on the bettor’s own grid, and drops the ring at the next step', async () => {
    library.lookup.mockResolvedValue([storedRange()]);
    const wrapper = await study();
    await reach(wrapper, BET_NODE, at(13, 4));
    const aa = comboIndex(parseCard('As'), parseCard('Ah'));
    wrapper.findComponent(PoolBlockers).vm.$emit('comboSelect', aa);
    await flushPromises();
    const grids = wrapper.findAllComponents(RangeMatrix);
    expect(grids[0]!.props('highlightCombos')).toEqual([aa]);

    await reach(wrapper, BET_NODE, at(21, 8));
    expect(wrapper.findAllComponents(RangeMatrix)[0]!.props('highlightCombos')).toBeNull();
  });
});
