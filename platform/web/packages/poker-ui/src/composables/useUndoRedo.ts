/**
 * Undo/redo for any immutable value (spec §13): `set()` pushes, `undo()`/`redo()` walk the
 * history, and `onKeydown` handles Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (Ctrl+Y too). The value
 * must be replaced, never mutated — `WeightedRange` operations already work that way.
 */

import type { ComputedRef, Ref } from 'vue';
import { computed, ref, shallowRef } from 'vue';

export interface UndoRedo<T> {
  readonly state: Ref<T>;
  readonly canUndo: ComputedRef<boolean>;
  readonly canRedo: ComputedRef<boolean>;
  set(next: T): void;
  undo(): void;
  redo(): void;
  reset(next: T): void;
  /** Bind to `keydown` on the element or window that should react to the shortcuts. */
  onKeydown(event: KeyboardEvent): void;
}

const DEFAULT_LIMIT = 200;

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
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && event.shiftKey) redo();
    else if (key === 'z') undo();
    else if (key === 'y') redo();
    else return;
    event.preventDefault();
  }

  return { state, canUndo: computed(() => past.value.length > 0), canRedo: computed(() => future.value.length > 0), set, undo, redo, reset, onKeydown };
}
