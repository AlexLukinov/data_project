import { describe, expect, it } from 'vitest';

import type { Cell, ReportResult, ReportRow } from '../stats/api';
import { align, rowKey, sameShape } from './compare';

function cell(over: Partial<Cell> = {}): Cell {
  return { value: 50, n: 1000, baseline: null, baseline_n: null, delta: null, ...over };
}

function row(bucket: string, over: Partial<ReportRow> = {}): ReportRow {
  return { group: { facing_size_pct: bucket }, hands: 500, cells: { fold_to_cbet_flop: cell() }, ...over };
}

function result(rows: ReportRow[], over: Partial<ReportResult> = {}): ReportResult {
  return {
    hands: 1000,
    group_by: ['facing_size_pct'],
    stats: [{ code: 'fold_to_cbet_flop', label: 'Fold to c-bet flop', format: 'percent', grain: 'decision', description: '' }],
    rows,
    cached: false,
    ...over,
  };
}

describe('rowKey', () => {
  it('identifies a row by its group values in the report’s own order', () => {
    const left = { group: { a: '1', b: '2' }, hands: 0, cells: {} };
    expect(rowKey(left, ['a', 'b'])).not.toBe(rowKey(left, ['b', 'a']));
  });

  it('treats a missing group value as null rather than undefined, so it survives JSON', () => {
    expect(rowKey({ group: {}, hands: 0, cells: {} }, ['a'])).toBe('[null]');
  });
});

describe('align', () => {
  it('leaves two results that already share their rows untouched', () => {
    const [left, right] = align(result([row('small'), row('large')]), result([row('small'), row('large')]));
    expect(left.rows.map((entry) => entry.group.facing_size_pct)).toEqual(['small', 'large']);
    expect(right.rows.map((entry) => entry.group.facing_size_pct)).toEqual(['small', 'large']);
  });

  it('gives a bucket one cohort never reached an empty row on that side, in the same position', () => {
    const regs = result([row('small'), row('mid'), row('large')]);
    const fish = result([row('small'), row('large')]);
    const [left, right] = align(regs, fish);

    expect(left.rows.map((entry) => entry.group.facing_size_pct)).toEqual(['small', 'mid', 'large']);
    expect(right.rows.map((entry) => entry.group.facing_size_pct)).toEqual(['small', 'mid', 'large']);
    /* The invented row reads as "no observations, no number" to cell.ts — not as a zero. */
    expect(right.rows[1]).toEqual({ group: { facing_size_pct: 'mid' }, hands: 0, cells: {} });
  });

  it('keeps a bucket only the right-hand cohort reached, appended after the left’s own order', () => {
    const [left, right] = align(result([row('small')]), result([row('overbet')]));
    expect(left.rows.map((entry) => entry.group.facing_size_pct)).toEqual(['small', 'overbet']);
    expect(right.rows.map((entry) => entry.group.facing_size_pct)).toEqual(['small', 'overbet']);
    expect(left.rows[1]?.hands).toBe(0);
    expect(right.rows[0]?.hands).toBe(0);
  });

  it('never invents a cell: an empty row carries no stat at all, so nothing can be read from it', () => {
    const [, right] = align(result([row('small')]), result([]));
    expect(right.rows[0]?.cells).toEqual({});
  });

  it('preserves every real cell and its own n', () => {
    const thin = row('mid', { cells: { fold_to_cbet_flop: cell({ value: 41, n: 3 }) } });
    const [left] = align(result([thin]), result([]));
    expect(left.rows[0]?.cells.fold_to_cbet_flop).toEqual(cell({ value: 41, n: 3 }));
  });

  it('aligns on all of a multi-column grouping, not just the first', () => {
    const grouped = (position: string, bucket: string): ReportRow => ({
      group: { position, facing_size_pct: bucket },
      hands: 10,
      cells: {},
    });
    const by = { group_by: ['position', 'facing_size_pct'] };
    const [left, right] = align(result([grouped('BTN', 'small')], by), result([grouped('BTN', 'large')], by));
    expect(left.rows).toHaveLength(2);
    expect(right.rows).toHaveLength(2);
  });
});

describe('sameShape', () => {
  it('accepts two results that differ only in their cohort', () => {
    expect(sameShape(result([row('small')]), result([row('large')]))).toBe(true);
  });

  it('refuses two results grouped differently', () => {
    expect(sameShape(result([]), result([], { group_by: ['position'] }))).toBe(false);
  });

  it('refuses two results measuring different stats', () => {
    const other = result([], { stats: [{ code: 'vpip', label: 'VPIP', format: 'percent', grain: 'hand', description: '' }] });
    expect(sameShape(result([]), other)).toBe(false);
  });
});
