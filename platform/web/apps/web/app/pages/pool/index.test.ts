// @vitest-environment happy-dom
/**
 * What the Pool page must still be rendering for the rest of the app to work (plan F.14).
 *
 * Until now nothing anywhere asserted a single `data-testid` on `/pool`, so a re-layout of the
 * busiest screen in the product broke nothing red. These are not decorative ids: the help layer
 * attaches every control's sentence by CSS selector (`components/help/ControlHelp.vue` sweeps the
 * document), and a control whose anchor is not in the DOM is simply missing from the page
 * explainer's "What the controls do" — silently, with no error anywhere. That is exactly how the
 * standard-report row came to be the loudest control on this page and the one control it did not
 * explain: `preset-menu` anchors `[data-testid="report-library"]`, which only `PresetMenu.vue`
 * renders, and this page composes `PresetButton`s instead of mounting that menu.
 *
 * So the assertion is the runtime one, which reading the file cannot make: the anchor is rendered,
 * and rendered before anything has loaded — ControlHelp's first sweep runs `onMounted`.
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense, defineComponent, h, ref } from 'vue';

import { CONTROLS } from '~/help/controls';
import type * as PoolStatsModule from '~/pool/stats';
import type * as ReportsApiModule from '~/reports/api';
import type { ReportResult } from '~/stats/api';

import PoolPage from './index.vue';

const pool = vi.hoisted(() => ({ cohorts: vi.fn(), run: vi.fn() }));
vi.mock('~/pool/stats', async (importOriginal) => ({
  ...(await importOriginal<typeof PoolStatsModule>()),
  createPoolStatsApi: () => pool,
}));

const reports = vi.hoisted(() => ({ poolPresets: vi.fn() }));
vi.mock('~/reports/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ReportsApiModule>()),
  createReportsApi: () => reports,
}));

const registry = vi.hoisted(() => ({ stats: [] as unknown[], dimensions: [] as unknown[], byCode: new Map<string, unknown>(), status: 'ready', error: '', load: vi.fn() }));
vi.mock('~/stores/definitions', () => ({ useDefinitionsStore: () => registry }));

const filter = vi.hoisted(() => ({
  /* What `createColumnsModel` reads through `lockedToPopulation` (`pool/population.ts`). */
  tables: ['decisions', 'player_hands', 'stats_daily'],
  load: vi.fn(),
  reportRequest: vi.fn(() => ({})),
  dataset: 'population',
  sentence: 'every hand',
  active: false,
  clauses: [] as unknown[],
  problems: [] as string[],
  state: {},
  dateFrom: '',
  dateTo: '',
  node: null,
  query: {},
  clear: vi.fn(),
}));
vi.mock('~/stores/filter', () => ({ useFilterStore: () => filter }));

const NuxtLink = defineComponent({ props: { to: { type: String, required: true } }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) });

const PRESET = { code: 'regs_by_position', label: 'Regulars by position', description: 'What regulars do from each seat.', request: { stats: ['vpip'], group_by: ['position'] } };

const mounted: ReturnType<typeof mount>[] = [];

