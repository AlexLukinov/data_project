/**
 * A leak, as a situation you can open the hands of (plan D.7's "Done means", ADR-040).
 *
 * `/v1/hero/leaks` answers with stat **codes** — `fold_to_cbet_flop` is 62% against the pool's
 * 48% — and nothing else. Turning that into a hand list could have been a table of hand-written
 * situations ("flop, facing a bet, the bet was a c-bet"), which is exactly the drift ADR-037 had
 * just finished deleting from `hands/search.ts`. So it is not written here at all: a built-in
 * stat already carries its own filter tree in the registry —
 * `countIf(situation AND action) / countIf(situation)` — and `GET /v1/definitions` serializes
 * both halves. The drill-through is therefore composition of things that already exist:
 *
 *     stat.situation → nodeToClauses (D.5) → toQuery (D.3) → /hands?f=…
 *
 * and a definition tuned in `stats/registry/stats/*.yaml` moves the link with it.
 *
 * **A leak is two questions**, so it offers two links. `taken` is the situation *and* the action
 * — the hands where you did the leaky thing, which is what you want to watch. `spot` is the
 * situation alone, the whole spot, and its size is already on the row: `Leak.n` *is* that
 * denominator. Neither count is invented here; the numerator is never printed as `n × value`.
 *
 * **Four of the thirty-nine ranked stats cannot be opened**, and they say so instead of earning a
 * 400: `vpip`/`pfr` measure every hand dealt and act on `did_vpip`/`did_pfr`, `wwsf`/`wtsd` sit on
 * `saw_flop`, and all three dimensions live only on `marts.player_hands` while a hand search
 * compiles against `marts.decisions`. That is recognised **structurally** — by asking the registry
 * which tables hold the clauses' dimensions — never as a list of four codes, which would rot the
 * day one of those dimensions reaches a second table.
 */

import type { Clause } from '../filter/clause';
import { nodeToClauses } from '../filter/node';
import { toQuery } from '../filter/url';
import type { Dimension, Stat } from '../stats/api';
import type { TermEntry } from '../stats/vocabulary';
import { categoryWords, statEntry } from '../stats/vocabulary';
import { unsearchableLabels } from '../hands/searchable';
import type { Leak } from './api';
import { leakReading } from './readings';

export interface LeakDrill {
  /** The spot itself — every decision the stat counted. `null` when it cannot be opened. */
  spot: Clause[] | null;
  /** The spot *and* the action: the hands where the leak happened. `null` when it cannot. */
  taken: Clause[] | null;
  /** Why nothing can be opened, or `''` when something can. */
  blocked: string;
}

/**
 * The clauses a stat's filter tree becomes, or a sentence saying why it cannot become any.
 *
 * Three ways it cannot, each worth its own words: the tree is empty (the stat measures every
 * hand, so there is no situation to open — and a link with no conditions would silently inherit
 * whatever the filter already held); the tree is an `any` or a `not`, which a flat clause list
 * cannot hold; or a dimension in it is counted per hand rather than per decision.
 */
function clausesOf(tree: Stat['situation'], dims: ReadonlyMap<string, Dimension>, label: string): Clause[] | string {
  if (tree === undefined || tree === null) return `${label} is not defined as a situation, so it has no hands to open.`;
  const clauses = nodeToClauses(tree, dims);
  if (clauses === null) return `${label}'s situation is not a plain list of conditions, so the filter cannot hold it.`;
  if (clauses.length === 0) return `${label} is measured over every hand dealt in, so there is no particular spot to open — those hands are all of them.`;
  const off = unsearchableLabels(clauses, dims);
  if (off.length > 0) {
    const one = off.length === 1;
    return `${label} is counted per hand rather than per decision (${off.join(', ')}), and a hand list has to name the seat that matched, so ${one ? 'this' : 'these'} cannot be opened as hands.`;
  }
  return clauses;
}

/**
 * What a leak opens. `stat` is the registry entry `leak.code` names — from `definitions.stats`,
 * whose `situation` and `action` the server sends and the client had been discarding.
 */
export function leakDrill(leak: Leak, stat: Stat | undefined, dims: ReadonlyMap<string, Dimension>): LeakDrill {
  if (stat === undefined) return { spot: null, taken: null, blocked: `${leak.label} is not in the registry this session loaded, so its situation is unknown.` };
  const spot = clausesOf(stat.situation, dims, stat.label);
  if (typeof spot === 'string') return { spot: null, taken: null, blocked: spot };
  const action = clausesOf(stat.action, dims, stat.label);
  // The spot still opens when only the action is unreachable: seeing every time you were in the
  // spot is a weaker answer than seeing the times you erred in it, but it is not a wrong one.
  return { spot, taken: typeof action === 'string' ? null : [...spot, ...action], blocked: '' };
}

/** Whether a leak can be opened at all — what decides a link from a sentence on the row. */
export function isDrillable(drill: LeakDrill): boolean {
  return drill.spot !== null;
}

export interface DrillDates {
  from?: string;
  to?: string;
}

/**
 * The `/hands` query for a set of clauses: D.3's own encoder, with the dates the leaks were asked
 * over carried through so the list answers the same question the leak did. `dataset` is `hero` —
 * a leak is the hero's by definition — which `toQuery` leaves implicit because it is the default.
 */
export function handsQuery(clauses: readonly Clause[], dates: DrillDates = {}): Record<string, string> {
  return toQuery({ dataset: 'hero', dateFrom: dates.from ?? '', dateTo: dates.to ?? '', clauses: [...clauses] });
}

/** Leaks worth showing, worst first. The server already sorts by score; this is the guard. */
export function ranked(leaks: readonly Leak[]): Leak[] {
  return [...leaks].sort((a, b) => b.score - a.score);
}

/** One row of the leak table: the server's numbers, the two doors, and the words for both. */
export interface LeakRow {
  leak: Leak;
  /** What the stat measures, from the registry entry `leak.code` names (ADR-057). */
  term: TermEntry;
  /**
   * What this row's own four numbers mean — which way the gap points, whether the value is
   * unusual in itself, and what it rests on (plan F.12, `readings.ts`). The term above says what
   * the stat is; this says what *this* measurement of it says, and is generated from the values
   * so the two can never disagree.
   */
  reading: string;
  /** The category as a reader says it. `/v1/hero/leaks` sends the raw code, `preflop`. */
  category: string;
  drill: LeakDrill;
  spotQuery: Record<string, string> | null;
  takenQuery: Record<string, string> | null;
}

/**
 * The table's rows, worst first.
 *
 * Built here rather than in the component because every branch in it is a decision about words or
 * links — which registry entry explains a label, whether a leak can be opened at all — and a
 * decision made inside a template is a decision no test ever reads. The response carries a label
 * but no description, so the sentence has to be looked up against the registry this session loaded;
 * a stat it does not hold still reads as its label, and says plainly that it is unknown.
 */
export function leakRows(
  leaks: readonly Leak[],
  stats: ReadonlyMap<string, Stat>,
  dims: ReadonlyMap<string, Dimension>,
  dates: DrillDates = {},
): LeakRow[] {
  return ranked(leaks).map((leak) => {
    const stat = stats.get(leak.code);
    const drill = leakDrill(leak, stat, dims);
    return {
      leak,
      term: statEntry(stat, leak.code, leak.label),
      reading: leakReading(leak),
      category: categoryWords(leak.category),
      drill,
      spotQuery: drill.spot === null ? null : handsQuery(drill.spot, dates),
      takenQuery: drill.taken === null ? null : handsQuery(drill.taken, dates),
    };
  });
}
