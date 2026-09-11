/**
 * The heuristic log: it works with the server away, it asks its question after fourteen days,
 * and answering the question is what resets the clock.
 */

import { HEURISTIC_REVIEW_DAYS } from '@poker/core';
import { describe, expect, it } from 'vitest';

import type { Heuristic, HeuristicBody, HeuristicCandidate, HeuristicsApi } from './api';
import type { HeuristicCache, LocalHeuristic } from './cache';
import { createHeuristicLog, dueAt, isDue, merge, ordered } from './log';

const DAY = 86_400_000;
const MONDAY = new Date('2026-09-07T10:00:00.000Z');

function at(offset: number): Date {
  return new Date(MONDAY.getTime() + offset * DAY);
}

function serverRow(over: Partial<Heuristic> = {}): Heuristic {
  return {
    id: 'srv-1',
    analysis_id: null,
    text: 'Bluff more on paired turns against the blinds.',
    street: 'turn',
    position: 'BTN',
    texture: 'paired',
    tags: [],
    status: 'open',
    confirmed_at: null,
    review_due_at: '2026-09-21T10:00:00.000Z',
    is_due: false,
    created_at: MONDAY.toISOString(),
    updated_at: MONDAY.toISOString(),
    ...over,
  };
}

interface FakeApi extends HeuristicsApi {
  readonly created: HeuristicBody[];
  readonly updated: { id: string; body: HeuristicBody }[];
  readonly removed: string[];
  down: boolean;
}

/**
 * Stands in for `/v1/heuristics`, including the one behaviour the log depends on: sending a
 * `status` is what stamps `confirmed_at` server-side (`heuristic_store.apply_update`).
 */
function fakeApi(
  rows: Heuristic[] = [],
  candidates: HeuristicCandidate[] = [],
  now: () => Date = () => MONDAY,
): FakeApi {
  let n = 0;
  const api: FakeApi = {
    created: [],
    updated: [],
    removed: [],
    down: false,
    list: () => (api.down ? Promise.reject(new Error('no answer')) : Promise.resolve([...rows])),
    candidates: () => (api.down ? Promise.reject(new Error('no answer')) : Promise.resolve(candidates)),
    create: (body) => {
      if (api.down) return Promise.reject(new Error('no answer'));
      api.created.push(body);
      const row = serverRow({ id: `srv-new-${(n += 1)}`, text: body.text ?? '' });
      rows.push(row);
      return Promise.resolve(row);
    },
    update: (id, body) => {
      if (api.down) return Promise.reject(new Error('no answer'));
      api.updated.push({ id, body });
      const stamped = body.status === undefined ? {} : { confirmed_at: now().toISOString() };
      return Promise.resolve(serverRow({ id, ...body, tags: [...(body.tags ?? [])], ...stamped }));
    },
    remove: (id) => {
      if (api.down) return Promise.reject(new Error('no answer'));
      api.removed.push(id);
      return Promise.resolve();
    },
  };
  return api;
}

function fakeCache(): HeuristicCache & { rows: Map<string, LocalHeuristic> } {
  const rows = new Map<string, LocalHeuristic>();
  return {
    rows,
    all: () => Promise.resolve([...rows.values()]),
    put: (row) => {
      rows.set(row.local_id, structuredClone(row));
      return Promise.resolve();
    },
    remove: (localId) => {
      rows.delete(localId);
      return Promise.resolve();
    },
    clear: () => {
      rows.clear();
      return Promise.resolve();
    },
  };
}

function logFor(api: HeuristicsApi, cache: HeuristicCache, now = MONDAY) {
  let n = 0;
  return createHeuristicLog(api, cache, { now: () => now, id: () => `local-${(n += 1)}` });
}

