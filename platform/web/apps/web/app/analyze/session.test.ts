/**
 * The autosave, which is where an analyzer loses work.
 *
 * Every test here is about something that must survive: a step saved while another is being
 * typed, a server that has gone away, a tab that was closed before the debounce fired.
 */
import { nodeKey } from '@poker/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalysesApi, Analysis, AnalysisUpdate } from './api';
import { emptyStep, emptyWork } from './api';
import type { AnalysisCache, CachedAnalysis } from './cache';
import { completedSteps, createAnalysisSession, stepOf } from './session';

const KEY = nodeKey('BB', { villain_position: 'CO', street: 'flop' });
const DELAY = 100;

function analysis(id = 'a1'): Analysis {
  return {
    id,
    title: 'BB vs CO on a paired flop',
    source: 'manual',
    hand_uid: '',
    node_key: KEY,
    current_step: 1,
    completed_steps: [],
    heuristic: '',
    tags: [],
    created_at: '2026-09-10T09:00:00Z',
    updated_at: '2026-09-10T09:00:00Z',
    hand_text: '',
    action_index: 0,
    steps: [],
  };
}

/** A server that records what it was asked to save, and can be taken away. */
function fakeApi(row: Analysis, flags: { down: boolean }) {
  const saves: AnalysisUpdate[] = [];
  const api: AnalysesApi = {
    list: async () => [],
    get: async () => {
      if (flags.down) throw new TypeError('fetch failed');
      return structuredClone(row);
    },
    create: async () => structuredClone(row),
    update: async (_id, body) => {
      if (flags.down) throw new TypeError('fetch failed');
      saves.push(structuredClone(body));
      return { ...structuredClone(row), updated_at: '2026-09-10T11:00:00Z' };
    },
    remove: async () => undefined,
  };
  return { api, saves };
}

function fakeCache() {
  const rows = new Map<string, CachedAnalysis>();
  const cache: AnalysisCache = {
    put: async (a, unsaved) => void rows.set(a.id, { ...structuredClone(a), cached_at: 'now', unsaved }),
    get: async (id) => rows.get(id),
    all: async () => [...rows.values()],
    remove: async (id) => void rows.delete(id),
    clear: async () => rows.clear(),
  };
  return { cache, rows };
}

function committed(step: number) {
  return {
    ...emptyStep(step),
    prediction: {
      question: 'q',
      answer_type: 'percent' as const,
      answer: '55',
      actual: '',
      error: null,
      within_tolerance: null,
      committed_at: '2026-09-10T10:00:00Z',
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createAnalysisSession', () => {
  it('sends only the steps that changed, so a save cannot wipe the earlier ones', async () => {
    const flags = { down: false };
    const { api, saves } = fakeApi(analysis(), flags);
    const session = createAnalysisSession(api, fakeCache().cache, { delayMs: DELAY });
    await session.open('a1');

    session.patchStep(1, committed(1));
    session.patchStep(2, committed(2));
    await session.flush();

    expect(saves).toHaveLength(1);
    expect(saves[0]!.steps!.map((s) => s.step)).toEqual([1, 2]);

    session.patchStep(5, committed(5));
    await session.flush();
    expect(saves[1]!.steps!.map((s) => s.step)).toEqual([5]);
    // …and the analysis in hand still holds all three.
    expect(completedSteps(session.analysis.value)).toEqual([1, 2, 5]);
  });

  it('waits for the typing to stop before saving', async () => {
    const flags = { down: false };
    const { api, saves } = fakeApi(analysis(), flags);
    const session = createAnalysisSession(api, fakeCache().cache, { delayMs: DELAY });
    await session.open('a1');

    session.patchStep(1, { takeaway: 'they' });
    session.patchStep(1, { takeaway: 'they fold' });
    session.patchStep(1, { takeaway: 'they fold too much' });
    expect(saves).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(DELAY);
    expect(saves).toHaveLength(1);
    expect(saves[0]!.steps![0]!.takeaway).toBe('they fold too much');
  });

  it('keeps the work and says so when the server refuses', async () => {
    const flags = { down: false };
    const { api, saves } = fakeApi(analysis(), flags);
    const { cache, rows } = fakeCache();
    const session = createAnalysisSession(api, cache, { delayMs: DELAY });
    await session.open('a1');

    flags.down = true;
    session.patchStep(3, committed(3));
    await session.flush();

    expect(session.status.value).toBe('offline');
    expect(rows.get('a1')!.unsaved).toBe(true);
    expect(rows.get('a1')!.steps.map((s) => s.step)).toEqual([3]);

    // The next save retries what the failed one was carrying.
    flags.down = false;
    session.setHeuristic('bluff more on paired boards');
    await session.flush();
    expect(saves[0]!.steps!.map((s) => s.step)).toEqual([3]);
    expect(saves[0]!.heuristic).toBe('bluff more on paired boards');
    expect(session.status.value).toBe('saved');
  });

  it('reopens from the browser copy when the server is away', async () => {
    const flags = { down: false };
    const { api } = fakeApi(analysis(), flags);
    const { cache } = fakeCache();
    const first = createAnalysisSession(api, cache, { delayMs: DELAY });
    await first.open('a1');
    first.patchStep(4, { takeaway: 'written offline' });
    flags.down = true;
    await first.flush();

    const second = createAnalysisSession(api, cache, { delayMs: DELAY });
    await second.open('a1');
    expect(stepOf(second.analysis.value, 4).takeaway).toBe('written offline');
    expect(second.status.value).toBe('offline');
  });

  it('prefers the unsaved local copy over the server\'s older one', async () => {
    const flags = { down: false };
    const { api } = fakeApi(analysis(), flags);
    const { cache } = fakeCache();
    const session = createAnalysisSession(api, cache, { delayMs: DELAY });
    await session.open('a1');

    flags.down = true;
    session.patchStep(6, { work: { ...emptyWork(), choice: 'bet' } });
    session.patchStep(6, { takeaway: 'only in the browser' });
    await session.flush();
    flags.down = false;

    const reopened = createAnalysisSession(api, cache, { delayMs: DELAY });
    await reopened.open('a1');
    expect(stepOf(reopened.analysis.value, 6).takeaway).toBe('only in the browser');
  });

  it('has an empty step for every step nobody has reached', () => {
    expect(stepOf(null, 7)).toEqual(emptyStep(7));
    expect(stepOf(analysis(), 7).work.board).toBe('');
  });
});
