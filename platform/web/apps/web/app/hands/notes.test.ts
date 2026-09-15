import { describe, expect, it, vi } from 'vitest';

import type { SaveState, Timer } from './notes';
import { createAutosave, createHandNotesApi, saveStateText, tagLooksNew } from './notes';

/** A timer the test advances by hand, so a debounce is a statement rather than a wait. */
function fakeTimer(): Timer & { fire(): void; pending(): number } {
  const queue: Array<{ fn: () => void; handle: number }> = [];
  let next = 1;
  return {
    set(fn) {
      const handle = next++;
      queue.push({ fn, handle });
      return handle;
    },
    clear(handle) {
      const at = queue.findIndex((q) => q.handle === handle);
      if (at >= 0) queue.splice(at, 1);
    },
    fire() {
      const due = queue.splice(0, queue.length);
      for (const q of due) q.fn();
    },
    pending: () => queue.length,
  };
}

/** A save the test resolves or rejects by hand, one call at a time. */
function controllableSave() {
  const calls: string[] = [];
  const settle: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  const save = (text: string) =>
    new Promise<void>((resolve, reject) => {
      calls.push(text);
      settle.push({ resolve, reject });
    });
  return { save, calls, settle };
}

const wording = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** An autosave whose every state change is recorded, so a test reads the sequence itself. */
function harness(delayMs = 800) {
  const timer = fakeTimer();
  const { save, calls, settle } = controllableSave();
  const states: Array<[SaveState, string]> = [];
  const auto = createAutosave(save, wording, { delayMs, timer, onState: (s, f) => states.push([s, f]) });
  const last = () => states[states.length - 1]?.[0];
  return { timer, calls, settle, states, auto, last };
}

describe('createAutosave', () => {
  it('saves once, after typing stops, with the last text typed', async () => {
    const h = harness();
    h.auto.change('f');
    h.auto.change('fo');
    h.auto.change('fol');
    expect(h.timer.pending()).toBe(1);
    expect(h.last()).toBe('dirty');

    h.timer.fire();
    expect(h.calls).toEqual(['fol']);
    expect(h.last()).toBe('saving');
    h.settle[0]!.resolve();
    await h.auto.flush();
    expect(h.last()).toBe('saved');
  });

  it('follows a save in flight with another when typing continued, and reports the newest', async () => {
    const h = harness();
    h.auto.change('first');
    h.timer.fire();
    expect(h.calls).toEqual(['first']);

    h.auto.change('first and second');
    h.timer.fire();
    // Still in flight: nothing new is sent until the first lands.
    expect(h.calls).toEqual(['first']);
    h.settle[0]!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.calls).toEqual(['first', 'first and second']);
    // The first save landing was not reported as "saved": the screen held newer text.
    expect(h.states.map(([s]) => s)).toEqual(['dirty', 'saving', 'dirty', 'saving']);
    h.settle[1]!.resolve();
    await h.auto.flush();
    expect(h.last()).toBe('saved');
  });

  it('keeps the text unsaved and words the reason when the server refuses', async () => {
    const h = harness();
    h.auto.change('a note');
    h.timer.fire();
    h.settle[0]!.reject(new Error('The API answered with status 500.'));
    await h.auto.flush();
    expect(h.states[h.states.length - 1]).toEqual(['failed', 'The API answered with status 500.']);
    expect(saveStateText('failed', 'The API answered with status 500.')).toBe('Not saved: The API answered with status 500.');

    // The next keystroke tries again with the newer text.
    h.auto.change('a note, fixed');
    h.timer.fire();
    expect(h.calls).toEqual(['a note', 'a note, fixed']);
    h.settle[1]!.resolve();
    await h.auto.flush();
    expect(h.last()).toBe('saved');
  });

  it('flushes a pending save immediately, for a blur or a page leave', async () => {
    const h = harness();
    h.auto.change('leaving');
    const flushed = h.auto.flush();
    expect(h.timer.pending()).toBe(0);
    expect(h.calls).toEqual(['leaving']);
    h.settle[0]!.resolve();
    await flushed;
    expect(h.last()).toBe('saved');
  });

  it('a flush with nothing to save is a no-op', async () => {
    const h = harness();
    await h.auto.flush();
    expect(h.calls).toEqual([]);
    expect(h.states).toEqual([]);
  });
});

describe('saveStateText', () => {
  it('says nothing when nothing has changed', () => {
    expect(saveStateText('clean', '')).toBe('');
    expect(saveStateText('dirty', '')).toBe('Unsaved changes');
    expect(saveStateText('saving', '')).toBe('Saving…');
    expect(saveStateText('saved', '')).toBe('Saved');
  });
});

describe('tagLooksNew', () => {
  it('compares the way the server does', () => {
    expect(tagLooksNew('Bluff', ['bluff'])).toBe(false);
    expect(tagLooksNew('  3-bet   pot ', ['3-bet pot'])).toBe(false);
    expect(tagLooksNew('river', ['bluff'])).toBe(true);
    expect(tagLooksNew('   ', [])).toBe(false);
  });
});

describe('createHandNotesApi', () => {
  it('speaks the routes as the API declares them, with the tag in the path encoded', async () => {
    const seen: Array<[string, unknown]> = [];
    const fetch = vi.fn(async (url: string, options?: { method?: string; body?: unknown }) => {
      seen.push([url, options]);
      return {} as never;
    });
    const api = createHandNotesApi(fetch);
    await api.note('abc');
    await api.saveNote('abc', 'text');
    await api.addTag('abc', 'Bluff');
    await api.removeTag('abc', '3-bet pot');
    await api.vocabulary();
    expect(seen).toEqual([
      ['/v1/hands/abc/note', undefined],
      ['/v1/hands/abc/note', { method: 'PUT', body: { body: 'text' } }],
      ['/v1/hands/abc/tags', { method: 'POST', body: { tag: 'Bluff' } }],
      ['/v1/hands/abc/tags/3-bet%20pot', { method: 'DELETE' }],
      ['/v1/hands/tags', undefined],
    ]);
  });
});