describe('the fourteen-day prompt', () => {
  it('uses the same interval the server does', () => {
    expect(HEURISTIC_REVIEW_DAYS).toBe(14); // `REVIEW_DAYS` in api/schemas_heuristics.py
  });

  it('falls fourteen days after the lesson was written', () => {
    const row = local({ created_at: MONDAY.toISOString() });
    expect(dueAt(row)).toBe('2026-09-21T10:00:00.000Z');
    expect(isDue(row, at(13))).toBe(false);
    expect(isDue(row, at(14))).toBe(true);
  });

  it('runs from the last answer once there has been one', () => {
    const row = local({ created_at: MONDAY.toISOString(), confirmed_at: at(10).toISOString() });
    expect(isDue(row, at(20))).toBe(false);
    expect(isDue(row, at(24))).toBe(true);
  });

  it('never asks about a lesson that was retired', () => {
    expect(isDue(local({ status: 'retired' }), at(100))).toBe(false);
  });

  it('puts what is owed a review at the top of the list', () => {
    const old = local({ local_id: 'old', created_at: at(-60).toISOString() });
    const fresh = local({ local_id: 'fresh', created_at: at(-1).toISOString() });
    const newest = local({ local_id: 'newest', created_at: MONDAY.toISOString() });
    expect(ordered([newest, fresh, old], MONDAY).map((r) => r.local_id)).toEqual([
      'old',
      'newest',
      'fresh',
    ]);
  });
});

function local(over: Partial<LocalHeuristic> = {}): LocalHeuristic {
  return {
    local_id: 'local-1',
    server_id: null,
    text: 'Bet smaller on monotone flops out of position.',
    analysis_id: null,
    street: 'flop',
    position: 'BB',
    texture: 'monotone',
    tags: [],
    status: 'open',
    confirmed_at: null,
    created_at: MONDAY.toISOString(),
    updated_at: MONDAY.toISOString(),
    unsaved: false,
    ...over,
  };
}

describe('writing a heuristic', () => {
  it('keeps it and pushes it when the server is there', async () => {
    const api = fakeApi();
    const cache = fakeCache();
    const log = logFor(api, cache);

    await log.add({ text: '  Check back more on low paired flops.  ', street: 'flop' });

    expect(api.created.length).toBe(1);
    expect(api.created[0]!.text).toBe('Check back more on low paired flops.'); // trimmed
    expect(log.items.value[0]!.unsaved).toBe(false);
    expect(log.items.value[0]!.server_id).toBe('srv-new-1');
    expect([...cache.rows.values()][0]!.server_id).toBe('srv-new-1');
  });

  it('keeps it anyway when the server is away, and says so', async () => {
    const api = fakeApi();
    api.down = true;
    const cache = fakeCache();
    const log = logFor(api, cache);

    await log.add({ text: 'Three-bet the small blind wider against late opens.' });

    expect(log.items.value.length).toBe(1);
    expect(log.items.value[0]!.unsaved).toBe(true);
    expect(log.items.value[0]!.server_id).toBeNull();
    expect(log.status.value).toBe('offline');
    expect(log.error.value).not.toBe('');
  });

  it('pushes what was written offline the next time the log loads', async () => {
    const api = fakeApi();
    const cache = fakeCache();
    api.down = true;
    const first = logFor(api, cache);
    await first.add({ text: 'Fold more turns out of position.' });
    expect(first.items.value[0]!.unsaved).toBe(true);

    api.down = false;
    const second = logFor(api, cache);
    await second.load();

    expect(api.created.length).toBe(1);
    expect(second.items.value.every((row) => !row.unsaved)).toBe(true);
  });
});

