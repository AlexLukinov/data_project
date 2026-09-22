// @vitest-environment happy-dom
/**
 * The player lookup, on the route built for it (plan F.14, ADR-062).
 *
 * What is worth asserting here is what the page *stopped* doing. It used to assemble the search
 * itself — a `like '%…%'` over `player_key`, a list of seven stat codes, a cap it named — and every
 * one of those was a second copy of something the server decides. So these tests pin the seams: the
 * typed name goes to the route and nothing else is sent with it; how many matched and how short a
 * name is refused are read back rather than computed; and the stats a chosen player is read by are
 * the ones the answer arrived with.
 *
 * The 400 is the case that matters most. The minimum was measured on the real pool (three
 * characters: the worst three-character fragment is inside 2,259 of 94,276 names), the server
 * checks it against the *name half* of a key, and the page holds no copy of it at all — so a
 * refusal has to arrive from the server and reach the screen in the server's own words.
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense, defineComponent, h, ref } from 'vue';

import type * as PoolStatsModule from '~/pool/stats';
import type { PlayerMatches } from '~/pool/stats';
import type { ReportResult, StatMeta } from '~/stats/api';

import PlayersPage from './players.vue';

const pool = vi.hoisted(() => ({ findPlayers: vi.fn(), run: vi.fn() }));
vi.mock('~/pool/stats', async (importOriginal) => ({
  ...(await importOriginal<typeof PoolStatsModule>()),
  createPoolStatsApi: () => pool,
}));

const registry = vi.hoisted(() => ({ stats: [] as unknown[], byCode: new Map<string, unknown>(), status: 'ready', error: '', load: vi.fn() }));
vi.mock('~/stores/definitions', () => ({ useDefinitionsStore: () => registry }));

const NuxtLink = defineComponent({ props: { to: { type: String, required: true } }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) });

/** The seven `StatMeta`s the route sends back with every answer — two is enough to read them. */
const SHOWN: StatMeta[] = [
  { code: 'hands', label: 'Hands', format: 'count', grain: 'hand', description: '' },
  { code: 'vpip', label: 'VPIP', format: 'percent', grain: 'hand', description: '' },
];

function matches(names: readonly string[], over: Partial<PlayerMatches> = {}): PlayerMatches {
  return {
    hands: 1000,
    group_by: ['player_key'],
    stats: SHOWN,
    rows: names.map((name) => ({ group: { player_key: name }, hands: 500, cells: {} })),
    cached: false,
    matched: names.length,
    matched_capped: false,
    ...over,
  };
}

/** One player's own report, told apart by its hand count. */
function report(hands: number): ReportResult {
  return { hands, group_by: [], stats: SHOWN, rows: [{ group: {}, hands, cells: {} }], cached: false };
}

/** What the API layer throws for a refusal: `describeApiError` reads a 400's detail as a sentence. */
function refusal(detail: string): Error & { status: number; data: { detail: string } } {
  return Object.assign(new Error('Bad Request'), { status: 400, data: { detail }, name: 'FetchError' });
}

const mounted: ReturnType<typeof mount>[] = [];

