import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import type { ReviewRow } from './cache';
import { createTrainingCache } from './cache';
import type { ScoreRow } from './types';

let n = 0;

/** Each case gets its own database: fake-indexeddb keeps named ones across a file. */
function open(): ReturnType<typeof createTrainingCache> {
  return createTrainingCache(`test-training-${(n += 1)}`);
}

function score(over: Partial<ScoreRow> = {}): ScoreRow {
  return {
    id: `s-${Math.random()}`,
    mode: 'potodds',
    spot_hash: 'potodds/aaaa',
    question_key: '',
    question: 'What is the minimum defence frequency?',
    prediction: '60',
    actual: '66.7',
    error: -6.7,
    correct: false,
    weight_error: null,
    bucket: 'half pot',
    created_at: '2026-09-07T10:00:00.000Z',
    ...over,
  };
}

function review(over: Partial<ReviewRow> = {}): ReviewRow {
  return {
    spot_hash: 'potodds/aaaa',
    mode: 'potodds',
    box: 1,
    due_at: '2026-09-08T10:00:00.000Z',
    last_seen_at: '2026-09-07T10:00:00.000Z',
    hits: 1,
    misses: 0,
    seed: 17,
    ...over,
  };
}

describe('the training store', () => {
  it('keeps scores in the order they were answered', async () => {
    const cache = open();
    await cache.addScore(score({ id: 'b', created_at: '2026-09-08T10:00:00.000Z' }));
    await cache.addScore(score({ id: 'a', created_at: '2026-09-07T10:00:00.000Z' }));

    expect((await cache.scores()).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('reads back one mode without the others', async () => {
    const cache = open();
    await cache.addScore(score({ id: 'p', mode: 'potodds' }));
    await cache.addScore(score({ id: 'c', mode: 'combos' }));

    expect((await cache.scoresOf('combos')).map((row) => row.id)).toEqual(['c']);
    expect((await cache.scoresOf('drawing'))).toEqual([]);
  });

  it('keeps one review row per spot, replacing it as the spot is answered again', async () => {
    const cache = open();
    await cache.putReview(review({ box: 1 }));
    await cache.putReview(review({ box: 2, hits: 2 }));

    const rows = await cache.reviews('potodds');
    expect(rows.length).toBe(1);
    expect(rows[0]!.box).toBe(2);
    expect(rows[0]!.seed).toBe(17);
  });

  it('keeps each mode\'s reviews apart', async () => {
    const cache = open();
    await cache.putReview(review({ spot_hash: 'potodds/a', mode: 'potodds' }));
    await cache.putReview(review({ spot_hash: 'combos/a', mode: 'combos' }));

    expect((await cache.reviews('potodds')).map((row) => row.spot_hash)).toEqual(['potodds/a']);
  });

  it('accepts a row that came out of a Vue ref, which IndexedDB would otherwise refuse', async () => {
    const cache = open();
    // `reactive()` would throw DataCloneError if the row were not made plain first (F.6's defect).
    const { reactive } = await import('vue');
    await cache.addScore(reactive(score({ id: 'proxied' })) as ScoreRow);

    expect((await cache.scores()).map((row) => row.id)).toEqual(['proxied']);
  });

  it('empties itself when asked', async () => {
    const cache = open();
    await cache.addScore(score());
    await cache.putReview(review());
    await cache.clear();

    expect(await cache.scores()).toEqual([]);
    expect(await cache.reviews('potodds')).toEqual([]);
  });
});
