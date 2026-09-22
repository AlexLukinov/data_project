// @vitest-environment happy-dom
/** The analyses list's delete (audit §2.13): a refused delete is said on the page, not lost as an unhandled rejection. */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense, defineComponent, h, ref } from 'vue';

import type { AnalysisSummary } from '~/analyze/api';
import { exampleById } from '~/help/examples';
import { toolById } from '~/help/tools';

import AnalysesPage from './index.vue';

const api = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn() }));
vi.mock('~/analyze/api', () => ({ createAnalysesApi: () => api }));

const ROW: AnalysisSummary = {
  id: 'a1', title: 'BB call vs CO · 2026-09-14', source: 'manual', hand_uid: '', node_key: null, current_step: 1,
  completed_steps: [], heuristic: '', tags: [], created_at: '2026-09-14T10:00:00Z', updated_at: '2026-09-14T10:00:00Z',
};

const NuxtLink = defineComponent({ props: { to: { type: String, required: true } }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) });

async function page() {
  // The page awaits its data in setup, so it is mounted inside a Suspense, as Nuxt mounts it.
  const wrapper = mount({ render: () => h(Suspense, null, { default: () => h(AnalysesPage) }) }, { global: { components: { NuxtLink } } });
  await flushPromises();
  return wrapper;
}

describe('the analyses list — deleting', () => {
  const refresh = vi.fn();
  beforeEach(() => {
    api.remove.mockReset();
    refresh.mockReset();
    vi.stubGlobal('useApi', () => ({}));
    vi.stubGlobal('useAsyncData', async () => ({ data: ref([ROW]), error: ref(null), refresh }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('says a refused delete, keeps the row and does not re-read the list', async () => {
    api.remove.mockRejectedValue({ status: 500, data: { detail: 'Internal Server Error' } });
    const wrapper = await page();
    await wrapper.find('[data-testid="analyses-delete-a1"]').trigger('click');
    await flushPromises();
    const alert = wrapper.find('[data-testid="analyses-delete-error"]');
    expect(alert.attributes('role')).toBe('alert');
    expect(alert.text()).toContain('Could not delete the analysis');
    expect(wrapper.find('[data-testid="analyses-list"]').text()).toContain(ROW.title);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('re-reads the list after a delete that happened, and clears an earlier refusal', async () => {
    api.remove.mockRejectedValueOnce({ status: 500 }).mockResolvedValueOnce(undefined);
    const wrapper = await page();
    await wrapper.find('[data-testid="analyses-delete-a1"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="analyses-delete-error"]').exists()).toBe(true);
    await wrapper.find('[data-testid="analyses-delete-a1"]').trigger('click');
    await flushPromises();
    expect(api.remove).toHaveBeenLastCalledWith('a1');
    expect(refresh).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="analyses-delete-error"]').exists()).toBe(false);
  });
});

/*
 * ADR-073. The two ways in this page has always offered both start at a hand, and an account
 * with no analyses usually has none: `/hands` is empty for it and pasting needs hand-history
 * text. The worked example needs neither, and since ADR-061 it opens all nine steps, so it is the
 * only offer here that actually shows what an analysis is.
 */
describe('the analyses list — nothing run yet', () => {
  beforeEach(() => {
    vi.stubGlobal('useApi', () => ({}));
    vi.stubGlobal('useAsyncData', async () => ({ data: ref([]), error: ref(null), refresh: vi.fn() }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('offers a worked spot beside the two ways that need a hand, at the id its own tool names', async () => {
    const wrapper = await page();
    const link = wrapper.find('[data-testid="analyses-empty-example"]');
    expect(link.attributes('href')).toBe(`/examples/${toolById('analyses')!.example}`);
    expect(exampleById(toolById('analyses')!.example)).not.toBeNull();
    expect(wrapper.find('[data-testid="analyses-empty"]').text()).toContain('with no hand at all');
  });
});
