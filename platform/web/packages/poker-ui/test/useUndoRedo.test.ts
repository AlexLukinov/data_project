// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import type { UndoRedo } from '../src/composables/useUndoRedo';
import { useUndoRedo, useUndoShortcuts } from '../src/composables/useUndoRedo';

function key(k: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, preventDefault: () => undefined, ...mods } as KeyboardEvent;
}

/** A real key press on `target` that bubbles up to the window, as the browser sends it. */
function press(target: EventTarget, k: string, mods: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(event);
  return event;
}

/** A component that binds `target`'s shortcuts to the window, with a text box and an input inside. */
function host(target: () => UndoRedo<string> | null) {
  const Host = defineComponent({
    setup() {
      useUndoShortcuts(target);
      return () => h('div', [h('textarea'), h('input', { type: 'text' })]);
    },
  });
  return mount(Host, { attachTo: document.body });
}

const same = (a: string, b: string): boolean => a.trim() === b.trim();

describe('useUndoRedo', () => {
  it('walks the history', () => {
    const h = useUndoRedo(1);
    h.set(2);
    h.set(3);
    expect(h.state.value).toBe(3);
    expect(h.canUndo.value).toBe(true);
    h.undo();
    expect(h.state.value).toBe(2);
    h.redo();
    expect(h.state.value).toBe(3);
    h.undo();
    h.set(9); // a new branch drops the redo stack
    expect(h.canRedo.value).toBe(false);
    h.reset(0);
    expect(h.canUndo.value).toBe(false);
  });

  it('ignores a no-op set and bounds the history', () => {
    const h = useUndoRedo(1, 2);
    h.set(1);
    expect(h.canUndo.value).toBe(false);
    h.set(2);
    h.set(3);
    h.set(4);
    h.undo();
    h.undo();
    expect(h.state.value).toBe(2);
    expect(h.canUndo.value).toBe(false);
  });

  it('handles ⌘Z, ⌘⇧Z and Ctrl+Y', () => {
    const h = useUndoRedo('a');
    h.set('b');
    h.onKeydown(key('z', { metaKey: true }));
    expect(h.state.value).toBe('a');
    h.onKeydown(key('z', { metaKey: true, shiftKey: true }));
    expect(h.state.value).toBe('b');
    h.onKeydown(key('z', { ctrlKey: true }));
    h.onKeydown(key('y', { ctrlKey: true }));
    expect(h.state.value).toBe('b');
    h.onKeydown(key('z'));
    expect(h.state.value).toBe('b'); // no modifier: not ours
  });
});

describe('useUndoRedo — sync', () => {
  it('starts the history again when the value from outside is a different one', () => {
    const h = useUndoRedo('a');
    h.set('b');
    h.undo();
    h.sync('c', same);
    expect(h.state.value).toBe('c');
    expect(h.canUndo.value).toBe(false);
    expect(h.canRedo.value).toBe(false);
  });

  it('keeps the history, and the state as it is, when the value from outside says the same thing', () => {
    const h = useUndoRedo('a');
    h.set('b');
    h.set('c');
    h.undo();
    h.sync(' b ', same); // a save of "b" coming back, spelled differently
    expect(h.state.value).toBe('b');
    expect(h.canUndo.value).toBe(true);
    expect(h.canRedo.value).toBe(true);
    h.undo();
    expect(h.state.value).toBe('a');
  });
});

describe('useUndoShortcuts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does nothing when there is no history to point at', () => {
    const wrapper = host(() => null);
    const event = press(window, 'z', { metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    wrapper.unmount();
  });

  it('leaves a press in a text box to the box', () => {
    const h = useUndoRedo('a');
    h.set('b');
    const wrapper = host(() => h);
    const textarea = press(wrapper.find('textarea').element, 'z', { metaKey: true });
    press(wrapper.find('input').element, 'z', { ctrlKey: true });
    expect(h.state.value).toBe('b');
    expect(textarea.defaultPrevented).toBe(false); // the native undo still runs
    wrapper.unmount();
  });

  it('leaves alone a press something nearer the focus already handled', () => {
    const h = useUndoRedo('a');
    h.set('b');
    const wrapper = host(() => h);
    const div = wrapper.element as HTMLElement;
    div.addEventListener('keydown', (event) => event.preventDefault());
    press(div, 'z', { metaKey: true });
    expect(h.state.value).toBe('b');
    wrapper.unmount();
  });

  it('forwards ⌘Z, Ctrl+Z, ⌘⇧Z and Ctrl+Y pressed anywhere else on the page', () => {
    const h = useUndoRedo('a');
    h.set('b');
    const wrapper = host(() => h);
    const undo = press(window, 'z', { metaKey: true });
    expect(h.state.value).toBe('a');
    expect(undo.defaultPrevented).toBe(true);
    press(document.body, 'Z', { metaKey: true, shiftKey: true });
    expect(h.state.value).toBe('b');
    press(wrapper.element, 'z', { ctrlKey: true });
    expect(h.state.value).toBe('a');
    press(window, 'y', { ctrlKey: true });
    expect(h.state.value).toBe('b');
    wrapper.unmount();
  });

  it('stops listening once the component is gone', () => {
    const h = useUndoRedo('a');
    h.set('b');
    host(() => h).unmount();
    press(window, 'z', { metaKey: true });
    expect(h.state.value).toBe('b');
  });
});
