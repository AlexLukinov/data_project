/**
 * Undo/redo for any immutable value (spec §13): `set()` pushes, `undo()`/`redo()` walk the
 * history, and `onKeydown` handles Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (Ctrl+Y too). The value
 * must be replaced, never mutated — `WeightedRange` operations already work that way.
 * `useUndoShortcuts` binds those keys to the window for as long as a component is mounted.
 */

import type { ComputedRef, Ref } from 'vue';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';

export interface UndoRedo<T> {
  readonly state: Ref<T>;
  readonly canUndo: ComputedRef<boolean>;
  readonly canRedo: ComputedRef<boolean>;
  set(next: T): void;
  undo(): void;
  redo(): void;
  reset(next: T): void;
  /**
   * Follow a value that changed outside the history — a load, a save coming back, an autosaved
   * copy. When `same(state, next)` the history is kept and the state left as it is (it already
   * says the same thing, so the reader's undo still means something); otherwise the history
   * starts again at `next`.
   */
  sync(next: T, same: (a: T, b: T) => boolean): void;
  /** Bind to `keydown` on the element that should react to the shortcuts, or hand the history to `useUndoShortcuts`. */
  onKeydown(event: KeyboardEvent): void;
}

const DEFAULT_LIMIT = 200;

/** Which way a key press walks the history; null when it is not one of the shortcuts. */
function walkOf(event: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return key === 'y' ? 'redo' : null;
}

/** A history for one value, starting at `initial` and keeping at most `limit` steps back. */
export function useUndoRedo<T>(initial: T, limit = DEFAULT_LIMIT): UndoRedo<T> {
  const state = shallowRef(initial) as Ref<T>;
  const past = ref<T[]>([]) as Ref<T[]>;
  const future = ref<T[]>([]) as Ref<T[]>;

  function set(next: T): void {
    if (next === state.value) return;
    past.value.push(state.value);
    if (past.value.length > limit) past.value.shift();
    future.value = [];
    state.value = next;
  }

  function undo(): void {
    const previous = past.value.pop();
    if (previous === undefined) return;
    future.value.push(state.value);
    state.value = previous;
  }

  function redo(): void {
    const next = future.value.pop();
    if (next === undefined) return;
    past.value.push(state.value);
    state.value = next;
  }

  function reset(next: T): void {
    past.value = [];
    future.value = [];
    state.value = next;
  }

  function onKeydown(event: KeyboardEvent): void {
    const walk = walkOf(event);
    if (walk === null) return;
    if (walk === 'undo') undo();
    else redo();
    event.preventDefault();
  }

  function sync(next: T, same: (a: T, b: T) => boolean): void {
    if (!same(state.value, next)) reset(next);
  }

  return { state, canUndo: computed(() => past.value.length > 0), canRedo: computed(() => future.value.length > 0), set, undo, redo, reset, sync, onKeydown };
}

const TYPING_TAGS: readonly string[] = ['INPUT', 'TEXTAREA', 'SELECT'];

/** Whether a key press came from a box the reader is typing in — a box keeps its own native undo. */
function isTyping(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLElement> | null;
  return element?.isContentEditable === true || TYPING_TAGS.includes(element?.tagName ?? '');
}

/**
 * Bind a history's shortcuts to the window while the calling component is mounted, so ⌘Z works
 * wherever focus is — a matrix cell takes no focus when it is painted, so a binding on an element
 * would miss most presses. Presses in a text box are left to the box, and a press something nearer
 * the focus already handled is left alone. `target` is read on every press: a page points it at
 * the history edited last, or at none (`null`) while there is nothing to edit.
 */
export function useUndoShortcuts(target: () => Pick<UndoRedo<unknown>, 'onKeydown'> | null | undefined): void {
  function onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || isTyping(event.target)) return;
    target()?.onKeydown(event);
  }
  onMounted(() => window.addEventListener('keydown', onKey));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
}
