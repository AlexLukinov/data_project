/**
 * One condition, and how it becomes the filter AST of plan §2.5 (ADR-022).
 *
 * A clause holds its values as **text**, always in a list: one entry for a scalar op, two for
 * `between`, one or more for `in`, one bucket name for `bucket`. Text is what a URL carries and
 * what an `<input>` holds, so the round trip in `url.ts` is exact by construction and the
 * registry — not the UI — decides how a value is read. `clauseToNode` is the only place that
 * coerces, and it coerces from the dimension's own type.
 *
 * `bucket` is a UI op, not a registry one. The registry's buckets are half-open `[low, high)`
 * (`stats/definitions.py`) while the compiler renders `between` as SQL `BETWEEN low AND high`,
 * which includes the top — so a bucket emits `gte low` AND `lt high` and a 40bb stack lands in
 * `40-75` exactly once, instead of in both `0-40` and `40-75`.
 */

import type { Dimension, FilterNode, Op, Scalar } from '../stats/api';
import { LIST_OPS } from '../stats/api';

/** The registry's ops plus `bucket`, which stands for a named range the registry declares. */
export type ClauseOp = Op | 'bucket';

export interface Clause {
  dim: string;
  op: ClauseOp;
  /** Always text, always a list. Length follows the op; see the module docstring. */
  values: string[];
}

export const BUCKET_OP: ClauseOp = 'bucket';

/** How many values an op takes: a fixed count, or `null` for "one or more". */
export function arity(op: ClauseOp): number | null {
  if (op === 'between') return 2;
  if (op === 'in' || op === 'not_in') return null;
  return 1;
}

/** The ops a dimension offers the builder: the server's `allowed_ops`, plus `bucket` where it has any. */
export function opsFor(dim: Dimension): ClauseOp[] {
  const has = Object.keys(dim.buckets).length > 0;
  return has ? [BUCKET_OP, ...dim.allowed_ops] : [...dim.allowed_ops];
}

/**
 * The op a dimension should open on. `allowed_ops` arrives sorted alphabetically, so its first
 * entry is `between` for every number — a poor thing to greet someone with. Prefer the op that
 * reads as the obvious question for the type, and fall back to whatever is allowed.
 */
function preferredOp(dim: Dimension): ClauseOp {
  const ops = opsFor(dim);
  const wanted: ClauseOp = ops[0] === BUCKET_OP ? BUCKET_OP : dim.type === 'number' ? 'gte' : 'eq';
  return ops.includes(wanted) ? wanted : (ops[0] ?? 'eq');
}

/** A new clause on this dimension, filled with something meaningful rather than blank. */
export function defaultClause(dim: Dimension): Clause {
  const op = preferredOp(dim);
  const want = arity(op);
  const first = firstValue(dim, op);
  return { dim: dim.code, op, values: want === null ? [first] : pad([], want, first) };
}

function firstValue(dim: Dimension, op: ClauseOp): string {
  if (op === BUCKET_OP) return Object.keys(dim.buckets)[0] ?? '';
  if (dim.type === 'bool') return '1';
  if (dim.type === 'enum') return dim.values.find((v) => v !== '') ?? dim.values[0] ?? '';
  if (dim.type === 'number') return '0';
  return '';
}

/** Keep the values that still make sense when the op changes, and pad to the new arity. */
export function withOp(clause: Clause, op: ClauseOp, dim: Dimension): Clause {
  if (op === clause.op) return clause;
  if (op === BUCKET_OP) return { dim: clause.dim, op, values: [Object.keys(dim.buckets)[0] ?? ''] };
  const kept = clause.op === BUCKET_OP ? [] : clause.values;
  const want = arity(op);
  const values = want === null ? (kept.length > 0 ? kept : [firstValue(dim, op)]) : pad(kept, want, firstValue(dim, op));
  return { dim: clause.dim, op, values };
}

function pad(values: string[], want: number, filler: string): string[] {
  const out = values.slice(0, want);
  while (out.length < want) out.push(filler);
  return out;
}

/**
 * Whether the clause can be sent. An `in` with no values and a `between` with one bound are both
 * 422s from the Leaf validator, so an unfinished clause is held back rather than posted.
 */
export function isComplete(clause: Clause, dim: Dimension | undefined): boolean {
  if (dim === undefined) return false;
  if (clause.op === BUCKET_OP) return clause.values[0] !== undefined && clause.values[0] in dim.buckets;
  if (!opsFor(dim).includes(clause.op)) return false;
  const want = arity(clause.op);
  if (want !== null && clause.values.length !== want) return false;
  if (clause.values.length === 0) return false;
  if (dim.type === 'number') return clause.values.every((v) => v.trim() !== '' && Number.isFinite(Number(v)));
  if (dim.type === 'enum') return clause.values.every((v) => dim.values.includes(v));
  // A line or string may legitimately be '' — 'my first decision on this street' is `street_line eq ''`.
  return true;
}

/** Read a text value the way the dimension's type says to. Bools travel as 0/1, never true/false. */
function coerce(text: string, dim: Dimension): Scalar {
  if (dim.type === 'number') return Number(text);
  if (dim.type === 'bool') return text === '1' || text === 'true' ? 1 : 0;
  return text;
}

/**
 * The AST for one clause. A bucket becomes the half-open pair; every other op becomes one leaf,
 * with a list value exactly where `stats/ast.py` requires one.
 */
export function clauseToNode(clause: Clause, dim: Dimension): FilterNode {
  if (clause.op === BUCKET_OP) return bucketNode(clause, dim);
  const values = clause.values.map((v) => coerce(v, dim));
  if (LIST_OPS.includes(clause.op as Op)) return { dim: clause.dim, op: clause.op as Op, value: values };
  return { dim: clause.dim, op: clause.op as Op, value: values[0]! };
}

function bucketNode(clause: Clause, dim: Dimension): FilterNode {
  const range = dim.buckets[clause.values[0] ?? ''];
  const bounds: FilterNode[] = [];
  if (range === undefined) return { all: bounds };
  const [low, high] = range;
  if (low !== null) bounds.push({ dim: clause.dim, op: 'gte', value: low });
  if (high !== null) bounds.push({ dim: clause.dim, op: 'lt', value: high });
  return bounds.length === 1 ? bounds[0]! : { all: bounds };
}

/**
 * The whole filter: every complete clause, ANDed. `{all: []}` is the engine's own default and
 * means every row, so an empty builder is a valid request rather than a special case.
 */
export function clausesToNode(clauses: readonly Clause[], dims: ReadonlyMap<string, Dimension>): FilterNode {
  const nodes: FilterNode[] = [];
  for (const clause of clauses) {
    const dim = dims.get(clause.dim);
    if (dim !== undefined && isComplete(clause, dim)) nodes.push(clauseToNode(clause, dim));
  }
  return { all: nodes };
}

/**
 * Which fact tables can answer every clause at once. A `decisions`-only dimension rules out
 * hand-grain stats, and the router refuses that combination before it validates anything else
 * ("dimension 'facing' is not available for hand-grain stat 'vpip'"), so the builder says it
 * first rather than letting the report come back 400.
 */
export function tablesFor(clauses: readonly Clause[], dims: ReadonlyMap<string, Dimension>): string[] {
  let tables: string[] = ['decisions', 'player_hands', 'stats_daily'];
  for (const clause of clauses) {
    const dim = dims.get(clause.dim);
    if (dim !== undefined) tables = tables.filter((t) => dim.tables.includes(t as Dimension['tables'][number]));
  }
  return tables;
}