describe('answering "still true?"', () => {
  it('stamps the answer and resets the clock, whichever answer it is', async () => {
    const api = fakeApi([serverRow({ created_at: MONDAY.toISOString() })], [], () => at(20));
    const cache = fakeCache();
    const log = logFor(api, cache, at(20));
    await cache.put(local({ server_id: 'srv-1', created_at: MONDAY.toISOString() }));
    await log.load();
    expect(isDue(log.items.value[0]!, at(20))).toBe(true);

    await log.answer(log.items.value[0]!.local_id, 'confirmed');

    const answered = log.items.value[0]!;
    expect(answered.status).toBe('confirmed');
    expect(answered.confirmed_at).toBe(at(20).toISOString());
    expect(isDue(answered, at(30))).toBe(false); // 14 days from day 20, not from day 0
    expect(api.updated[0]!.body.status).toBe('confirmed');
  });

  it('keeps the answer when the server refuses it', async () => {
    const api = fakeApi([serverRow()]);
    const cache = fakeCache();
    const log = logFor(api, cache, at(20));
    await log.load();
    api.down = true;

    await log.answer(log.items.value[0]!.local_id, 'retired');

    expect(log.items.value[0]!.status).toBe('retired');
    expect(log.items.value[0]!.unsaved).toBe(true);
    expect(log.status.value).toBe('offline');
  });
});

describe('loading', () => {
  it('reads the browser copy first, so the list is there before the server answers', async () => {
    const api = fakeApi();
    api.down = true;
    const cache = fakeCache();
    await cache.put(local({ local_id: 'cached' }));
    const log = logFor(api, cache);

    await log.load();

    expect(log.items.value.map((row) => row.local_id)).toEqual(['cached']);
    expect(log.status.value).toBe('offline');
  });

  it('lets the server win for anything already saved', () => {
    const mine = local({ local_id: 'a', server_id: 'srv-1', text: 'stale', unsaved: false });
    const theirs = local({ local_id: 'a', server_id: 'srv-1', text: 'fresh', unsaved: false });
    expect(merge([mine], [theirs]).map((r) => r.text)).toEqual(['fresh']);
  });

  it('never lets the server overwrite a change that has not been pushed', () => {
    const mine = local({ local_id: 'a', server_id: 'srv-1', text: 'my edit', unsaved: true });
    const theirs = local({ local_id: 'a', server_id: 'srv-1', text: 'old', unsaved: false });
    expect(merge([mine], [theirs]).map((r) => r.text)).toEqual(['my edit']);
  });

  it('drops a saved row the server no longer has', () => {
    const mine = local({ local_id: 'a', server_id: 'srv-gone', unsaved: false });
    expect(merge([mine], [])).toEqual([]);
  });
});

describe('adopting a step-9 takeaway', () => {
  it('writes it into the log with the analysis it came from, and stops offering it', async () => {
    const candidate: HeuristicCandidate = {
      analysis_id: 'an-1',
      title: 'BB bet vs CO turn',
      heuristic: 'The CO overfolds this turn — bluff it more.',
      node_key: null,
      created_at: MONDAY.toISOString(),
    };
    const api = fakeApi([], [candidate]);
    const cache = fakeCache();
    const log = logFor(api, cache);
    await log.load();
    expect(log.candidates.value.length).toBe(1);

    await log.adopt(candidate);

    expect(api.created[0]!.analysis_id).toBe('an-1');
    expect(api.created[0]!.text).toBe('The CO overfolds this turn — bluff it more.');
    expect(log.candidates.value).toEqual([]);
  });
});

describe('removing', () => {
  it('drops it here and at the server', async () => {
    const api = fakeApi([serverRow()]);
    const cache = fakeCache();
    const log = logFor(api, cache);
    await log.load();

    await log.remove(log.items.value[0]!.local_id);

    expect(log.items.value).toEqual([]);
    expect(api.removed).toEqual(['srv-1']);
    expect(cache.rows.size).toBe(0);
  });

  it('drops a row the server never saw without calling it', async () => {
    const api = fakeApi();
    api.down = true;
    const cache = fakeCache();
    const log = logFor(api, cache);
    await log.add({ text: 'Never pushed.' });

    await log.remove(log.items.value[0]!.local_id);

    expect(log.items.value).toEqual([]);
    expect(api.removed).toEqual([]);
  });
});
