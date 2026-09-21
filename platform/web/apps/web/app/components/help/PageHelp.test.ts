// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';

import { controlById } from '~/help/controls';
import { openExplainer, setAttachedControls } from '~/help/explainer';
import type { HelpSession } from '~/help/state';
import { createHelpSession } from '~/help/state';

import PageHelp from './PageHelp.vue';

const help = vi.hoisted(() => ({ session: null as HelpSession | null }));
vi.mock('~/help/useHelp', () => ({ useHelp: () => help.session }));

const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots, attrs }) => () => h('a', { ...attrs, href: props.to }, slots.default?.()),
});

const route = reactive({ path: '/pool' });

function page() {
  return mount(PageHelp, { attachTo: document.body, global: { components: { NuxtLink } } });
}

const toggle = (w: ReturnType<typeof page>) => w.find('[data-testid="page-help-toggle"]');

describe('PageHelp', () => {
  beforeEach(() => {
    help.session = createHelpSession(null);
    route.path = '/pool';
    setAttachedControls([]);
    vi.stubGlobal('useRoute', () => route);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('says what the page is, and opens itself the first time a tool is visited', () => {
    const w = page();
    expect(w.find('[data-testid="page-help-what"]').text()).toContain('What the field does');
    expect(w.find('[data-testid="page-help-card"]').exists()).toBe(true);
    w.unmount();
  });

  it('marks the tool read when it is collapsed, and stays collapsed on the next visit', async () => {
    const first = page();
    await toggle(first).trigger('click');
    expect(first.find('[data-testid="page-help-card"]').exists()).toBe(false);
    expect(help.session!.state.value.seen).toEqual(['pool']);
    first.unmount();

    const again = page();
    expect(again.find('[data-testid="page-help-card"]').exists()).toBe(false);
    expect(toggle(again).text()).toBe('How does this work?');
    again.unmount();
  });

  it('opens a tool the reader has not met even when others have been read', async () => {
    const w = page();
    await toggle(w).trigger('click');
    route.path = '/lab';
    await w.vm.$nextTick();
    expect(w.find('[data-testid="page-help-card"]').exists()).toBe(true);
    w.unmount();
  });

  it('closes on Escape and reopens from the header menu', async () => {
    const w = page();
    await w.find('[data-testid="page-help"]').trigger('keydown', { key: 'Escape' });
    expect(w.find('[data-testid="page-help-card"]').exists()).toBe(false);
    openExplainer();
    await w.vm.$nextTick();
    expect(w.find('[data-testid="page-help-card"]').exists()).toBe(true);
    w.unmount();
  });

  it('lists the explained controls that are actually on the page, and nothing on a page with none', async () => {
    const w = page();
    expect(w.find('[data-testid="page-help-controls"]').exists()).toBe(false);
    setAttachedControls(['min-n', 'stat-picker']);
    await w.vm.$nextTick();
    // The catalogue's own name, not a quote of it: `controls.test.ts` guards the words.
    expect(w.find('[data-testid="page-help-control-min-n"]').text()).toContain(controlById('min-n')!.control);
    expect(w.findAll('[data-testid^="page-help-control-"]')).toHaveLength(2);
    w.unmount();
  });

  it('shows nothing at all on a route that is not a tool', () => {
    route.path = '/login';
    const w = page();
    expect(w.find('[data-testid="page-help"]').exists()).toBe(false);
    w.unmount();
  });
});
