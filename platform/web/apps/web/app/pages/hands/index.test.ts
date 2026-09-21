// @vitest-environment happy-dom
/**
 * The hand list's two teaching moments (audit §2.4, §3.3, plan F.12c): a list with nothing in it,
 * and a header that names four registry columns. The sentences themselves are asserted in
 * `hands/emptyState.test.ts`; what is checked here is the wiring — that the page offers only the
 * ways out it can take, takes each of them, and claims nothing while the request is still running.
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense, defineComponent, h, ref } from 'vue';

import type { Dimension } from '~/stats/api';

import HandsPage from './index.vue';

const filter = vi.hoisted(() => ({
  dataset: 'hero',
  sentence: 'every hand',
  active: false,
  clauses: [] as unknown[],
  dateFrom: '',
  dateTo: '',
  node: null,
  query: {},
  clear: vi.fn(),
}));
const registry = vi.hoisted(() => ({ byCode: new Map<string, unknown>(), status: 'ready', error: '', load: vi.fn() }));

vi.mock('~/stores/filter', () => ({ useFilterStore: () => filter }));
vi.mock('~/stores/definitions', () => ({ useDefinitionsStore: () => registry }));

function dim(code: string, label: string, description: string): Dimension {
  return { code, label, type: 'string', tables: ['decisions', 'player_hands'], description, values: [], ops: null, group_by: true, buckets: {}, allowed_ops: [] };
}

const NuxtLink = defineComponent({ props: { to: { type: [String, Object], required: true } }, setup: (props, { slots }) => () => h('a', { href: String(props.to) }, slots.default?.()) });

const replace = vi.fn();
const rows = ref<unknown[]>([]);
const listStatus = ref('success');

async function page(query: Record<string, string> = {}) {
  vi.stubGlobal('useRoute', () => ({ query, params: {} }));
  const wrapper = mount({ render: () => h(Suspense, null, { default: () => h(HandsPage) }) }, { global: { components: { NuxtLink }, stubs: { FilterBar: true } } });
  await flushPromises();
  return wrapper;
}

const find = (wrapper: Awaited<ReturnType<typeof page>>, id: string) => wrapper.find(`[data-testid="${id}"]`);

describe('the hand list with nothing in it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filter.dataset = 'hero';
    filter.sentence = 'every hand';
    filter.active = false;
    filter.clauses = [];
    filter.dateFrom = '';
    filter.dateTo = '';
    registry.byCode = new Map<string, unknown>();
    registry.status = 'ready';
    registry.error = '';
    registry.load.mockResolvedValue(undefined);
    rows.value = [];
    listStatus.value = 'success';
    vi.stubGlobal('useApi', () => ({}));
    vi.stubGlobal('useHands', () => ({ recent: vi.fn(async () => []), pool: vi.fn(async () => []), search: vi.fn(async () => []) }));
    vi.stubGlobal('useFilterUrl', () => undefined);
    vi.stubGlobal('useRouter', () => ({ replace }));
    vi.stubGlobal('useAsyncData', async (key: string) => {
      if (key === 'hands-list') return { data: rows, error: ref(null), status: listStatus };
      if (key === 'hand-tag-vocabulary') return { data: ref([]) };
      return { data: ref(null), error: ref(null) };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('teaches what the list holds instead of saying "No hands match", and still counts 0 hands', async () => {
    const wrapper = await page();
    expect(find(wrapper, 'hands-count').text()).toContain('0 hands');
    expect(find(wrapper, 'hands-empty').text()).toContain('Every hand you upload is listed here');
    expect(find(wrapper, 'hands-empty-upload').attributes('href')).toBe('/upload');
    expect(find(wrapper, 'hands-empty-paste').attributes('href')).toBe('/hands/paste');
  });

  it('names what narrowed the list and offers exactly the narrowings it can let go of', async () => {
    filter.active = true;
    filter.sentence = 'Position is one of BTN';
    filter.dateFrom = '2026-01-01';
    const wrapper = await page({ tag: 'bluff' });

    expect(find(wrapper, 'hands-empty').text()).toContain('None of your hands match Position is one of BTN, tagged “bluff” and played on 2026-01-01 or later.');
    expect(find(wrapper, 'hands-empty-clear-situation').exists()).toBe(true);
    expect(find(wrapper, 'hands-empty-clear-dates').exists()).toBe(true);
    expect(find(wrapper, 'hands-empty-clear-tag').exists()).toBe(true);
    expect(find(wrapper, 'hands-empty-other-dataset').text()).toBe('Look in the pool');
  });

  it('takes every way out it offers, rather than only naming it', async () => {
    filter.active = true;
    filter.dateFrom = '2026-01-01';
    filter.dateTo = '2026-02-01';
    const wrapper = await page({ tag: 'bluff' });

    await find(wrapper, 'hands-empty-clear-situation').trigger('click');
    expect(filter.clear).toHaveBeenCalledOnce();
    await find(wrapper, 'hands-empty-clear-dates').trigger('click');
    expect([filter.dateFrom, filter.dateTo]).toEqual(['', '']);
    await find(wrapper, 'hands-empty-clear-tag').trigger('click');
    expect(replace).toHaveBeenCalledWith({ query: { tag: undefined } });
    await find(wrapper, 'hands-empty-other-dataset').trigger('click');
    expect(filter.dataset).toBe('population');
  });

  it('claims nothing while the list is still being read', async () => {
    listStatus.value = 'pending';
    const wrapper = await page();
    expect(find(wrapper, 'hands-empty').exists()).toBe(false);
    expect(find(wrapper, 'hands-loading').exists()).toBe(true);
  });

  it('says a registry that did not load, and offers to ask for it again', async () => {
    registry.status = 'error';
    // The store's own sentence, kept in step with it: it names no control, because this is one of
    // seven pages that render it verbatim.
    registry.error = 'The stat registry could not be loaded, so nothing on this page can be named or explained.';
    const wrapper = await page();

    const alert = find(wrapper, 'definitions-error');
    expect(alert.attributes('role')).toBe('alert');
    expect(alert.text()).toContain('The stat registry could not be loaded');
    await find(wrapper, 'definitions-retry').trigger('click');
    expect(registry.load).toHaveBeenCalled();
  });
});

describe('the hand list with rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filter.dataset = 'hero';
    filter.clauses = [];
    registry.byCode = new Map<string, unknown>([
      ['stake_level', dim('stake_level', 'Stakes', 'Cash: limit type plus the big blind in cents (NL50).')],
      ['position', dim('position', 'Position', 'The seat relative to the button.')],
      ['hole_cards', dim('hole_cards', 'Hole cards', "The exact cards ('As Kd'); '' when unknown.")],
      ['net_won_bb', dim('net_won_bb', 'Net won (bb)', 'Chips won minus chips put in, in big blinds.')],
    ]);
    registry.status = 'ready';
    rows.value = [{ hand_uid: 'h1', site: 'ggpoker', played_at_utc: '2026-09-01T12:00:00Z', stake_level: 'NL10', seat: 2, position: 'BTN', hole_cards: 'As Kd', board: '', net_won_bb: 4.5, went_to_showdown: false, tags: [] }];
    listStatus.value = 'success';
    vi.stubGlobal('useApi', () => ({}));
    vi.stubGlobal('useHands', () => ({ recent: vi.fn(async () => []), pool: vi.fn(async () => []), search: vi.fn(async () => []) }));
    vi.stubGlobal('useFilterUrl', () => undefined);
    vi.stubGlobal('useRouter', () => ({ replace }));
    vi.stubGlobal('useAsyncData', async (key: string) => {
      if (key === 'hands-list') return { data: rows, error: ref(null), status: listStatus };
      if (key === 'hand-tag-vocabulary') return { data: ref([]) };
      return { data: ref(null), error: ref(null) };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('heads the four registry columns with the registry’s own words, explained on focus', async () => {
    const wrapper = await page();
    const header = wrapper.find('thead').text();
    expect(header).toContain('Stakes');
    expect(header).toContain('Position');
    expect(header).toContain('Hole cards');
    expect(header).toContain('Net won (bb)');

    const term = wrapper.find('[data-term="Stakes"]');
    // The definition is reachable by keyboard and by screen reader, not only by a mouse hover.
    expect(term.attributes('tabindex')).toBe('0');
    const tip = wrapper.find(`#${term.attributes('aria-describedby')}`);
    expect(tip.attributes('role')).toBe('tooltip');
    expect(tip.text()).toContain('limit type plus the big blind in cents');
    expect(wrapper.find('thead').attributes('title')).toBeUndefined();
  });
});
