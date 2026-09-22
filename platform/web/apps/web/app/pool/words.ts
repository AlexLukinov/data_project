/**
 * What the pool's screens say when something is missing, or in doubt (plan F.12c, audit §2.4).
 *
 * The pool is the area where a blank screen is most ambiguous. A grid with no rows can mean the
 * field never played this way, or that a cohort nobody matches was asked about, or that the saved
 * cohorts never loaded and the report measured every player in the corpus under a name it was not
 * given. Those are three different answers, and all three used to render as the same silence.
 *
 * So the sentences that tell them apart live here, as text a test can read, rather than inside
 * three templates — the reason `reports/emptyState.ts` gives for its own wording, and the reason
 * the pages below carry almost none of their own.
 */

import { formatN } from '../reports/cell';
import type { EmptyStateView } from '../reports/emptyState';
import { COHORT_REBUILD_NOTE } from '../reports/emptyState';
import type { StatMeta } from '../stats/api';

/** The heading over the left grid when no cohort is chosen in the picker. */
const WHOLE_FIELD = 'The whole field';

/**
 * The heading over one grid.
 *
 * "The whole field" is a lie whenever the report carries a cohort of its own: two shipped pool
 * reports do (`regs_by_position`, `fish_by_position`), and `reports/model.ts#build` sends that
 * cohort whenever the picker names none — so the grid was labelled "The whole field" while the
 * numbers under it came from a slice of it. The picker's own choice always wins over a stored rule,
 * which is why `storedRule` is only ever true with no cohort chosen.
 */
export function gridHeading(cohortLabel: string | null, storedRule: boolean): string {
  if (cohortLabel !== null) return cohortLabel;
  return storedRule ? 'The players this report scopes to' : WHOLE_FIELD;
}

/** `GET /v1/pool/presets` failed: there is no standard report and no shipped cohort to offer. */
export function scopeErrorWords(reason: string): string {
  return `The pool's standard reports and its shipped cohorts could not be loaded, so neither is offered below. ${reason}`;
}

/**
 * The shipped cohorts arrived and the saved ones did not. The picker is short rather than empty,
 * which is the one thing nobody can see, so it is said out loud.
 */
export function savedCohortsErrorWords(reason: string): string {
  return `Your own saved cohorts could not be loaded, so only the shipped ones are offered here. ${reason}`;
}

/** The other half, on the cohorts page: the two the pool area ships are the ones that are missing. */
export function shippedCohortsErrorWords(reason: string): string {
  return `The cohorts the pool ships could not be loaded, so only your own are listed here. ${reason}`;
}

/**
 * A write the server accepted, followed by a read-back that failed. Said apart from a refused save
 * on purpose (plan D.6b): the row exists, and a form reopened over it would make a second one.
 */
export const LIST_NOT_REREAD = 'The change was saved. The list below could not be read back afterwards, so it may not show it yet.';

/**
 * A `?cohort=` naming nothing on offer.
 *
 * The link is the cohorts page's own — "Measure the field with this" — and it outlives what it
 * names: deleting a cohort says as much. Until now the key simply failed to resolve and the report
 * ran anyway, measuring every player in the pool under the missing cohort's name. That is the §17
 * failure exactly: an answer to a question nobody asked, indistinguishable from the right one.
 *
 * `listFailed` is either list: a shipped cohort arrives with the presets and a saved one on its own
 * call, so `?cohort=preset:regs` after a failed presets call resolves to nothing for a reason that
 * has nothing to do with deletion — and the error above it already says so.
 */
export function unknownCohortWords(key: string, listFailed: boolean): string {
  const why = listFailed
    ? 'some of the cohorts on offer could not be loaded, so it may well still exist'
    : 'it has been deleted, or the link was typed by hand';
  return `This link asks for a cohort the pool does not offer (“${key}”) — ${why}. Nothing has run: measuring the whole field under that name would answer a different question. Choose a cohort under “Which players”, or the whole field.`;
}

const PLAYER_LEAD = 'Every opponent at the tables you uploaded as Pool hands, by screen name. Type any part of one to read their game.';

/**
 * What `/pool/players` is for, with the stats it answers named — once the route has named them.
 *
 * Those seven codes used to be a `PLAYER_STATS` constant here, because the search was a report
 * this client assembled and something had to choose the columns. `POST /v1/pool/players` chooses
 * them now (ADR-062), and it sends their labels back with every answer, so the sentence reads them
 * off the answer rather than promising a list before anything has been asked. Before the first
 * search it simply says less: a page that has not asked the server anything knows nothing about
 * what the server will send, and the whole of ADR-062 is about a screen asserting otherwise.
 */
