/**
 * The filter as a URL query, and back (plan D.3: "pasting a URL reproduces the filter").
 *
 * A link is the product's share button, its bookmark and its bug report, so the encoding is
 * readable where it can be and exact where it cannot:
 *
 *     ?ds=population&from=2026-01-01&f=street:eq:flop;position:in:BTN,CO;eff_stack_bb:bucket:75-125
 *
 * Clauses are separated by `;`, the three parts of one by `:`, and a list by `,`. Every *value*
 * is percent-encoded, so a value containing a separator (`line_so_far` is `r/x-c/`, a hand class
 * can carry a space) survives without the reader needing to know which characters are special.
 * Codes and ops match `^[a-z][a-z0-9_]{0,63}$` and never need it.
 *
 * Decoding is lenient — a hand-edited link drops the segment it cannot read rather than throwing
 * — and registry-free: it runs before `/v1/definitions` has answered, and text is all the URL
 * ever carried anyway. Whether a decoded clause is *valid* is `clause.ts`'s question.
 */

import type { Dataset } from '../stats/api';
import type { Clause, ClauseOp } from './clause';

export interface FilterState {
  dataset: Dataset;
  /** ISO `YYYY-MM-DD`, or '' for no bound. */
  dateFrom: string;
  dateTo: string;
  clauses: Clause[];
}

export const DEFAULT_STATE: FilterState = { dataset: 'hero', dateFrom: '', dateTo: '', clauses: [] };

const CLAUSE_SEP = ';';
const PART_SEP = ':';
const VALUE_SEP = ',';
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A query object for `router.replace`: only the keys that differ from the default appear. */
export function toQuery(state: FilterState): Record<string, string> {
  const query: Record<string, string> = {};
  if (state.dataset !== DEFAULT_STATE.dataset) query.ds = state.dataset;
  if (state.dateFrom !== '') query.from = state.dateFrom;
  if (state.dateTo !== '') query.to = state.dateTo;
  const f = encodeClauses(state.clauses);
  if (f !== '') query.f = f;
  return query;
}

/** The whole filter from a route's query bag. Anything unreadable falls back to the default. */
export function fromQuery(query: Record<string, unknown>): FilterState {
  return {
    dataset: one(query.ds) === 'population' ? 'population' : 'hero',
    dateFrom: date(one(query.from)),
    dateTo: date(one(query.to)),
    clauses: decodeClauses(one(query.f) ?? ''),
  };
}

/** Vue Router hands back `string | string[] | null`; a repeated parameter takes its first value. */
function one(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function date(value: string | undefined): string {
  return value !== undefined && ISO_DATE.test(value) ? value : '';
}

export function encodeClauses(clauses: readonly Clause[]): string {
  return clauses.map(encodeClause).join(CLAUSE_SEP);
}

function encodeClause(clause: Clause): string {
  const values = clause.values.map(encodeURIComponent).join(VALUE_SEP);
  return `${clause.dim}${PART_SEP}${clause.op}${PART_SEP}${values}`;
}

export function decodeClauses(text: string): Clause[] {
  if (text === '') return [];
  const clauses: Clause[] = [];
  for (const segment of text.split(CLAUSE_SEP)) {
    const clause = decodeClause(segment);
    if (clause !== null) clauses.push(clause);
  }
  return clauses;
}

function decodeClause(segment: string): Clause | null {
  const dimEnd = segment.indexOf(PART_SEP);
  if (dimEnd < 1) return null;
  const opEnd = segment.indexOf(PART_SEP, dimEnd + 1);
  if (opEnd < 0) return null;
  const dim = segment.slice(0, dimEnd);
  const op = segment.slice(dimEnd + 1, opEnd);
  if (!CODE.test(dim) || !CODE.test(op)) return null;
  const values = segment.slice(opEnd + 1).split(VALUE_SEP).map(decodeValue);
  return values.includes(null) ? null : { dim, op: op as ClauseOp, values: values as string[] };
}

/** A half-written escape (`%zz`) makes `decodeURIComponent` throw; that segment is simply dropped. */
function decodeValue(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** Whether two query bags say the same thing — what stops a URL write from looping. */
export function sameQuery(a: Record<string, string>, b: Record<string, unknown>): boolean {
  const keys = ['ds', 'from', 'to', 'f'];
  return keys.every((key) => (a[key] ?? '') === (one(b[key]) ?? ''));
}