async function page() {
  const wrapper = mount({ render: () => h(Suspense, null, { default: () => h(PlayersPage) }) }, {
    global: { components: { NuxtLink }, stubs: { StatGrid: true, DefinitionPanel: true } },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const find = (wrapper: Awaited<ReturnType<typeof page>>, id: string) => wrapper.find(`[data-testid="${id}"]`);

async function search(wrapper: Awaited<ReturnType<typeof page>>, typed: string): Promise<void> {
  await find(wrapper, 'player-name').setValue(typed);
  await wrapper.find('form').trigger('submit');
  await flushPromises();
}

describe('the player lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.stats = [];
    registry.byCode = new Map<string, unknown>();
    registry.status = 'ready';
    registry.load.mockResolvedValue(undefined);
    pool.findPlayers.mockResolvedValue(matches([]));
    pool.run.mockResolvedValue({ hands: 0, group_by: [], stats: SHOWN, rows: [], cached: false } satisfies ReportResult);
    vi.stubGlobal('useApi', () => ({}));
    vi.stubGlobal('useAsyncData', async (_key: string, load: () => Promise<unknown>) => ({ data: ref(await load()), error: ref(null) }));
  });
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it('sends the typed name to the route, with nothing else attached to it', async () => {
    const w = await page();
    pool.findPlayers.mockResolvedValue(matches(['ggpoker:one']));
    await search(w, '  Mango  ');
    expect(pool.findPlayers).toHaveBeenCalledWith('Mango');
    expect(pool.run).not.toHaveBeenCalled();
    expect(find(w, 'player-results').text()).toContain('ggpoker:one');
  });

  /*
   * The page holds no minimum of its own: the button is not disabled under three characters, the
   * request is made, and the server's sentence is what appears. A copy of "three" here would be a
   * second number to keep in step with a measurement — and would still be wrong, because the
   * server counts the name half, so `ggpoker:ab` is too short and nothing here could tell.
   */
  it('asks even for a name too short, and prints the refusal in the server’s own words', async () => {
    const w = await page();
    pool.findPlayers.mockRejectedValue(refusal('type at least 3 characters of a screen name'));
    await find(w, 'player-name').setValue('ma');
    /* The button's own state, asserted rather than driven: a disabled submit does not stop a
       programmatic `form.submit`, so the rest of this file would pass just as happily if the page
       grew a client-side copy of the minimum — which is the one thing its docstring forbids.
       (happy-dom does not fire a form's submit from a button click, so the flow still goes
       through the form; what the click would have proven is proven by the line above.) */
    expect(find(w, 'player-search').attributes('disabled')).toBeUndefined();
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(pool.findPlayers).toHaveBeenCalledWith('ma');
    expect(find(w, 'player-error').text()).toBe('type at least 3 characters of a screen name');
    expect(find(w, 'player-none').exists()).toBe(false);
  });

  it('says nothing about how many matched when every match is on screen', async () => {
    const w = await page();
    pool.findPlayers.mockResolvedValue(matches(['ggpoker:one', 'ggpoker:two']));
    await search(w, 'mango');
    expect(find(w, 'player-matched').exists()).toBe(false);
  });

  /* Fifty rows, because that is the only shape this state comes in: the client sends no `limit`,
     the route defaults to 50 and slices, so `matched > rows.length` means `rows.length` is 50. A
     one-row fixture with 1,966 matches is a state the route cannot send, and it hides the rest of
     the sentence — which is why the whole sentence is asserted here and not two substrings. */
  it('says how many matched when it is showing only the busiest of them', async () => {
    const w = await page();
    const fifty = Array.from({ length: 50 }, (_, i) => `ggpoker:p${i}`);
    pool.findPlayers.mockResolvedValue(matches(fifty, { matched: 1966 }));
    await search(w, 'man');
    expect(find(w, 'player-matched').text()).toBe(
      '1,966 names matched “man”. The 50 with the most hands are below, the name typed in full first — type more of it to narrow them.',
    );
  });

  /* Past the engine's ceiling `matched` is a floor, and a floor printed as a count is a number
     that looks measured and is not (ADR-062 decision 4). */
  it('says “at least” when the count the route sent is a floor', async () => {
    const w = await page();
    const fifty = Array.from({ length: 50 }, (_, i) => `ggpoker:p${i}`);
    pool.findPlayers.mockResolvedValue(matches(fifty, { matched: 10000, matched_capped: true }));
    await search(w, 'man');
    expect(find(w, 'player-matched').text()).toContain('At least 10,000 names matched');
  });

  it('quotes the name that was searched when nothing matched', async () => {
    const w = await page();
    await search(w, 'zzzz');
    expect(find(w, 'player-none').text()).toContain('“zzzz”');
    expect(find(w, 'player-matched').exists()).toBe(false);
  });

  /* The intro names what you get only once the route has said what that is (ADR-062). */
  it('names no stats before a search and the answer’s own stats after one', async () => {
    const w = await page();
    expect(find(w, 'player-intro').text()).not.toContain('You get');
    pool.findPlayers.mockResolvedValue(matches(['ggpoker:one']));
    await search(w, 'mango');
    expect(find(w, 'player-intro').text()).toContain('Hands and VPIP');
  });

  /*
   * The one failure this page cannot have. `/v1/pool/stats` is cached per tenant, so a player read
   * earlier answers in milliseconds while a cold one waits for the rollup; click the slow one and
   * then the fast one and the responses land in the wrong order. A player report has no group
   * column — the grid is one `All` row — so the heading would name one opponent over another's
   * numbers with nothing on screen to tell. Two clicks, resolved backwards, asserted on the grid.
   */
  it('never renders one player’s numbers under another player’s name', async () => {
    const w = await page();
    pool.findPlayers.mockResolvedValue(matches(['ggpoker:slow', 'ggpoker:fast']));
    await search(w, 'ggpoker');
    let landSlow: (result: ReportResult) => void = () => undefined;
    const slow = new Promise<ReportResult>((resolve) => (landSlow = resolve));
    pool.run.mockReturnValueOnce(slow);
    pool.run.mockResolvedValueOnce(report(4242));
    await find(w, 'player-ggpoker:slow').trigger('click');
    await find(w, 'player-ggpoker:fast').trigger('click');
    await flushPromises();
    landSlow(report(1111));
    await flushPromises();
    expect(find(w, 'player-chosen').text()).toBe('ggpoker:fast');
    expect(w.findComponent({ name: 'StatGrid' }).props('result')).toEqual(report(4242));
  });

  it('reads a chosen player with the stats the answer arrived with', async () => {
    const w = await page();
    pool.findPlayers.mockResolvedValue(matches(['ggpoker:one']));
    await search(w, 'mango');
    await find(w, 'player-ggpoker:one').trigger('click');
    await flushPromises();
    expect(pool.run).toHaveBeenCalledWith({ player_key: 'ggpoker:one', stats: ['hands', 'vpip'], group_by: [] });
    expect(find(w, 'player-chosen').text()).toBe('ggpoker:one');
  });

  /*
   * The regression `players.vue` and `noPlayerWords` both name: the box goes on being edited and
   * the answer does not follow it. Every other test here sets the box and submits in one breath,
   * so `searched` and `typed` are equal at assertion time and a binding that read the wrong one
   * would be invisible — which is what makes this case, and not those, the guard.
   */
  it('keeps the answer about the search that ran while the box goes on being edited', async () => {
    const w = await page();
    await search(w, 'zzzz');
    expect(find(w, 'player-none').text()).toContain('“zzzz”');
    await find(w, 'player-name').setValue('ma');
    await flushPromises();
    expect(find(w, 'player-none').text()).toContain('“zzzz”');
    expect(find(w, 'player-none').text()).not.toContain('“ma”');
  });

  it('keeps the matched count about the search that ran, too', async () => {
    const w = await page();
    const fifty = Array.from({ length: 50 }, (_, i) => `ggpoker:p${i}`);
    pool.findPlayers.mockResolvedValue(matches(fifty, { matched: 1966 }));
    await search(w, 'man');
    await find(w, 'player-name').setValue('mango');
    await flushPromises();
    expect(find(w, 'player-matched').text()).toContain('“man”');
    expect(find(w, 'player-matched').text()).not.toContain('“mango”');
  });

  /* The answer on screen is about the search that ran, and is cleared before the next await —
     a second search used to leave the previous sentence up, rewritten to quote untried text. */
  it('clears the previous answer before asking again', async () => {
    const w = await page();
    pool.findPlayers.mockResolvedValue(matches(['ggpoker:one']));
    await search(w, 'mango');
    pool.findPlayers.mockRejectedValue(refusal('type at least 3 characters of a screen name'));
    await search(w, 'ma');
    expect(find(w, 'player-results').exists()).toBe(false);
    expect(find(w, 'player-error').exists()).toBe(true);
  });
});
