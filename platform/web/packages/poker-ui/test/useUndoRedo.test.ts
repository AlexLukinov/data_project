import { describe, expect, it } from 'vitest';

import { useUndoRedo } from '../src/composables/useUndoRedo';

function key(k: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, preventDefault: () => undefined, ...mods } as KeyboardEvent;
}

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
