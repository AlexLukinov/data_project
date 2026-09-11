/**
 * The filter AST back into clauses — the inverse of `clause.ts` (plan D.5).
 *
 * D.3 only needed one direction: a person builds clauses and the compiler emits the tree. A
 * preset and a saved report arrive from the other end, as a `ReportRequest` whose `filter` is
 * already a tree, and opening one has to put that situation *into the builder* — otherwise the
 * grid shows the preset's numbers above a filter bar describing something else.
 *
 * Two shapes of the round trip need care, both learned from the repo's own presets:
 *
 *  - a top-level filter may be a **bare leaf**, not wrapped in `all`: `analysis/hero/presets.yaml`
 *    writes `blind_defence` as `{dim: position, op: in, value: [SB, BB]}`;
 *  - a bucket left `clause.ts` as **two** leaves (`gte low` AND `lt high`, never `between`, so a
 *    40bb stack lands in one bucket and not two), so reading it back means recognising that pair
 *    and naming the bucket again. Miss it and `Effective stack (bb) 75–125` comes back as two
 *    anonymous number clauses that no longer say which bucket they were.
 *
 * Nested `all` nodes are flattened, and that is not a liberty: `clause.ts` *emits* one, because a
 * two-bound bucket becomes `{all: [gte, lt]}` inside the outer `all`. So a report this very
 * workbench saves arrives back nested, and a decoder that refused nesting would make every saved
 * report with a stack or sizing bucket uneditable. Flattening is exact — AND is associative — and
 * the round trip is tested from both ends because of it.
 *
 * What genuinely cannot be a clause list — an `any`, a `not` — returns `null` instead of being
 * reshaped into something that means something else. The workbench keeps such a filter verbatim
 * and says the builder cannot edit it; a silently altered situation is a wrong number shown
 * confidently, which is the one thing §17 forbids.
 */

import type { Dimension, FilterNode, Leaf, Op, Scalar } from '../stats/api';
import { LIST_OPS } from '../stats/api';
import type { Clause } from './clause';
import { BUCKET_OP } from './clause';

/** `{all: [...]}` — the shape `clausesToNode` emits. */
function isAll(node: FilterNode): node is { all: FilterNode[] } {
  return 'all' in node && Array.isArray(node.all);
}

function isLeaf(node: FilterNode): node is Leaf {
  return 'dim' in node && 'op' in node && 'value' in node;
}

/** Whether the tree is empty — `{all: []}`, the engine's "every row". */
export function isEveryRow(node: FilterNode): boolean {
  return isAll(node) && node.all.length === 0;
}

/**
 * The clauses that compile back to this tree, or `null` if none do.
 *
 * Lossless where it answers: feeding the result to `clausesToNode` reproduces the tree, bucket
 * pairs included. `dims` is needed only to name buckets and to know a dimension's type.
 */
export function nodeToClauses(node: FilterNode, dims: ReadonlyMap<string, Dimension>): Clause[] | null {
  const leaves = flatten(node);
  if (leaves === null) return null;
  return foldBuckets(leaves.map(leafToClause), dims);
}

/**
 * Every leaf under a tree of `all`s, in order, or `null` at the first `any` or `not`. Flattening
 * an `all` into its parent is exact because AND is associative — and necessary, because a bucket
 * compiles to exactly that shape.
 */
export function flatten(node: FilterNode): Leaf[] | null {
  if (isLeaf(node)) return [node];
  if (!isAll(node)) return null;
  const leaves: Leaf[] = [];
  for (const child of node.all) {
    const nested = flatten(child);
    if (nested === null) return null;
    leaves.push(...nested);
  }
  return leaves;
}

/** A leaf as a clause: the op unchanged, the value back to the text a clause and a URL carry. */
function leafToClause(leaf: Leaf): Clause {
  const values = LIST_OPS.includes(leaf.op) && Array.isArray(leaf.value) ? leaf.value : [leaf.value];
  return { dim: leaf.dim, op: leaf.op, values: (values as Scalar[]).map(text) };
}

/** Bools travel as 0/1 and numbers as numbers; `clause.ts` coerces back from the same text. */
function text(value: Scalar): string {
  return typeof value === 'number' ? String(value) : value;
}

/**
 * Rejoin the bounds a bucket compiled to into the bucket it came from.
 *
 * A closed bucket left `clause.ts` as two leaves and an open-ended one (`200+`, `0-40` with an
 * open low) as a single leaf, so both are matched here. Only an *exact* match on a declared
 * bucket's bounds is rejoined; a `gte 75` with no partner and no bucket of that shape stays the
 * plain clause it is. Rejoining is a presentation win, not a semantic one — either form compiles
 * to the same tree — and the win is that the chip reads `200+` rather than `≥ 200`.
 */
function foldBuckets(clauses: Clause[], dims: ReadonlyMap<string, Dimension>): Clause[] {
  const out: Clause[] = [];
  const taken = new Set<number>();
  clauses.forEach((clause, index) => {
    if (taken.has(index)) return;
    const dim = dims.get(clause.dim);
    const partner = clauses.findIndex((other, j) => j > index && !taken.has(j) && other.dim === clause.dim);
    const paired = partner < 0 ? null : bucketFrom(dim, clause, clauses[partner]!);
    if (paired !== null) {
      taken.add(partner);
      out.push({ dim: clause.dim, op: BUCKET_OP, values: [paired] });
      return;
    }
    const alone = bucketFrom(dim, clause, null);
    out.push(alone === null ? clause : { dim: clause.dim, op: BUCKET_OP, values: [alone] });
  });
  return out;
}

/** The bucket `a` (with `b`, where there is one) is the bounds of. */
function bucketFrom(dim: Dimension | undefined, a: Clause, b: Clause | null): string | null {
  const low = bound(a, 'gte') ?? (b === null ? null : bound(b, 'gte'));
  const high = bound(a, 'lt') ?? (b === null ? null : bound(b, 'lt'));
  return bucketOf(dim, low, high);
}

/**
 * The declared bucket with exactly these bounds, or `null`. A bound the caller did not find is
 * `null`, which matches a bucket's own open end — that is how `200+` ([200, null]) is recognised
 * from one `gte 200` leaf, and why a pair of bounds is tried before a lone one.
 */
function bucketOf(dim: Dimension | undefined, low: number | null, high: number | null): string | null {
  if (dim === undefined || (low === null && high === null)) return null;
  for (const [name, [bucketLow, bucketHigh]] of Object.entries(dim.buckets)) {
    if (bucketLow === low && bucketHigh === high) return name;
  }
  return null;
}

function bound(clause: Clause, op: Op): number | null {
  if (clause.op !== op || clause.values.length !== 1) return null;
  const value = Number(clause.values[0]);
  return Number.isFinite(value) ? value : null;
}
