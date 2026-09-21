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

import type { EmptyStateView } from '../reports/emptyState';
import { COHORT_REBUILD_NOTE } from '../reports/emptyState';
import type { Stat } from '../stats/api';
import { PLAYER_STATS } from './stats';

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
 * What `/pool/players` is for, with the stats it answers named.
 *
 * The list is `PLAYER_STATS` read through the registry rather than retyped: those seven codes are
 * the report this page runs, and a label written here would be a second spelling of a word the
 * server already sends.
 */
export function playerIntroWords(stats: readonly Stat[]): string {
  const labels = new Map(stats.map((stat) => [stat.code, stat.label]));
  const named = PLAYER_STATS.filter((code) => labels.has(code)).map((code) => labels.get(code)!);
  return named.length === 0 ? PLAYER_LEAD : `${PLAYER_LEAD} You get ${list(named)}.`;
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
 */
export function noPlayerWords(searched: string): string {
  return `No name in the pool contains “${searched}”. It matches any part of a name, in any case, so a shorter piece of it finds more. Only players at tables you uploaded as Pool hands can be found — upload more on the Upload page.`;
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
