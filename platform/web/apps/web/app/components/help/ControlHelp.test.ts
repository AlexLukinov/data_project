// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

import { controlById } from '~/help/controls';
import { attachedControls, clearHighlight, highlightControl, setAttachedControls } from '~/help/explainer';

import ControlHelp from './ControlHelp.vue';

/* Read back from the catalogue rather than quoted: what this file is testing is that the
   component renders the entry, and a copy edit in `help/controls/` should fail `controls.test.ts`,
   which guards the words, not a component test that only ever borrowed one of them. */
const MIN_N = controlById('min-n')!;

const route = reactive({ fullPath: '/reports' });

function control(testid: string, tag = 'select'): HTMLElement {
  const element = document.createElement(tag);
  element.dataset.testid = testid;
  element.scrollIntoView = vi.fn();
  document.body.appendChild(element);
  return element;
}

function layer() {
  return mount(ControlHelp, { attachTo: document.body });
}

const tip = (w: ReturnType<typeof layer>, id: string) => w.get(`[data-testid="control-tip-${id}"]`);
const shown = (w: ReturnType<typeof layer>, id: string) => tip(w, id).attributes('hidden') === undefined;

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('ControlHelp', () => {
  beforeEach(() => {
    vi.stubGlobal('useRoute', () => route);
    setAttachedControls([]);
    clearHighlight();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('attaches to a control by its own testid, without putting anything inside it', () => {
    const select = control('minn-select');
    const w = layer();
    expect(select.dataset.help).toBe('min-n');
    expect(select.getAttribute('aria-describedby')).toBe('control-help-min-n');
    expect(select.childElementCount).toBe(0);
    w.unmount();
  });

  it('makes a control nothing can focus reachable by Tab, and leaves the rest alone', async () => {
    const label = control('study-node', 'span');
    const picker = control('stat-picker', 'section');
    picker.innerHTML = '<button type="button">a stat</button>';
    const w = layer();
    expect(label.getAttribute('tabindex')).toBe('0');
    expect(picker.getAttribute('tabindex')).toBeNull();
    w.unmount();
  });

  it('keeps that tab stop however many times the page changes under it', async () => {
    const label = control('study-node', 'span');
    const w = layer();
    for (let i = 0; i < 4; i += 1) {
      document.body.appendChild(document.createElement('div')).remove();
      await frame();
      await frame();
      expect(label.getAttribute('tabindex'), `scan ${i + 2}`).toBe('0');
    }
    w.unmount();
  });

  it('takes the tab stop away again if the control grows something focusable of its own', async () => {
    const label = control('study-node', 'span');
    const w = layer();
    expect(label.getAttribute('tabindex')).toBe('0');
    label.appendChild(document.createElement('button'));
    await frame();
    await frame();
    expect(label.getAttribute('tabindex')).toBeNull();
    w.unmount();
  });

  it('keeps a description the control already had', () => {
    const select = control('minn-select');
    select.setAttribute('aria-describedby', 'its-own-note');
    const w = layer();
    expect(select.getAttribute('aria-describedby')).toBe('its-own-note control-help-min-n');
    w.unmount();
  });

  it('opens on hover, on focus and on a tap, and closes on Escape', async () => {
    const select = control('minn-select');
    const w = layer();
    expect(shown(w, 'min-n')).toBe(false);

    select.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await w.vm.$nextTick();
    expect(shown(w, 'min-n')).toBe(true);
    expect(tip(w, 'min-n').text()).toContain(MIN_N.does);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await w.vm.$nextTick();
    expect(shown(w, 'min-n')).toBe(false);

    select.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await w.vm.$nextTick();
    expect(shown(w, 'min-n')).toBe(true);

    select.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    await w.vm.$nextTick();
    expect(shown(w, 'min-n')).toBe(true);
    w.unmount();
  });

  it('attaches a control that arrives after the page has already rendered', async () => {
    const w = layer();
    expect(attachedControls.value).toEqual([]);
    const select = control('minn-select');
    await frame();
    await w.vm.$nextTick();
    expect(select.dataset.help).toBe('min-n');
    expect(attachedControls.value).toEqual(['min-n']);
    w.unmount();
  });

  it('publishes what is on the page, so the explainer can list exactly those controls', () => {
    control('minn-select');
    control('stat-picker', 'section');
    const w = layer();
    expect([...attachedControls.value].sort()).toEqual(['min-n', 'stat-picker']);
    w.unmount();
  });

  it('points at a control the explainer asks for, ringing it and scrolling it into view', async () => {
    const select = control('minn-select');
    const w = layer();
    highlightControl('min-n');
    await w.vm.$nextTick();
    expect(select.scrollIntoView).toHaveBeenCalled();
    expect(w.find('[data-testid="control-help-ring"]').exists()).toBe(true);
    expect(shown(w, 'min-n')).toBe(true);
    w.unmount();
  });

  it('ignores an element that is not an explained control', () => {
    const stray = control('not-a-control');
    const w = layer();
    expect(stray.dataset.help).toBeUndefined();
    expect(stray.getAttribute('aria-describedby')).toBeNull();
    w.unmount();
  });
});
