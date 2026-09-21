// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { SHORTCUT_GROUPS } from '~/help/shortcuts';

import ShortcutsOverlay from './ShortcutsOverlay.vue';

function press(key: string, target: EventTarget = document.body): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

/** The overlay bound the way the shell binds it, so `open` round-trips. */
function overlay(open = false) {
  const w = mount(ShortcutsOverlay, {
    attachTo: document.body,
    props: { open, 'onUpdate:open': (next: boolean) => void w.setProps({ open: next }) },
  });
  return w;
}

const dialogOf = (w: ReturnType<typeof overlay>) => w.find('[data-testid="shortcuts-overlay"]').element as HTMLDialogElement;

describe('ShortcutsOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('lists every group and every shortcut of the registry', () => {
    const w = overlay(true);
    expect(w.findAll('[data-testid^="shortcuts-group-"]')).toHaveLength(SHORTCUT_GROUPS.length);
    const rows = SHORTCUT_GROUPS.reduce((total, group) => total + group.shortcuts.length, 0);
    expect(w.findAll('[data-testid="shortcut-row"]')).toHaveLength(rows);
    expect(w.text()).toContain('Commit the answer you typed');
    w.unmount();
  });

  it('opens on ? and closes on ? again', async () => {
    const w = overlay();
    expect(dialogOf(w).open).toBe(false);
    press('?');
    await w.vm.$nextTick();
    expect(w.emitted('update:open')).toEqual([[true]]);
    expect(dialogOf(w).open).toBe(true);
    press('?');
    await w.vm.$nextTick();
    expect(dialogOf(w).open).toBe(false);
    w.unmount();
  });

  it('does not open while the reader is typing ? into a box', async () => {
    const w = overlay();
    const box = document.createElement('input');
    document.body.appendChild(box);
    press('?', box);
    await w.vm.$nextTick();
    expect(w.emitted('update:open')).toBeUndefined();
    w.unmount();
  });

  it('closes from its button, and tells the shell when the dialog closes itself (Esc)', async () => {
    const w = overlay(true);
    await w.find('[data-testid="shortcuts-close"]').trigger('click');
    expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
    await w.setProps({ open: true });
    dialogOf(w).dispatchEvent(new Event('close'));
    expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
    w.unmount();
  });

  it('stops listening once it is gone', () => {
    const w = overlay();
    w.unmount();
    press('?');
    expect(w.emitted('update:open')).toBeUndefined();
  });
});
