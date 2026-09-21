/**
 * Why a situation cannot be measured, said before the server says it (plan D.3, F.12c).
 *
 * The router refuses a hand-grain stat over a decision-grain situation before it validates
 * anything else, so the bar warns first. What it used to warn with was "Decision-grain only:
 * hand-grain stats (VPIP, PFR…) cannot be measured here" — a word nobody outside this repo uses
 * and a list of stats hand-copied from a registry that adds one every month. The words are plain
 * now, the examples come from the registry the server actually served, and "grain" itself is a
 * term with its own explanation (`APP_TERMS.grain`) rather than a word the reader must already
 * know.
 */

import type { Stat } from '../stats/api';
import type { TermEntry } from '../stats/vocabulary';
import { APP_TERMS, grainWords, tableWords } from '../stats/vocabulary';

/**
 * A note with one explained word inside it: the text before, the term, the text after. Split so
 * that the word can carry its tip where it is read, rather than as a footnote after the sentence.
 */
export interface GrainNote {
  readonly lead: string;
  readonly term: TermEntry | null;
  readonly tail: string;
}

/** Enough examples to recognise the kind of stat being ruled out, few enough to stay a sentence. */
const NAMED = 3;

const NO_TABLE = 'No table holds all of these columns at once — this situation cannot be measured.';

/** "Hands, bb/100 and EV bb/100", in the registry's own order and labels. */
function namesOf(stats: readonly Stat[]): string {
  const labels = stats.filter((stat) => stat.grain === 'hand').slice(0, NAMED).map((stat) => stat.label);
  const last = labels[labels.length - 1];
  if (last === undefined) return '';
  return labels.length === 1 ? last : `${labels.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * The note this situation earns, or `null` when it can be measured by anything. `tables` is the
 * filter's own list of fact tables that can answer every clause at once, so an empty one means the
 * columns contradict each other and a list without `player_hands` means no per-hand stat fits.
 */
export function grainNote(tables: readonly string[], stats: readonly Stat[]): GrainNote | null {
  if (tables.length === 0) return { lead: NO_TABLE, term: null, tail: '' };
  if (tables.includes('player_hands')) return null;
  // Add the Player column and the only table left is the daily statistics, where no decision is
  // recorded either. The sentence below would then be false twice over — the columns are not on a
  // decision, and it is not per-hand stats alone that are ruled out but every stat there is.
  if (!tables.includes('decisions')) return { lead: `This situation is answered on ${tableWords(tables)}, where no stat is counted, so nothing can be measured here.`, term: null, tail: '' };
  const named = namesOf(stats);
  const examples = named === '' ? '' : ` — ${named} —`;
  return {
    lead: `Every column in this situation is recorded on a decision, so a stat ${grainWords('hand')}${examples} cannot be measured here. It is a difference of `,
    term: APP_TERMS.grain,
    tail: '.',
  };
}
