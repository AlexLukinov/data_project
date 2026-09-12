/**
 * Two cohorts of the field, side by side (plan D.6's Done means: "regs vs fish" fold-to-cbet by
 * sizing).
 *
 * **Why this is two runs and not one.** `ReportRequest` carries a single `cohort`, and
 * `compare_to` is refused for any dataset but hero (`stats/request.py`: "compare_to needs the hero
 * dataset"), so there is no pool-vs-pool baseline to ask for. The engine answers each cohort on
 * its own; this module's whole job is to make the two answers line up so they can be read as a
 * pair.
 *
 * **Why it computes no differences.** It would be one line to subtract the two values, and it
 * would be wrong. `reports/cell.ts` withholds a delta under `MIN_N` because "*a difference from a
 * handful of observations measures the handful, not the play*" — and a regs-minus-fish figure
 * drawn here would be a second comparison, with its own second answer to what "enough" means, in
 * a file the grid does not consult. So the two cohorts render as two `StatGrid`s over the same
 * rows, each cell carrying its own `n`, and the reader does the subtraction with both samples in
 * front of them. ADR-042's rule survives because nothing here re-decides it.
 *
 * What is left is alignment: a bucket one cohort never reached must still occupy its row on both
 * sides, or the two grids scroll out of step and the sixth row of one sits beside the seventh of
 * the other. A missing row becomes an **empty** row — `hands: 0` and no cells — which `cell.ts`
 * already reads as "no observations, no number" and prints as a dash.
 */

import type { ReportResult, ReportRow } from '../stats/api';

/** One row's identity: its group values in the report's own `group_by` order. */
export function rowKey(row: ReportRow, groupBy: readonly string[]): string {
  return JSON.stringify(groupBy.map((code) => row.group[code] ?? null));
}

/**
 * The union of both results' rows, in a stable order: every row of `left` as it came, then the
 * rows only `right` has. Neither result's own ordering is re-sorted — the engine ordered them.
 */
function unionKeys(left: ReportResult, right: ReportResult, groupBy: readonly string[]): string[] {
  const keys = left.rows.map((row) => rowKey(row, groupBy));
  const seen = new Set(keys);
  for (const row of right.rows) {
    const key = rowKey(row, groupBy);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** The group values a key stands for, back in `group_by` order, for a row that has to be invented. */
function groupOf(key: string, groupBy: readonly string[]): ReportRow['group'] {
  const values = JSON.parse(key) as (string | number | null)[];
  return Object.fromEntries(groupBy.map((code, index) => [code, values[index] ?? null]));
}

/**
 * Both results over the same rows, in the same order.
 *
 * The two must have been asked the same question — same `group_by`, same stats — differing only in
 * their cohort; that is the caller's job and `sameShape` is here to assert it.
 */
export function align(left: ReportResult, right: ReportResult): [ReportResult, ReportResult] {
  const groupBy = left.group_by;
  const keys = unionKeys(left, right, groupBy);
  return [fill(left, keys, groupBy), fill(right, keys, groupBy)];
}

function fill(result: ReportResult, keys: readonly string[], groupBy: readonly string[]): ReportResult {
  const byKey = new Map(result.rows.map((row) => [rowKey(row, groupBy), row]));
  const rows = keys.map((key) => byKey.get(key) ?? { group: groupOf(key, groupBy), hands: 0, cells: {} });
  return { ...result, rows };
}

/** Whether two results answer the same question of different cohorts, and so may be read as a pair. */
export function sameShape(left: ReportResult, right: ReportResult): boolean {
  const codes = (result: ReportResult): string => result.stats.map((stat) => stat.code).join(',');
  return left.group_by.join(',') === right.group_by.join(',') && codes(left) === codes(right);
}
