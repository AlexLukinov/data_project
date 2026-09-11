/** The `/progress` aggregation, against counts done by hand. */

import { describe, expect, it } from 'vitest';

import {
  accuracyText,
  buckets,
  calendarDays,
  dayOf,
  practisedRuns,
  progressOf,
  trend,
} from './progress';
import type { ScoreRow } from './types';

const NOW = new Date('2026-09-11T12:00:00.000Z');

function row(over: Partial<ScoreRow> = {}): ScoreRow {
  return {
    id: `s-${Math.random()}`,
    mode: 'potodds',
    spot_hash: 'potodds/a',
    question_key: '',
    question: 'q',
    prediction: '60',
    actual: '66.7',
    error: -6.7,
    correct: false,
    weight_error: null,
    bucket: 'half pot',
    created_at: '2026-09-11T09:00:00.000Z',
    ...over,
  };
}

describe('the trend', () => {
  it('runs one point per calendar day, oldest first, ending today', () => {
    const days = calendarDays(NOW, 30);
    expect(days.length).toBe(30);
    expect(days[29]).toBe(dayOf(NOW.toISOString()));
    expect(days[0]).toBe(dayOf(new Date('2026-08-13T12:00:00.000Z').toISOString()));
  });

  it('keeps a day with no practice in it as a gap rather than closing it up', () => {
    const points = trend([row({ created_at: '2026-09-11T09:00:00.000Z' })], NOW, 3);
    expect(points.length).toBe(3);
    expect(points[0]!.accuracy).toBeNull();
    expect(points[1]!.accuracy).toBeNull();
    expect(points[2]!.served).toBe(1);
  });

  it('counts a day correctly when it holds both hits and misses', () => {
    const rows = [
      row({ correct: true }),
      row({ correct: true }),
      row({ correct: false }),
      row({ correct: true }),
    ];
    const today = trend(rows, NOW, 1)[0]!;
    expect(today.served).toBe(4);
    expect(today.right).toBe(3);
    expect(today.accuracy).toBeCloseTo(0.75, 10);
  });

  it('drops answers older than the window', () => {
    const rows = [row({ created_at: '2026-01-01T09:00:00.000Z' }), row()];
    expect(trend(rows, NOW, 7).reduce((sum, point) => sum + point.served, 0)).toBe(1);
  });
});

describe('the runs the trend line is drawn from', () => {
  function points(accuracies: readonly (number | null)[]): ReturnType<typeof trend> {
    return accuracies.map((accuracy, at) => ({
      date: `2026-09-${String(at + 1).padStart(2, '0')}`,
      served: accuracy === null ? 0 : 1,
      right: accuracy ?? 0,
      accuracy,
    }));
  }

  it('breaks the line over the days that were not practised', () => {
    expect(practisedRuns(points([1, 1, null, null, 0.5, 0.5, 0.5]))).toEqual([
      [0, 1],
      [4, 5, 6],
    ]);
  });

  it('draws no line at all through a single isolated day', () => {
    expect(practisedRuns(points([null, 1, null]))).toEqual([]);
    expect(practisedRuns(points([1, null, 1, null, 1]))).toEqual([]);
  });

  it('handles a month with nothing in it, and a month with everything in it', () => {
    expect(practisedRuns(points([null, null, null]))).toEqual([]);
    expect(practisedRuns(points([0.2, 0.4, 0.6]))).toEqual([[0, 1, 2]]);
  });
});

describe('the buckets', () => {
  it('rank by how much practice is in them, then by name', () => {
    const rows = [
      row({ bucket: 'pot', correct: true }),
      row({ bucket: 'half pot', correct: true }),
      row({ bucket: 'half pot', correct: false }),
      row({ bucket: 'half pot', correct: true }),
    ];
    const table = buckets(rows);
    expect(table.map((b) => b.bucket)).toEqual(['half pot', 'pot']);
    expect(table[0]!.served).toBe(3);
    expect(table[0]!.accuracy).toBeCloseTo(2 / 3, 10);
    expect(table[1]!.accuracy).toBe(1);
  });

  it('leave out the rows that have no bucket rather than pooling them under nothing', () => {
    expect(buckets([row({ bucket: '' }), row({ bucket: '' })])).toEqual([]);
  });
});

describe('a mode', () => {
  it('summarises only its own answers', () => {
    const rows = [
      row({ mode: 'potodds', correct: true }),
      row({ mode: 'potodds', correct: false }),
      row({ mode: 'combos', correct: true, bucket: 'AKs' }),
    ];
    const potodds = progressOf('potodds', rows, NOW);
    expect(potodds.served).toBe(2);
    expect(potodds.right).toBe(1);
    expect(potodds.accuracy).toBeCloseTo(0.5, 10);
    expect(potodds.buckets.map((b) => b.bucket)).toEqual(['half pot']);
  });

  it('reads as never practised rather than as nought per cent', () => {
    const never = progressOf('drawing', [row()], NOW);
    expect(never.served).toBe(0);
    expect(never.accuracy).toBeNull();
    expect(accuracyText(never.accuracy)).toBe('—');
    expect(never.lastAt).toBe('');
    expect(never.days.length).toBe(30);
  });

  it('remembers when it was last practised', () => {
    const rows = [
      row({ created_at: '2026-09-09T09:00:00.000Z' }),
      row({ created_at: '2026-09-11T09:00:00.000Z' }),
      row({ created_at: '2026-09-10T09:00:00.000Z' }),
    ];
    expect(progressOf('potodds', rows, NOW).lastAt).toBe('2026-09-11T09:00:00.000Z');
  });
});

describe('accuracyText', () => {
  it('rounds to whole points and never invents a number', () => {
    expect(accuracyText(0.666)).toBe('67%');
    expect(accuracyText(1)).toBe('100%');
    expect(accuracyText(0)).toBe('0%');
    expect(accuracyText(null)).toBe('—');
  });
});
