// @vitest-environment happy-dom
/**
 * The cohorts page's one silent failure: a member list under the wrong cohort's name (plan F.14).
 *
 * "Who is in it" is the only control on this page that shows **real opponents by name**, and the
 * panel it fills is keyed on `openKey` alone. Nothing disables the rows while one is loading, and
 * `/v1/pool/cohorts/{id}/members` goes through the report cache — so a cohort opened a moment ago
 * answers in milliseconds while a cold one waits, and two clicks in that order land the slow
 * answer last. Without a guard the page then shows one cohort's size and one cohort's members
 * under the other's heading, with nothing on screen to tell.
 *
 * Found by auditing this lane for the shape the review found on `/pool/players` — the neighbouring
 * lane audited its own pages and said plainly that `app/pool/**` was not in its scope.
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense, defineComponent, h, ref } from 'vue';

import type * as PoolStatsModule from '~/pool/stats';
import type { PoolCohortDetail } from '~/pool/stats';
import type * as ReportsApiModule from '~/reports/api';
import type { ReportResult } from '~/stats/api';

import CohortsPage from './cohorts.vue';

const pool = vi.hoisted(() => ({ cohorts: vi.fn(), cohort: vi.fn(), members: vi.fn(), deleteCohort: vi.fn() }));
vi.mock('~/pool/stats', async (importOriginal) => ({
  ...(await importOriginal<typeof PoolStatsModule>()),
  createPoolStatsApi: () => pool,
}));

const reports = vi.hoisted(() => ({ poolPresets: vi.fn() }));
vi.mock('~/reports/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ReportsApiModule>()),
  createReportsApi: () => reports,
}));

const registry = vi.hoisted(() => ({ stats: [] as unknown[], byCode: new Map<string, unknown>(), status: 'ready', error: '', load: vi.fn() }));
vi.mock('~/stores/definitions', () => ({ useDefinitionsStore: () => registry }));

const NuxtLink = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup: (props, { slots }) => () => h('a', { href: String(props.to) }, slots.default?.()),
});

const SAVED = [
  { id: 'a1', name: 'Regulars', criteria: { rules: [] }, created_at: '', updated_at: '' },
  { id: 'b2', name: 'Fish', criteria: { rules: [] }, created_at: '', updated_at: '' },
];

const detail = (players: number): PoolCohortDetail => ({ ...SAVED[0]!, players });

/** A member list, told apart by its row count — these are screen names on the real thing. */
const memberRows = (n: number): ReportResult => ({
  hands: n,
  group_by: ['player_key'],
  stats: [],
  rows: Array.from({ length: n }, (_, i) => ({ group: { player_key: `p${i}` }, hands: 1, cells: {} })),
  cached: false,
});

const mounted: ReturnType<typeof mount>[] = [];

async function page() {
  const wrapper = mount({ render: () => h(Suspense, null, { default: () => h(CohortsPage) }) }, {
    global: {
      components: { NuxtLink },
      stubs: { CohortForm: true, DefinitionPanel: true, EmptyState: true, StatGrid: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const find = (wrapper: Awaited<ReturnType<typeof page>>, id: string) => wrapper.find(`[data-testid="${id}"]`);

describe('the cohorts page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.stats = [];
    registry.load.mockResolvedValue(undefined);
    reports.poolPresets.mockResolvedValue({ reports: [], cohorts: [] });
    pool.cohorts.mockResolvedValue(SAVED);
    vi.stubGlobal('useApi', () => ({}));
    vi.stubGlobal('useRoute', () => ({ query: {}, params: {} }));
    vi.stubGlobal('useRouter', () => ({ replace: vi.fn() }));
    vi.stubGlobal('useAsyncData', async (_key: string, load: () => Promise<unknown>) => ({ data: ref(await load()), error: ref(null) }));
  });
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it('lists the saved cohorts it was given', async () => {
    const w = await page();
    expect(find(w, 'open-a1').exists()).toBe(true);
    expect(find(w, 'open-b2').exists()).toBe(true);
  });

  it('never shows one cohort’s members under another cohort’s name', async () => {
    const w = await page();
    let landSlow: (result: ReportResult) => void = () => undefined;
    const slowMembers = new Promise<ReportResult>((resolve) => (landSlow = resolve));
    // the first cohort is cold: its detail resolves, its member list hangs
    pool.cohort.mockResolvedValueOnce(detail(11));
    pool.members.mockReturnValueOnce(slowMembers);
    // the second was read a moment ago: both halves answer at once
    pool.cohort.mockResolvedValueOnce(detail(22));
    pool.members.mockResolvedValueOnce(memberRows(2));

    await find(w, 'open-a1').trigger('click');
    await find(w, 'open-b2').trigger('click');
    await flushPromises();
    landSlow(memberRows(11));
    await flushPromises();

    const grid = w.findComponent({ name: 'StatGrid' });
    expect(grid.props('result')).toEqual(memberRows(2));
    expect(w.text()).toContain('22');
    expect(w.text()).not.toContain('11 players');
  });
});
