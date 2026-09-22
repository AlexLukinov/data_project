/**
 * What a clause says in words (plan §1 goal 4: "plain-English labels").
 *
 * One function does the wording for every dimension, driven by the registry's own `label` and
 * `type`, rather than a prose table per dimension. The old four-field situation filter carried
 * its own prose ("on the flop from BTN facing raise") for the four dimensions it knew; that does
 * not extend to 79, and a half-worded builder reads worse than a uniformly worded one.
 *
 * How a single value reads is not decided here. `stats/vocabulary.ts` owns that (ADR-057), because
 * the same value appears in a chip, in a report heading and in a select, and three copies of one
 * rule drift apart — the `_plus` → `+` rewrite that used to live there did, and ran on
 * `player_key` too, where a player named `a_plus_b` came out as `a+b`. There is no rewrite left to
 * copy: the registry names every enum value where it declares it (ADR-062), and one module reads
 * those names.
 */

import { lineWords } from '@poker/ui';

import type { Dimension } from '../stats/api';
import { bucketWords, valueWords } from '../stats/vocabulary';
import type { Clause } from './clause';
import { BUCKET_OP } from './clause';

const OP_WORDS: Record<string, string> = {
  eq: 'is',
  ne: 'is not',
  in: 'is one of',
  not_in: 'is none of',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  between: 'between',
  prefix: 'starts with',
  like: 'matches',
};

/**
 * The word the registry gives this value — `5bet_plus` → "5-bet or more", `''` → whichever of the
 * seven things it means on *this* dimension.
 *
 * The dimension is optional only because a caller may have lost it (a saved report naming a column
 * this server no longer serves); with none there is nothing to ask, so the value comes back as it
 * is. That is the whole of the rule now: there is no vocabulary here to apply without one.
 */
export function valueLabel(value: string, dim?: Dimension): string {
  return valueWords(dim, value);
}

/**
 * `Position is one of BTN, CO` · `Effective stack (bb) 75–125` · `Facing a c-bet: yes`.
 * A dimension the registry no longer declares still reads, so a stale link explains itself.
 */
export function clauseLabel(clause: Clause, dim: Dimension | undefined): string {
  const name = dim?.label ?? clause.dim;
  if (dim === undefined) return `${name} ${clause.op} ${clause.values.join(', ')}`;
  if (clause.op === BUCKET_OP) return `${name} ${bucketWords(dim, clause.values[0] ?? '')}`;
  if (dim.type === 'bool') return `${name}: ${clause.values[0] === '1' ? 'yes' : 'no'}`;
  // On a line, '' is not "not applicable" — it is "my first decision on this street", which is
  // what `lineWords` says. Colon rather than a verb, because an action line reads as a phrase.
  if (dim.type === 'line') return `${name}: ${clause.values.map(lineWords).join(', ')}`;
  return `${name} ${OP_WORDS[clause.op] ?? clause.op} ${values(clause, dim)}`;
}

function values(clause: Clause, dim: Dimension): string {
  // A number keeps the digits it was typed as: an emptied box is `''`, which `valueWords` renders
  // as a dash, and an unfinished clause already has `clauseProblem` to say what is missing.
  const shown = clause.values.map(dim.type === 'number' ? (v) => v : (v) => valueLabel(v, dim));
  if (clause.op === 'between') return `${shown[0]} and ${shown[1]}`;
  return shown.join(', ');
}

/** What the screen says it is showing: the clauses joined, or the honest empty case. */
export function filterSentence(clauses: readonly Clause[], dims: ReadonlyMap<string, Dimension>): string {
  if (clauses.length === 0) return 'every hand';
  return clauses.map((clause) => clauseLabel(clause, dims.get(clause.dim))).join(' · ');
}

/**
 * Why a clause cannot be sent yet, or `null`. Worded for the person who built it, not for the
 * 422 they would otherwise get back.
 */
export function clauseProblem(clause: Clause, dim: Dimension | undefined): string | null {
  if (dim === undefined) return `${clause.dim} is not a dimension this server knows`;
  if (clause.op === BUCKET_OP) {
    return clause.values[0] !== undefined && clause.values[0] in dim.buckets ? null : `pick a range for ${dim.label}`;
  }
  if (clause.op === 'between' && clause.values.length !== 2) return `${dim.label} needs a low and a high`;
  if ((clause.op === 'in' || clause.op === 'not_in') && clause.values.length === 0) {
    return `pick at least one value for ${dim.label}`;
  }
  if (dim.type === 'number' && clause.values.some((v) => v.trim() === '' || !Number.isFinite(Number(v)))) {
    return `${dim.label} takes a number`;
  }
  if (dim.type === 'enum' && clause.values.some((v) => !dim.values.includes(v))) {
    return `${dim.label} has no such value`;
  }
  return null;
}
