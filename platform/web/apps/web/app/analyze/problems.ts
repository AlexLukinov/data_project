/**
 * Why the analyzer has no answer to show, in one sentence (audit §2.13; ADR-057 decision 8's rule,
 * applied to the sites F.12c listed as not its own; ADR-061).
 *
 * Three answers used to arrive through `.catch(() => null)`: the pool at this node, the pool at
 * the node villain is in, and the reader's own range library. A `null` from any of them reads as
 * "the field has never played this" or "you have no chart here" — when what happened is that
 * nobody was able to ask. The distinction matters most under load: a commit asks the pool two
 * questions at once, and ClickHouse refuses a query once the account is already running as many
 * as its budget allows (plan E.3), which the API relays as a sanitized 500.
 *
 * `describeApiError` already words that case ("several questions were asked at once…"), so these
 * sentences only say *what* could not be asked and *how* to ask again. `hands/study.ts` keeps its
 * own copies for the replayer, whose retry is a step rather than a button.
 *
 * Every sentence is built here rather than in a template, so it is asserted as text.
 */

import { describeApiError } from '~/auth/api';
import { LIBRARY_UNREADABLE } from '~/hands/study';

/** Shorter than `describeApiError`'s own: each sentence below spells out its own way to retry. */
const SILENT = 'The API did not answer; start it with `make api` in platform/.';

/** Both pool questions are asked again the next time the reader moves between steps. */
const ASK_AGAIN = 'Moving to another step asks again.';

/**
 * An analysis can be saved with no situation on it (a pasted hand, or one made by hand), and then
 * there is no node to ask the pool about — no request is made, so no request can fail, and the
 * gate would wait on "Working out…" for ever. Step 1 says the same thing in its own words.
 */
export const NO_SITUATION =
  'This analysis has no situation yet, so there is nothing to ask the pool about — set one on the hand it came from.';

/** A server's detail rarely ends in a full stop, and the retry clause follows it on the same line. */
function asSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

function reason(error: unknown): string {
  return asSentence(describeApiError(error, SILENT));
}

/** Tier 1 at this node was not answered: what the field does here is unknown, not uniform. */
export function analyzePoolProblem(error: unknown): string {
  return `What the field does in this situation could not be asked. ${reason(error)} ${ASK_AGAIN}`;
}

/** The node villain is in, which step 9 compares MDF against. */
export function analyzeFacingProblem(error: unknown): string {
  return `How often the field folds to this bet could not be asked. ${reason(error)} ${ASK_AGAIN}`;
}

/**
 * Step 1's "Load my chart for this spot" found neither the API nor the browser's offline copy.
 * The lead is the replayer's word for word — a reader meets the same failure on both screens —
 * and the retry is the button, so the sentence names it.
 */
export function libraryLookupProblem(error: unknown): string {
  return `${LIBRARY_UNREADABLE} ${reason(error)} Press the button again to try once more.`;
}
