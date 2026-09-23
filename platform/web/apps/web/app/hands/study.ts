/**
 * What the replayer says when a panel has nothing to show (audit §2.13, plan F.12c).
 *
 * Three of these answers used to arrive through `.catch(() => null)`: the panel simply did not
 * appear, which reads as "the field has never played this spot" rather than "nobody was able to
 * ask". The distinction matters most under load — stepping quickly through a hand asks a question
 * per step, and ClickHouse refuses the fifth one ("Too many simultaneous queries for user
 * poker_tenant_1", the per-account budget of plan E.3). Until plan H.0 that refusal reached the
 * browser as a 500 the API had sanitized down to "Internal server error"; it is now a 429 that
 * names itself. Nothing is wrong with the hand and nothing is missing from the pool: the question
 * is simply worth asking again, and these sentences say so.
 *
 * The fourth is the pot-odds pair, which is not a failure at all — a step with no pot behind the
 * bet has nothing for them to work from, and both panels used to say so separately.
 *
 * Every sentence is built here rather than in the template, so it is asserted as text.
 */

import { describeApiError, errorDetail, errorStatus } from '../auth/api';

/** What the API's catch-all sends for anything it did not classify (`api/main.py`). */
const SANITIZED = 'Internal server error';

/**
 * What `stats/tenancy.py` sends, as a 429, when the account already runs as many queries as it
 * may (ClickHouse code 202, plan H.0). It used to arrive as the sanitized 500 above; classified,
 * it carries this sentence, and the replayer still answers it with its own wording below, which
 * names the thing that asked too much. The literal is pinned on both sides (`test_ch_budget.py`).
 */
const QUERIES_AT_ONCE = 'The account is already running as many queries at once as it may; ask again in a moment.';
const TOO_MANY_REQUESTS = 429;

/** Shorter than `describeApiError`'s own: each sentence below spells out its own way to retry. */
const SILENT = 'The API did not answer; start it with `make api` in platform/.';

const UNDER_LOAD =
  'The API failed while answering — stepping quickly through a hand asks several questions at once, and only a few of them are answered at a time.';

/**
 * A 5xx the API would not describe. Before H.0 that was almost always the refusal above; now the
 * refusal is classified, what is left is a fault — a column the statistics do not have yet, a
 * server that is down — and calling it "under load" would send the reader stepping again at
 * something stepping cannot fix.
 */
const API_FAULT = 'The API failed while answering; the reason is in the terminal running `make api`.';

const STEP_AGAIN = 'Stepping to this spot again asks afresh.';

/**
 * Why the answer is missing, in one clause. The 429 that names too many queries at once is worded
 * as this screen's own doing; a 5xx the API would not describe is a fault and says where its reason
 * is; the ones the API does describe — a query over the account's budget, the hour's quota spent,
 * a timeout — keep the server's own sentence, which says something this one cannot.
 *
 * `describeApiError` reads the same sanitized 5xx as "often because several questions were asked
 * at once", which was true before H.0 and is not the replayer's to fix; this copy stays because its
 * wording names the thing that asked too much — stepping through a hand — and the app-wide one
 * cannot.
 */
function reason(error: unknown): string {
  const status = errorStatus(error);
  const detail = errorDetail(error);
  if (status !== undefined && status >= 500 && (detail === null || detail === SANITIZED)) return API_FAULT;
  if (status === TOO_MANY_REQUESTS && detail === QUERIES_AT_ONCE) return UNDER_LOAD;
  return asSentence(describeApiError(error, SILENT));
}

/** A server's detail rarely ends in a full stop, and the retry clause follows it on the same line. */
function asSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** Tier 1 was not answered: what the field does at this node is unknown, not uniform. */
export function poolProblem(error: unknown): string {
  return `The pool could not be asked what the field does here. ${reason(error)} ${STEP_AGAIN}`;
}

/** The empirical EQR beside it (plan F.10) was not answered either. */
export function realizationProblem(error: unknown): string {
  return `What the field won from this situation could not be asked. ${reason(error)} ${STEP_AGAIN}`;
}

/** "Analyze this node" failed. The retry is the button, not the step, so the sentence names it. */
export function analyzeProblem(error: unknown): string {
  return `This situation could not be taken into the analyzer. ${reason(error)} Press Analyze this node again to try once more.`;
}

/** The reveal (plan H.7) was refused for one group. The retry is the button, and the other groups stand. */
export function revealProblem(group: string, error: unknown): string {
  return `The pool could not be asked what ${group} has here. ${reason(error)} Press Reveal again to ask afresh.`;
}

/** The pool's call/fold split for the blocker table (plan H.7) was refused. */
export function blockersProblem(defender: string, error: unknown): string {
  return `The pool could not be asked how ${defender} answers this bet. ${reason(error)} Press Ask the pool again to try once more.`;
}

/**
 * Neither the API nor the offline copy answered the range library — said in `Step1Ranges`'s exact
 * words, because it is the same failure and a reader meets it on both screens.
 */
export const LIBRARY_UNREADABLE = 'Your range library could not be read — neither the API nor this browser’s offline copy answered.';

/**
 * The library answered from the browser's own copy, whose "nothing here" is not the library's: a
 * chart saved since the copy was last refreshed is missing from it, and saying "nothing stored"
 * would be a guess dressed as a fact.
 */
export function offlineRangeNote(libraryError: string | null): string {
  const lead = libraryError === null || libraryError === '' ? '' : `${libraryError} `;
  return `${lead}This browser’s offline copy has no chart of yours for this situation.`;
}

const NOTHING_FACED = 'Nothing to call at this step — pot odds and MDF appear when there is a bet in front.';
const NO_POT_YET =
  'The blinds are still going in, so there is nothing in the pot behind this bet yet — pot odds and MDF appear once there is.';

/**
 * Why pot odds and MDF are not on screen, or `''` when they are.
 *
 * Both panels print "There is no pot to work from…" of their own accord, so mounting them at the
 * step where the big blind is posted — a call of 0.5 with a pot of 0 behind it — said it twice and
 * explained it neither time. The step decides whether there is a question; the panels only draw.
 */
export function oddsPanelsNote(potBefore: number, toCall: number): string {
  if (toCall <= 0) return NOTHING_FACED;
  return potBefore <= 0 ? NO_POT_YET : '';
}
