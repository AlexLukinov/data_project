// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import type { EmptyStateView } from '~/reports/emptyState';

import EmptyState from './EmptyState.vue';

/** A `NuxtLink` that keeps its `to`, so the test can read where an action would go. */
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()),
});

const VIEW: EmptyStateView = {
  lead: 'A report is a grid.',
  body: 'Press Run report to fill it.',
  actions: [
    { key: 'upload', label: 'Upload hand histories', to: '/upload' },
    { key: 'clear-dates', label: 'Clear the dates' },
  ],
};

function empty(view: EmptyStateView = VIEW) {
  return mount(EmptyState, { props: { view, testid: 'grid-empty' }, global: { components: { NuxtLink } } });
}

const find = (w: ReturnType<typeof empty>, id: string) => w.find(`[data-testid="${id}"]`);

describe('EmptyState', () => {
  it('hands a button press back to the page instead of doing anything itself', async () => {
    const w = empty();
    await find(w, 'grid-empty-clear-dates').trigger('click');
    expect(w.emitted('act')).toEqual([['clear-dates']]);
  });

  it('renders an action with a `to` as a link, which emits nothing', () => {
    const w = empty();
    const link = find(w, 'grid-empty-upload');
    expect(link.element.tagName).toBe('A');
    expect(link.attributes('href')).toBe('/upload');
    expect(w.emitted('act')).toBeUndefined();
  });

  it('puts the given testid on the wrapper and on every action under it', () => {
    const w = empty();
    expect(find(w, 'grid-empty').exists()).toBe(true);
    expect(w.findAll('[data-testid^="grid-empty-"]').map((el) => el.text())).toEqual(['Upload hand histories', 'Clear the dates']);
  });

  it('shows the lead and the body with no actions at all, rather than an empty row of buttons', () => {
    const w = empty({ lead: 'Nothing has run yet.', body: 'Choose a stat above.', actions: [] });
    expect(find(w, 'grid-empty').text()).toContain('Nothing has run yet.');
    expect(find(w, 'grid-empty').text()).toContain('Choose a stat above.');
    expect(w.findAll('button')).toHaveLength(0);
    expect(w.findAll('a')).toHaveLength(0);
  });
});
