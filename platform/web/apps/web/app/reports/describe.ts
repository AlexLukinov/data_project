/**
 * A stat's definition in words (plan D.5, `DefinitionPanel`).
 *
 * `/v1/definitions` ships each stat's *actual definition*, not only its label: either a
 * `situation` + an `action` — the value is `countIf(situation AND action) / countIf(situation)` —
 * or a `numerator` (+ `denominator`) built from `count`, `sum` and `countIf`. So "what does
 * fold-to-c-bet actually count?" is answerable from the registry rather than from a wiki that
 * drifts, and it is answered from the same document the SQL is compiled from.
 *
 * The wording is generated rather than written per stat, for the reason `filter/label.ts` gives:
 * 65 stats is far too many to word by hand, and a half-worded panel reads worse than a uniformly
 * worded one. Leaves are worded by the filter's own `clauseLabel`, so `facing_is_cbet = 1` reads
 * "Facing a c-bet: yes" in the definition panel exactly as it does in a filter chip.
 */

import { clauseLabel } from '../filter/label';
import { flatten } from '../filter/node';
import type { Dimension, Expr, FilterNode, Stat } from '../stats/api';

/** One row of the panel: what it is called, and what it says. */
export interface DefinitionLine {
  term: string;
  detail: string;
}

/** A node as a sentence, using the filter's own wording for each leaf. */
export function nodeSentence(node: FilterNode | null | undefined, dims: ReadonlyMap<string, Dimension>): string {
  if (node === null || node === undefined) return '';
  const leaves = flatten(node);
  if (leaves === null) return 'a condition more complex than one list of clauses';
  if (leaves.length === 0) return 'every row';
  return leaves
    .map((leaf) => clauseLabel({ dim: leaf.dim, op: leaf.op, values: values(leaf.value) }, dims.get(leaf.dim)))
    .join(' · ');
}

function values(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => (typeof entry === 'number' ? String(entry) : String(entry ?? '')));
}

/**
 * An aggregate expression in words. Recursive, and deliberately literal — "the number of rows
 * where …" rather than a paraphrase — because the founder reads this to check a number, not to be
 * reassured about it.
 */
export function exprSentence(expr: Expr | null | undefined, dims: ReadonlyMap<string, Dimension>): string {
  if (expr === null || expr === undefined) return '';
  if ('count' in expr) return 'the number of rows';
  if ('sum' in expr) return `the sum of ${dims.get(expr.sum)?.label ?? expr.sum}`;
  if ('countIf' in expr) return `the number of rows where ${nodeSentence(expr.countIf, dims)}`;
  if ('add' in expr) return expr.add.map((part) => exprSentence(part, dims)).join(' plus ');
  if ('sub' in expr) return expr.sub.map((part) => exprSentence(part, dims)).join(' minus ');
  if ('mul' in expr) return expr.mul.map((part) => exprSentence(part, dims)).join(' times ');
  return expr.div.map((part) => exprSentence(part, dims)).join(' divided by ');
}

const FORMAT_WORDS: Record<string, string> = {
  percent: 'a percentage',
  ratio: 'a ratio',
  per100: 'big blinds per 100 hands',
  count: 'a count',
};

const GRAIN_WORDS: Record<string, string> = {
  hand: 'one row per hand you were dealt into',
  decision: 'one row per decision you faced',
};

/**
 * Everything the registry knows about a stat, as lines a panel can render.
 *
 * `typical` is shown as the band it is — never as a gate. A value outside it is information, not a
 * verdict: the registry's bands are for orientation, and the pool's own numbers are the comparison
 * that means something.
 */
export function describeStat(stat: Stat, dims: ReadonlyMap<string, Dimension>): DefinitionLine[] {
  const lines: DefinitionLine[] = [{ term: 'Counts', detail: countsSentence(stat, dims) }];
  lines.push({ term: 'Measured on', detail: GRAIN_WORDS[stat.grain] ?? stat.grain });
  lines.push({ term: 'Reads as', detail: FORMAT_WORDS[stat.format] ?? stat.format });
  if (stat.typical) lines.push({ term: 'Typically', detail: typicalSentence(stat) });
  if (stat.higher_is_better === true) lines.push({ term: 'Direction', detail: 'higher is better' });
  if (stat.higher_is_better === false) lines.push({ term: 'Direction', detail: 'lower is better' });
  if (stat.higher_is_better === null || stat.higher_is_better === undefined) {
    lines.push({ term: 'Direction', detail: 'the registry does not say which way is better — it depends on the spot' });
  }
  if (stat.cached === true) lines.push({ term: 'Answered from', detail: 'the daily rollup, so it is cheap' });
  if (stat.notes) lines.push({ term: 'Caveat', detail: stat.notes });
  return lines;
}

/** The two registry forms, each said plainly. */
function countsSentence(stat: Stat, dims: ReadonlyMap<string, Dimension>): string {
  if (stat.situation && stat.action) {
    return `of the rows where ${nodeSentence(stat.situation, dims)} — the share where ${nodeSentence(stat.action, dims)}`;
  }
  const numerator = exprSentence(stat.numerator, dims);
  const denominator = exprSentence(stat.denominator, dims);
  if (numerator === '') return stat.description ?? '';
  return denominator === '' ? numerator : `${numerator}, divided by ${denominator}`;
}

function typicalSentence(stat: Stat): string {
  const [low, high] = stat.typical!;
  const unit = stat.format === 'percent' ? '%' : '';
  return `between ${low}${unit} and ${high}${unit}`;
}

/** Everything the registry knows about a dimension — what a group-by column actually splits by. */
export function describeDimension(dim: Dimension): DefinitionLine[] {
  const lines: DefinitionLine[] = [{ term: 'Column', detail: `${dim.code} — ${dim.type}` }];
  if (dim.description) lines.push({ term: 'Means', detail: dim.description });
  lines.push({ term: 'Held on', detail: dim.tables.join(', ') });
  if (dim.values.length > 0) {
    lines.push({ term: 'Values', detail: dim.values.map((value) => (value === '' ? "'' (not applicable)" : value)).join(', ') });
  }
  const buckets = Object.keys(dim.buckets);
  if (buckets.length > 0) lines.push({ term: 'Grouped into', detail: `${buckets.join(', ')} — each half-open, so the top of one is the bottom of the next` });
  return lines;
}
