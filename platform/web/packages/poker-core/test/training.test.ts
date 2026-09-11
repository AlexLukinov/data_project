/** The review schedule (spec §16), against dates worked out by hand. */

import { describe, expect, it } from 'vitest';

import type { ReviewState } from '../src/training/schedule';
import {
  HEURISTIC_REVIEW_DAYS,
  REVIEW_INTERVALS_DAYS,
  dueFirst,
  heuristicDueAt,
  heuristicIsDue,
  intervalOf,
  isDue,
  nextReview,
} from '../src/training/schedule';

const KEY = { spot_hash: 'equity/7', mode: 'equity' };
const MONDAY = new Date('2026-09-07T10:00:00.000Z');

function day(offset: number): Date {
  return new Date(MONDAY.getTime() + offset * 86_400_000);
}

describe('the box intervals', () => {
  it('increase, start at zero and are clamped at both ends', () => {
    expect(REVIEW_INTERVALS_DAYS).toEqual([0, 1, 3, 7, 16, 35]);
    for (let box = 1; box < REVIEW_INTERVALS_DAYS.length; box += 1) {
      expect(REVIEW_INTERVALS_DAYS[box]!).toBeGreaterThan(REVIEW_INTERVALS_DAYS[box - 1]!);
    }
    expect(intervalOf(0)).toBe(0);
    expect(intervalOf(-4)).toBe(0); // below the table
    expect(intervalOf(99)).toBe(35); // above it: the ceiling, not an error
    expect(intervalOf(2.7)).toBe(3); // truncated, not rounded
  });
});

describe('nextReview', () => {
  it('puts a brand-new spot answered right into box 1, due a day later', () => {
    const state = nextReview(null, KEY, true, MONDAY);
    expect(state).toEqual({
      spot_hash: 'equity/7',
      mode: 'equity',
      box: 1,
      due_at: '2026-09-08T10:00:00.000Z',
      last_seen_at: '2026-09-07T10:00:00.000Z',
      hits: 1,
      misses: 0,
    });
  });

  it('leaves a brand-new spot answered wrong in box 0, due at once', () => {
    const state = nextReview(null, KEY, false, MONDAY);
    expect(state.box).toBe(0);
    expect(state.due_at).toBe('2026-09-07T10:00:00.000Z');
    expect(state.misses).toBe(1);
    expect(isDue(state, MONDAY)).toBe(true);
  });

  it('walks the intervals up on a run of right answers, then holds at the ceiling', () => {
    let state = nextReview(null, KEY, true, MONDAY); // box 1
    expect(state.due_at).toBe(day(1).toISOString());
    state = nextReview(state, KEY, true, day(1)); // box 2, +3
    expect(state.due_at).toBe(day(4).toISOString());
    state = nextReview(state, KEY, true, day(4)); // box 3, +7
    expect(state.due_at).toBe(day(11).toISOString());
    state = nextReview(state, KEY, true, day(11)); // box 4, +16
    expect(state.due_at).toBe(day(27).toISOString());
    state = nextReview(state, KEY, true, day(27)); // box 5, +35
    expect(state.due_at).toBe(day(62).toISOString());
    state = nextReview(state, KEY, true, day(62)); // still box 5
    expect(state.box).toBe(5);
    expect(state.due_at).toBe(day(97).toISOString());
    expect(state.hits).toBe(6);
    expect(state.misses).toBe(0);
  });

  it('drops a well-known spot all the way back on a miss, keeping its history', () => {
    let state = nextReview(null, KEY, true, MONDAY);
    state = nextReview(state, KEY, true, day(1));
    state = nextReview(state, KEY, true, day(4)); // box 3
    state = nextReview(state, KEY, false, day(11));
    expect(state.box).toBe(0);
    expect(state.due_at).toBe(day(11).toISOString()); // due again in this very session
    expect(state.hits).toBe(3);
    expect(state.misses).toBe(1);
  });
});

describe('isDue and dueFirst', () => {
  const states: ReviewState[] = [
    { spot_hash: 'b', mode: 'combos', box: 1, due_at: day(3).toISOString(), last_seen_at: '', hits: 1, misses: 0 },
    { spot_hash: 'a', mode: 'combos', box: 0, due_at: day(1).toISOString(), last_seen_at: '', hits: 0, misses: 1 },
    { spot_hash: 'c', mode: 'equity', box: 2, due_at: day(9).toISOString(), last_seen_at: '', hits: 2, misses: 0 },
    { spot_hash: 'aa', mode: 'equity', box: 0, due_at: day(1).toISOString(), last_seen_at: '', hits: 0, misses: 2 },
  ];

  it('counts a spot due at the instant it comes round, not after it', () => {
    expect(isDue(states[1]!, day(1))).toBe(true);
    expect(isDue(states[1]!, new Date(day(1).getTime() - 1))).toBe(false);
  });

  it('orders the queue longest-overdue first, breaking ties on the hash so it does not reshuffle', () => {
    expect(dueFirst(states, day(5)).map((s) => s.spot_hash)).toEqual(['a', 'aa', 'b']);
    expect(dueFirst(states, day(0)).map((s) => s.spot_hash)).toEqual([]);
    expect(dueFirst(states, day(100)).map((s) => s.spot_hash)).toEqual(['a', 'aa', 'b', 'c']);
  });
});

describe('the heuristic review prompt', () => {
  it('falls 14 days after it was written, while it has never been answered', () => {
    expect(HEURISTIC_REVIEW_DAYS).toBe(14);
    expect(heuristicDueAt('2026-09-07T10:00:00.000Z')).toBe('2026-09-21T10:00:00.000Z');
    expect(heuristicIsDue('2026-09-07T10:00:00.000Z', null, day(13))).toBe(false);
    expect(heuristicIsDue('2026-09-07T10:00:00.000Z', null, day(14))).toBe(true);
  });

  it('runs from the last time the question was answered once it has been', () => {
    const written = '2026-09-07T10:00:00.000Z';
    const confirmed = day(10).toISOString();
    expect(heuristicIsDue(written, confirmed, day(20))).toBe(false); // 14 days from day 10, not day 0
    expect(heuristicIsDue(written, confirmed, day(24))).toBe(true);
  });

  it('refuses an instant it cannot read rather than quietly never being due', () => {
    expect(() => heuristicDueAt('last tuesday')).toThrow(RangeError);
  });
});
