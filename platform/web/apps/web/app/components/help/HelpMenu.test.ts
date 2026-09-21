// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';

import type { HelpSession } from '~/help/state';
import { createHelpSession } from '~/help/state';
import { TOUR_STOPS } from '~/help/tour';

import HelpMenu from './HelpMenu.vue';

const help = vi.hoisted(() => ({ session: null as HelpSession | null }));
vi.mock('~/help/useHelp', () => ({ useHelp: () => help.session }));

const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots, attrs }) => () => h('a', { ...attrs, href: props.to }, slots.default?.()),
});

const navigateTo = vi.fn();
const route = reactive({ fullPath: '/lab' });

function menu() {
  return mount(HelpMenu, { props: { stops: TOUR_STOPS }, attachTo: document.body, global: { components: { NuxtLink } } });
}

const tourButton = (w: ReturnType<typeof menu>) => w.find('[data-testid="help-tour"]');

describe('HelpMenu', () => {
  beforeEach(() => {
    help.session = createHelpSession(null);
    navigateTo.mockReset();
    route.fullPath = '/lab';
    vi.stubGlobal('navigateTo', navigateTo);
    vi.stubGlobal('useRoute', () => route);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('offers to take the tour on a first visit and after finishing it', async () => {
    const w = menu();
    expect(tourButton(w).text()).toBe('Take the tour');
    help.session!.update({ tour: 'finished' });
    await w.vm.$nextTick();
    expect(tourButton(w).text()).toBe('Take the tour');
  });

  it('resumes a stopped tour at the stop it was left on', async () => {
    help.session!.update({ tour: 'stopped', stop: 2 });
    const w = menu();
    expect(tourButton(w).text()).toBe(`Resume the tour (stop 3 of ${TOUR_STOPS.length})`);
    await tourButton(w).trigger('click');
    expect(help.session!.state.value).toMatchObject({ tour: 'running', stop: 2 });
    expect(navigateTo).toHaveBeenCalledWith(TOUR_STOPS[2]!.route);
  });

  it('restarts a running tour from the first stop', async () => {
    help.session!.update({ tour: 'running', stop: 3 });
    const w = menu();
    expect(tourButton(w).text()).toBe('Restart the tour');
    await tourButton(w).trigger('click');
    expect(help.session!.state.value).toMatchObject({ tour: 'running', stop: 0 });
  });

  it('links to the Examples and asks the shell for the shortcut list, closing itself', async () => {
    const w = menu();
    const details = w.find('[data-testid="help-menu"]').element as HTMLDetailsElement;
    expect(w.find('[data-testid="help-examples"]').attributes('href')).toBe('/examples');
    details.open = true;
    await w.find('[data-testid="help-shortcuts"]').trigger('click');
    expect(w.emitted('shortcuts')).toHaveLength(1);
    expect(details.open).toBe(false);
  });

  it('closes itself when the reader clicks elsewhere or opens another page', async () => {
    const w = menu();
    const details = w.find('[data-testid="help-menu"]').element as HTMLDetailsElement;
    details.open = true;
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(details.open).toBe(false);

    details.open = true;
    w.find('summary').element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(details.open, 'a click inside the menu leaves it open').toBe(true);

    route.fullPath = '/train';
    await w.vm.$nextTick();
    expect(details.open).toBe(false);
    w.unmount();
  });
});
