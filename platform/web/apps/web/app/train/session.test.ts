/**
 * The training run: the truth is never asked for before the commit, a score is written once, and
 * what comes next is the schedule's choice.
 */

import type { EquityServiceLike, PredictionOutcome } from '@poker/ui';
import { scorePrediction } from '@poker/ui';
import { computeEquity } from '@poker/core';
import { describe, expect, it, vi } from 'vitest';

import type { ReviewRow, TrainingCache } from './cache';
import { createTrainer } from './session';
import type { ScoreRow, TrainMode } from './types';

const DAY = 86_400_000;
const MONDAY = new Date('2026-09-07T10:00:00.000Z');

interface Fake extends TrainingCache {
  readonly rows: ScoreRow[];
  readonly states: ReviewRow[];
}

/** `structuredClone` on the way in, exactly as IndexedDB would: a Vue proxy must not get through. */
function fakeCache(seed: ReviewRow[] = []): Fake {
  const rows: ScoreRow[] = [];
  const states: ReviewRow[] = [...seed];
  return {
    rows,
    states,
    addScore: (row) => {
      rows.push(structuredClone(row));
      return Promise.resolve();
    },
    scores: () => Promise.resolve([...rows]),
    scoresOf: (mode) => Promise.resolve(rows.filter((row) => row.mode === mode)),
    putReview: (row) => {
      const at = states.findIndex((state) => state.spot_hash === row.spot_hash);
      const copy = structuredClone(row);
      if (at < 0) states.push(copy);
      else states[at] = copy;
      return Promise.resolve();
    },
    reviews: (mode) => Promise.resolve(states.filter((state) => state.mode === mode)),
    clear: () => Promise.resolve(),
  };
}

const noService: EquityServiceLike = {
  compute: () => Promise.reject(new Error('the equity service was asked for nothing')),
  cancel: () => true,
};

const realService: EquityServiceLike = {
  compute: (request, options) => computeEquity(request, options),
  cancel: () => true,
};

function trainerFor(
  mode: TrainMode,
  cache: Fake,
  options: { now?: Date; service?: EquityServiceLike } = {},
) {
  let n = 0;
  let ids = 0;
  return createTrainer(mode, {
    cache,
    service: options.service ?? noService,
    now: () => options.now ?? MONDAY,
    seed: () => (n += 1),
    id: () => `id-${(ids += 1)}`,
  });
}

/** Answer the spot on screen with whatever is asked for, right or wrong. */
function answer(given: string, actual: string): PredictionOutcome {
  return scorePrediction(given, actual, 'percent', 3);
}

describe('a training run', () => {
  it('serves a spot with no truth attached to it', async () => {
    const cache = fakeCache();
    const trainer = trainerFor('potodds', cache);
    await trainer.start();

    expect(trainer.status.value).toBe('asking');
    expect(trainer.spot.value).not.toBeNull();
    expect(trainer.truth.value).toEqual({});
    expect(trainer.repeat.value).toBe(false);
  });

  it('works the answer out only once a prediction has been committed', async () => {
    const cache = fakeCache();
    const trainer = trainerFor('potodds', cache);
    await trainer.start();
    expect(trainer.truth.value).toEqual({});

    trainer.commit('', '55');
    await Promise.resolve();
    await Promise.resolve();

    expect(trainer.status.value).toBe('revealed');
    expect(trainer.truth.value['']).toBeDefined();
  });

  it('waits for every question of a two-part spot before revealing either answer', async () => {
    const cache = fakeCache();
    const trainer = trainerFor('advantage', cache, { service: realService });
    await trainer.start();
    expect(trainer.spot.value?.questions.length).toBe(2);

    trainer.commit('side', 'hero');
    await Promise.resolve();
    expect(trainer.truth.value).toEqual({});

    trainer.commit('nut', '60');
    await vi.waitUntil(() => trainer.status.value === 'revealed', { timeout: 20_000 });
    expect(trainer.truth.value.side).toBeDefined();
    expect(trainer.truth.value.nut).toBeDefined();
  }, 30_000);

  it('says why there is no answer rather than waiting for one for ever', async () => {
    const cache = fakeCache();
    const trainer = trainerFor('equity', cache); // the equity mode needs the service, which throws
    await trainer.start();

    trainer.commit('', '50');
    await vi.waitUntil(() => trainer.status.value === 'revealed');
    expect(trainer.unavailable.value).not.toBe('');
    expect(trainer.truth.value).toEqual({});
  });
});

