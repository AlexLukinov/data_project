/**
 * The columns half of a report's URL (plan D.5: "a saved report reopens from its URL").
 *
 * `filter/url.ts` already carries the *situation* — `ds`, `from`, `to`, `f`. What it deliberately
 * does not carry is what the situation is being measured **with**, because two screens share a
 * filter without sharing their columns. So the workbench adds its own four keys beside them:
 *
 *     ?ds=population&f=street:eq:flop&s=cbet_flop,fold_to_cbet_flop&by=position&min=300
 *
 *     s    the stats, in the order they are read across the grid
 *     by   the group-by columns, outermost first — these are the grid's rows
 *     cmp  `population` when each cell is compared with the field
 *     coh  the cohort scoping it: `vpip:lt:25,hands:gte:1000`
 *     min  the sample a cell needs before its delta is drawn
 *
 * `min` is in the URL on purpose. The threshold decides which cells are greyed, so it is part of
 * what the link *says*; a link that greys a cell for the person who sent it and not for the
 * person who opens it would defeat the point of greying it.
 *
 * The grammar is `filter/url.ts`'s, deliberately: `,` between items and `:` inside one. Codes and
 * ops match `^[a-z][a-z0-9_]{0,63}$` and cohort values are numbers, so nothing here needs
 * escaping. Decoding is lenient in the same way — an unreadable segment is dropped, not thrown —
 * and registry-free, so it runs before `/v1/definitions` has answered.
 */

import type { CohortOp, CohortRule, CohortSpec } from '../stats/api';
import { MIN_N } from './cell';

export interface ColumnsState {
  stats: string[];
  groupBy: string[];
  compare: boolean;
  cohort: CohortSpec | null;
  minN: number;
}

export const DEFAULT_COLUMNS: ColumnsState = { stats: [], groupBy: [], compare: false, cohort: null, minN: MIN_N };

/** The query keys this module owns. `filter/url.ts` owns `ds`, `from`, `to` and `f`. */
export const COLUMN_KEYS = ['s', 'by', 'cmp', 'coh', 'min'] as const;

const ITEM_SEP = ',';
const PART_SEP = ':';
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const COHORT_OPS: readonly string[] = ['lt', 'lte', 'gt', 'gte'];

/** Only the keys that differ from the default appear, so a plain report has a plain link. */
export function columnsToQuery(state: ColumnsState): Record<string, string> {
  const query: Record<string, string> = {};
  if (state.stats.length > 0) query.s = state.stats.join(ITEM_SEP);
  if (state.groupBy.length > 0) query.by = state.groupBy.join(ITEM_SEP);
  if (state.compare) query.cmp = 'population';
  if (state.cohort !== null) query.coh = encodeCohort(state.cohort);
  if (state.minN !== DEFAULT_COLUMNS.minN) query.min = String(state.minN);
  return query;
}

/** The columns from a route's query bag; anything unreadable falls back to the default. */
export function columnsFromQuery(query: Record<string, unknown>): ColumnsState {
  return {
    stats: codes(one(query.s)),
    groupBy: codes(one(query.by)),
    compare: one(query.cmp) === 'population',
    cohort: decodeCohort(one(query.coh)),
    minN: threshold(one(query.min)),
  };
}

/** Vue Router hands back `string | string[] | null`; a repeated parameter takes its first value. */
function one(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/** Codes only — a segment that is not one is dropped rather than sent for the server to reject. */
function codes(text: string | undefined): string[] {
  if (text === undefined || text === '') return [];
  return text.split(ITEM_SEP).filter((code) => CODE.test(code));
}

/** A negative or non-numeric threshold would grey everything or nothing; neither is meant. */
function threshold(text: string | undefined): number {
  if (text === undefined) return DEFAULT_COLUMNS.minN;
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_COLUMNS.minN;
}

function encodeCohort(cohort: CohortSpec): string {
  return cohort.rules.map((rule) => `${rule.stat}${PART_SEP}${rule.op}${PART_SEP}${rule.value}`).join(ITEM_SEP);
}

/**
 * A cohort from the URL. One bad rule voids the whole cohort rather than narrowing the pool by
 * the rules that happened to parse: a report over "regs" minus one criterion is a different
 * report, and showing it under the same name is the fabricated number §17 rules out.
 */
function decodeCohort(text: string | undefined): CohortSpec | null {
  if (text === undefined || text === '') return null;
  const rules: CohortRule[] = [];
  for (const segment of text.split(ITEM_SEP)) {
    const rule = decodeRule(segment);
    if (rule === null) return null;
    rules.push(rule);
  }
  return rules.length > 0 ? { rules } : null;
}

function decodeRule(segment: string): CohortRule | null {
  const [stat, op, value, ...rest] = segment.split(PART_SEP);
  if (stat === undefined || op === undefined || value === undefined || rest.length > 0) return null;
  if (!CODE.test(stat) || !COHORT_OPS.includes(op)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? { stat, op: op as CohortOp, value: number } : null;
}

/** Whether two query bags say the same thing about the columns — what stops a write from looping. */
export function sameColumnsQuery(a: Record<string, string>, b: Record<string, unknown>): boolean {
  return COLUMN_KEYS.every((key) => (a[key] ?? '') === (one(b[key]) ?? ''));
}