async function page() {
  /* Every child stubbed but `PresetButton`, which has to render for real: a stub would print the
     row's `testid` prop under its own name and not as the `data-testid` the help layer and the
     browser test look for. `shallow: true` is not usable here — it stubs `Suspense` too, and the
     page awaits its data in setup. */
  const wrapper = mount({ render: () => h(Suspense, null, { default: () => h(PoolPage) }) }, {
    global: {
      components: { NuxtLink },
      stubs: { CohortGrids: true, CohortPicker: true, FilterBar: true, DefinitionPanel: true, EmptyState: true, GroupByPicker: true, ReadingThreshold: true, StatPicker: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const find = (wrapper: Awaited<ReturnType<typeof page>>, id: string) => wrapper.find(`[data-testid="${id}"]`);

describe('the Pool page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.stats = [{ code: 'vpip', label: 'VPIP', category: 'preflop', grain: 'hand', format: 'percent' }];
    registry.dimensions = [];
    registry.byCode = new Map<string, unknown>();
    registry.status = 'ready';
    registry.load.mockResolvedValue(undefined);
    reports.poolPresets.mockResolvedValue({ reports: [PRESET], cohorts: [] });
    pool.cohorts.mockResolvedValue([]);
    vi.stubGlobal('useApi', () => ({}));
    vi.stubGlobal('useRoute', () => ({ query: {}, params: {} }));
    vi.stubGlobal('useRouter', () => ({ replace: vi.fn() }));
    vi.stubGlobal('useReportUrl', () => undefined);
    /* Nuxt's loader reduced to the one behaviour this page depends on: `lazy: true` resolves the
       setup immediately and fills in later, which is what lets the page paint before the registry
       and the cohorts have answered (F.12, spec §13). Awaiting both is what used to hold the whole
       app — nav included — behind a slow API. */
    vi.stubGlobal('useAsyncData', async (_key: string, load: () => Promise<unknown>, options?: { lazy?: boolean }) => {
      const data = ref<unknown>(null);
      const settled = load()
        .then((value) => (data.value = value))
        .catch(() => undefined);
      if (options?.lazy !== true) await settled;
      return { data, error: ref(null) };
    });
  });
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it('renders the row of standard reports, and names it so the help layer can find it', async () => {
    const w = await page();
    expect(find(w, 'pool-presets').exists()).toBe(true);
    expect(find(w, 'pool-preset-regs_by_position').exists()).toBe(true);
  });

  /*
   * ControlHelp sweeps the document `onMounted`, before a slow presets call has answered, and an
   * anchor that only appears afterwards is an explainer entry that comes and goes.
   *
   * **Both** loaders hang, not just the cohorts one. The page marks each `lazy: true` so a slow
   * or stopped API cannot hold `<Suspense>` — and therefore the whole app, nav included — behind
   * it; with only the presets call hanging, dropping `lazy` from the *registry* call left every
   * assertion here green, because `registry.load` resolves instantly in the other tests.
   */
  it('names the row before either the registry or the cohorts have arrived', async () => {
    reports.poolPresets.mockReturnValue(new Promise(() => undefined));
    registry.load.mockReturnValue(new Promise(() => undefined));
    const w = await page();
    /* Retried, not sampled: with both loads pending for ever there is no promise left to await, so
       a single `flushPromises()` is a guess about how many microtask hops `<Suspense>` needs to
       resolve the page's async setup. It is usually enough — it failed once in twenty whole-suite
       runs, which on this gate is a 5% red that points at the page instead of at the wait. */
    await vi.waitFor(() => expect(find(w, 'pool-presets').exists()).toBe(true));
    expect(find(w, 'pool-preset-regs_by_position').exists()).toBe(false);
  });

  /*
   * The other half of "an answer is about the question that was asked". The Run button disables
   * while a report runs, so no second run races it — but the boxes stay editable, and a report
   * that cleared the flag unconditionally would come back and present itself as the answer to
   * whatever is on screen now. The watcher cannot catch it either: on a first run `left` is still
   * null when it fires, so it says nothing at all.
   */
  it('marks a report stale when the question changed while it was running', async () => {
    const w = await page();
    let land: (result: ReportResult) => void = () => undefined;
    pool.run.mockReturnValueOnce(new Promise<ReportResult>((resolve) => (land = resolve)));
    await find(w, 'run-report').trigger('click');
    await flushPromises();
    filter.state = { changed: true };
    land({ hands: 1, group_by: [], stats: [], rows: [{ group: {}, hands: 1, cells: {} }], cached: false });
    await flushPromises();
    expect(find(w, 'report-stale').exists()).toBe(true);
  });

  it('leaves a report unmarked when the question did not move under it', async () => {
    const w = await page();
    pool.run.mockResolvedValue({ hands: 1, group_by: [], stats: [], rows: [{ group: {}, hands: 1, cells: {} }], cached: false });
    await find(w, 'run-report').trigger('click');
    await flushPromises();
    expect(find(w, 'report-stale').exists()).toBe(false);
  });

  it('keeps the page-level controls and notes the rest of the app anchors on', async () => {
    const w = await page();
    for (const id of ['pool-scope', 'dataset-locked', 'run-report']) {
      expect(find(w, id).exists(), id).toBe(true);
    }
  });

  /*
   * The catalogue and the page, checked against each other at runtime. `controls.test.ts` reads
   * the entry's `source` file as text, which would pass just as happily if the anchor sat inside
   * a `v-if` that is false on arrival — the one failure that actually removes a sentence from the
   * explainer.
   */
  it('renders every control the catalogue says this page is the source of', async () => {
    const w = await page();
    const here = CONTROLS.filter((control) => control.source.endsWith('pages/pool/index.vue'));
    expect(here.length).toBeGreaterThan(0);
    for (const control of here) {
      expect(w.find(control.anchor).exists(), `${control.id} → ${control.anchor}`).toBe(true);
    }
  });
});