export function playerIntroWords(shown: readonly StatMeta[]): string {
  return shown.length === 0 ? PLAYER_LEAD : `${PLAYER_LEAD} You get ${list(shown.map((stat) => stat.label))}.`;
}

/**
 * How many names matched, when more matched than the answer holds — and nothing at all when the
 * list on screen *is* every match, which is the common case for a name somebody actually typed.
 *
 * **"Matched", never "contain".** The route lower-cases what was typed and, when a real site
 * precedes a colon, splits the site off and matches only the rest inside the name half. So the
 * text quoted here is what was *asked*, and it is not in general a substring of anything: typing
 * `MAN` matches 1,469 names, not one of which contains `MAN`, because every stored key is lowered.
 * A sentence that said "contain" would be a false claim about the answer below it — the same
 * shape of untruth ADR-062 removed from the answer itself, moved up into the sentence over it.
 *
 * `matched_capped` is the reason this takes three numbers rather than comparing two, and why the
 * word is **"at least"**. The route counts up to the engine's ceiling and stops (`matched_capped`
 * is `len(rows) >= MAX_MATCHES`, and the query is capped at exactly that), so a capped answer
 * counted exactly the ceiling and the truth about the world is "the ceiling or more". "More than"
 * is the one word that would make the sentence off by one in the very case it exists for.
 */
export function matchedWords(searched: string, matched: number, shown: number, capped: boolean): string {
  if (!capped && matched <= shown) return '';
  const many = capped ? `At least ${formatN(matched)} names` : `${formatN(matched)} names`;
  // `shown` is the answer's own row count and the route's default puts 50 of them here, but this
  // is an exported function taking a number: one row would otherwise read "The 1 … are below".
  const busiest = shown === 1 ? 'The busiest one is below' : `The ${formatN(shown)} with the most hands are below`;
  return `${many} matched “${searched}”. ${busiest}, the name typed in full first — type more of it to narrow them.`;
}

/** `a`, `a and b`, `a, b and c` — the form the rest of the app lists things in. */
function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * No name matched. The text is the one that was **searched**, not the one in the box: the box is
 * edited while the answer stays on screen, and a sentence that follows the typing describes a
 * search nobody ran.
 *
 * "Matched" rather than "contains", for the reason `matchedWords` gives — and the site clause says
 * what is true of *both* shapes the route accepts. It is not "the site is never searched": paste a
 * whole key and the site before the colon has to match exactly. What is always true is that the
 * site is not part of the name, which is the thing a reader gets wrong.
 */
export function noPlayerWords(searched: string): string {
  return `Nothing in the pool matched “${searched}”. Any part of a name matches, in any case, so a shorter piece of it finds more — but the site a key starts with is not part of the name, and searching for one looks for people who have it in theirs. Only players at tables you uploaded as Pool hands can be found: upload more on the Upload page.`;
}

/** The search found the name in the daily statistics, and the stat report came back with nothing. */
export const PLAYER_NO_ROWS = 'The search found this name, but no numbers were counted for it under these stats.';

/**
 * The cohort form with no stats to build a rule from. Only a failed registry gets here: the
 * registry serves 65 stats and a rule needs one, so the form is otherwise never empty — and a
 * select with no options says nothing about why.
 */
export const NO_STATS_FOR_RULES =
  'The stat registry did not load, so there is no stat to build a rule from. Reload the page once the app can reach the server again.';

/** `/pool/cohorts` with nothing in it — which is also the only state that can be taught in. */
export function cohortsEmptyView(): EmptyStateView {
  return {
    lead: 'No cohorts yet, so every number on the pool page is the whole field.',
    body: 'Press New cohort and give it a name and a rule — VPIP is below 25 over at least 1,000 hands, say. A report can then be scoped to whoever matches it on the day it runs.',
    actions: [{ key: 'new', label: 'New cohort' }],
  };
}

/** A saved cohort whose rules nobody meets. Not an error, and not a list waiting to load. */
export function emptyMembersView(): EmptyStateView {
  return {
    lead: 'No player matches every rule right now.',
    body: `Every rule has to hold at once, so two ordinary thresholds together can leave nobody. Loosen one with Edit, or measure the whole field on the pool page. ${COHORT_REBUILD_NOTE}`,
    actions: [
      { key: 'edit', label: 'Edit' },
      { key: 'field', label: 'The pool', to: '/pool' },
    ],
  };
}
