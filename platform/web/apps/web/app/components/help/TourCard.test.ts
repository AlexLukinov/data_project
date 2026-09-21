// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

import type { HelpSession } from '~/help/state';
import { createHelpSession } from '~/help/state';
import type { TourStop } from '~/help/tour';
import { ANCHOR_WAIT_MS } from '~/help/tour';

import TourCard from './TourCard.vue';

const help = vi.hoisted(() => ({ session: null as HelpSession | null }));
vi.mock('~/help/useHelp', () => ({ useHelp: () => help.session }));

const STOPS: readonly TourStop[] = [
  { chapter: 'Analyze', route: '/examples/x', anchor: 'step-purpose', where: 'A worked example', title: 'First', lines: ['one'] },
  { chapter: 'Train', route: '/train', anchor: 'mode-equity', where: 'Train', title: 'Second', lines: ['two', 'more'], tryIt: { label: 'Now try it: a spot', to: '/examples/x' } },
];

const route = reactive({ path: '/examples/x' });
const navigateTo = vi.fn();

function anchor(testid: string): HTMLElement {
  const element = document.createElement('div');
  element.dataset.testid = testid;
  element.scrollIntoView = vi.fn();
  document.body.appendChild(element);
  return element;
}

function card() {
  return mount(TourCard, { props: { stops: STOPS }, attachTo: document.body, global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } } });
}

function press(key: string, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('TourCard', () => {
  beforeEach(() => {
    help.session = createHelpSession(null);
    route.path = '/examples/x';
    navigateTo.mockReset();
    vi.stubGlobal('useRoute', () => route);
    vi.stubGlobal('navigateTo', navigateTo);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('shows nothing unless the tour is running', () => {
    const w = card();
    expect(w.find('[data-testid="tour-card"]').exists()).toBe(false);
    w.unmount();
  });

  it('points at the stop’s anchor on its page, with the stop’s own words and where it is', async () => {
    const target = anchor('step-purpose');
    help.session!.update({ tour: 'running', stop: 0 });
    const w = card();
    await flushPromises();
    expect(w.find('[data-testid="tour-title"]').text()).toBe('First');
    expect(w.find('[data-testid="tour-progress"]').text()).toBe('Analyze · chapter 1 of 2 · 1 of 1 · A worked example');
    expect(w.find('[data-testid="tour-tryit"]').exists()).toBe(false);
    expect(w.find('[data-testid="tour-ring"]').exists()).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(w.find('[data-testid="tour-elsewhere"]').exists()).toBe(false);
    w.unmount();
  });

  it('says so, rather than waiting for ever, when the anchor never appears', async () => {
    vi.useFakeTimers();
    help.session!.update({ tour: 'running', stop: 0 });
    const w = card();
    await vi.advanceTimersByTimeAsync(ANCHOR_WAIT_MS + 500);
    expect(w.find('[data-testid="tour-missing"]').exists()).toBe(true);
    expect(w.find('[data-testid="tour-ring"]').exists()).toBe(false);
    w.unmount();
  });

  it('looks for its anchor again when the page destroys the one it was ringing', async () => {
    vi.useFakeTimers();
    const target = anchor('step-purpose');
    help.session!.update({ tour: 'running', stop: 0 });
    const w = card();
    await vi.advanceTimersByTimeAsync(300);
    expect(w.find('[data-testid="tour-ring"]').exists()).toBe(true);

    target.remove();
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(ANCHOR_WAIT_MS + 500);
    expect(w.find('[data-testid="tour-ring"]').exists(), 'no ring around a node that is gone').toBe(false);
    expect(w.find('[data-testid="tour-missing"]').exists()).toBe(true);
    w.unmount();
  });

  it('on another page, offers to go to the stop instead of dragging the reader there', async () => {
    route.path = '/lab';
    help.session!.update({ tour: 'running', stop: 1 });
    const w = card();
    await flushPromises();
    expect(navigateTo).not.toHaveBeenCalled();
    await w.find('[data-testid="tour-go"]').trigger('click');
    expect(navigateTo).toHaveBeenCalledWith('/train');
    w.unmount();
  });

  it('moves forward to the next stop’s page, and finishes on the last', async () => {
    anchor('step-purpose');
    help.session!.update({ tour: 'running', stop: 0 });
    const w = card();
    await w.find('[data-testid="tour-next"]').trigger('click');
    expect(help.session!.state.value).toMatchObject({ tour: 'running', stop: 1 });
    expect(navigateTo).toHaveBeenLastCalledWith('/train');
    await flushPromises();
    expect(w.find('[data-testid="tour-next"]').text()).toBe('Finish');
    expect(w.find('[data-testid="tour-last"]').exists()).toBe(true);
    await w.find('[data-testid="tour-next"]').trigger('click');
    expect(help.session!.state.value.tour).toBe('finished');
    expect(w.find('[data-testid="tour-card"]').exists()).toBe(false);
    w.unmount();
  });

  it('stops where it is on Esc or End tour, so the help menu can resume it', async () => {
    help.session!.update({ tour: 'running', stop: 1 });
    route.path = '/train';
    const w = card();
    press('Escape');
    expect(help.session!.state.value).toMatchObject({ tour: 'stopped', stop: 1 });

    help.session!.update({ tour: 'running' });
    await flushPromises();
    await w.find('[data-testid="tour-end"]').trigger('click');
    expect(help.session!.state.value).toMatchObject({ tour: 'stopped', stop: 1 });
    w.unmount();
  });

  it('leaves Esc to an open dialog, so closing the shortcut list does not end the tour', () => {
    help.session!.update({ tour: 'running', stop: 0 });
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    const w = card();
    press('Escape');
    expect(help.session!.state.value.tour).toBe('running');
    w.unmount();
  });

  it('leaves Esc to the box the reader is typing in', () => {
    help.session!.update({ tour: 'running', stop: 0 });
    const w = card();
    const box = document.createElement('input');
    document.body.appendChild(box);
    press('Escape', box);
    expect(help.session!.state.value.tour).toBe('running');
    w.unmount();
  });

  it('stops listening for Esc once it is gone', () => {
    help.session!.update({ tour: 'running', stop: 0 });
    card().unmount();
    press('Escape');
    expect(help.session!.state.value.tour).toBe('running');
  });
});