describe('recording an answer', () => {
  it('writes one score row and one review row, and counts it once', async () => {
    const cache = fakeCache();
    const trainer = trainerFor('potodds', cache);
    await trainer.start();
    const hash = trainer.spot.value!.hash;

    await trainer.settle('', answer('50', '50'));
    await trainer.settle('', answer('50', '50')); // the gate re-emits; this must be ignored

    expect(cache.rows.length).toBe(1);
    expect(cache.rows[0]!.mode).toBe('potodds');
    expect(cache.rows[0]!.spot_hash).toBe(hash);
    expect(cache.rows[0]!.correct).toBe(true);
    expect(cache.rows[0]!.bucket).not.toBe('');
    expect(cache.states.length).toBe(1);
    expect(trainer.served.value).toBe(1);
    expect(trainer.right.value).toBe(1);
  });

  it('keeps the seed on the review row, which is the only way a spot comes back', async () => {
    const cache = fakeCache();
    const trainer = trainerFor('potodds', cache);
    await trainer.start();
    const seed = trainer.spot.value!.seed;

    await trainer.settle('', answer('10', '50'));
    expect(cache.states[0]!.seed).toBe(seed);
    expect(cache.states[0]!.box).toBe(0); // a miss goes back to the start
    expect(cache.states[0]!.misses).toBe(1);
  });

  it('schedules the two halves of an advantage spot separately', async () => {
    const cache = fakeCache();
    const trainer = trainerFor('advantage', cache, { service: realService });
    await trainer.start();
    const hash = trainer.spot.value!.hash;

    await trainer.settle('side', scorePrediction('hero', 'hero', 'choice'));
    await trainer.settle('nut', answer('10', '80'));

    expect(cache.rows.map((row) => row.question_key).sort()).toEqual(['nut', 'side']);
    // Each half schedules under its own key, so knowing who is ahead and knowing how the nuts
    // split come back on their own intervals.
    expect(cache.states.map((row) => row.spot_hash).sort()).toEqual([`${hash}#nut`, `${hash}#side`]);
  });

  it('scores the range drawing on total weight error, not on how wide the guess was', async () => {
    const cache = fakeCache();
    const trainer = trainerFor('drawing', cache);
    await trainer.start();

    // The width was guessed exactly, but the range drawn was nothing like the chart.
    const drawing = trainer.spot.value!;
    const tolerance = drawing.mode === 'drawing' ? drawing.weightTolerance : 0;
    await trainer.settle('', answer('200', '200'), tolerance + 1);

    expect(cache.rows[0]!.correct).toBe(false);
    expect(cache.rows[0]!.weight_error).toBe(tolerance + 1);
  });
});

describe('what comes next', () => {
  it('re-serves a missed spot before inventing a new one', async () => {
    const cache = fakeCache();
    const trainer = trainerFor('potodds', cache);
    await trainer.start();
    const missed = trainer.spot.value!;

    await trainer.settle('', answer('10', '50')); // wrong: due again at once
    await trainer.next(); // a different spot, because the missed one is on screen no longer
    expect(trainer.spot.value!.hash).not.toBe(missed.hash);

    await trainer.next();
    expect(trainer.spot.value!.hash).toBe(missed.hash);
    expect(trainer.repeat.value).toBe(true);
  });

  it('records the second answer to a spot that came back, not only the first', async () => {
    // Found in Chrome: the guard against the gate's repeated `reveal` was keyed on the spot and
    // never cleared, so a re-served spot was answered but never scored — eight answers, four rows.
    const cache = fakeCache();
    const trainer = trainerFor('potodds', cache);
    await trainer.start();
    const missed = trainer.spot.value!.hash;

    await trainer.settle('', answer('10', '50'));
    await trainer.next(); // a different spot
    await trainer.next(); // the missed one, back for review
    expect(trainer.spot.value!.hash).toBe(missed);
    await trainer.settle('', answer('50', '50'));

    expect(cache.rows.filter((row) => row.spot_hash === missed).length).toBe(2);
    expect(cache.rows.map((row) => row.correct)).toEqual([false, true]);
    expect(trainer.served.value).toBe(2);
    expect(cache.states.find((row) => row.spot_hash === missed)!.box).toBe(1); // promoted
  });

  it('still counts one answer once, however often the gate re-emits its reveal', async () => {
    const cache = fakeCache();
    const trainer = trainerFor('potodds', cache);
    await trainer.start();

    await trainer.settle('', answer('50', '50'));
    await trainer.settle('', answer('50', '50'));
    await trainer.settle('', answer('50', '50'));

    expect(cache.rows.length).toBe(1);
  });

  it('leaves a spot answered right alone until its interval is up', async () => {
    const cache = fakeCache();
    const trainer = trainerFor('potodds', cache);
    await trainer.start();
    const known = trainer.spot.value!.hash;

    await trainer.settle('', answer('50', '50')); // right: due a day from now
    await trainer.next();
    await trainer.next();
    expect(trainer.spot.value!.hash).not.toBe(known);
    expect(trainer.repeat.value).toBe(false);
  });

  it('picks up the spots an earlier session left owing', async () => {
    const owed: ReviewRow = {
      spot_hash: 'potodds/deadbeef',
      mode: 'potodds',
      box: 0,
      due_at: new Date(MONDAY.getTime() - DAY).toISOString(),
      last_seen_at: new Date(MONDAY.getTime() - DAY).toISOString(),
      hits: 0,
      misses: 2,
      seed: 4242,
    };
    const cache = fakeCache([owed]);
    const trainer = trainerFor('potodds', cache);
    await trainer.start();

    expect(trainer.repeat.value).toBe(true);
    expect(trainer.spot.value!.seed).toBe(4242);
  });

  it('ignores what another mode is owed', async () => {
    const owed: ReviewRow = {
      spot_hash: 'combos/deadbeef',
      mode: 'combos',
      box: 0,
      due_at: new Date(MONDAY.getTime() - DAY).toISOString(),
      last_seen_at: '',
      hits: 0,
      misses: 1,
      seed: 4242,
    };
    const cache = fakeCache([owed]);
    const trainer = trainerFor('potodds', cache);
    await trainer.start();

    expect(trainer.repeat.value).toBe(false);
    expect(trainer.due.value).toBe(0);
  });
});
