/**
 * What a column of `/ranges/compare` says when it has no range to draw (audit §2.4, plan F.12c).
 *
 * Three columns, and every one of them used to go quiet in the same flat way — "No chart of yours
 * stored at this situation." That is the truth and none of the lesson: it does not say what the
 * column is for, that a situation has to match to the last step before a stored chart counts as
 * this one, or where a chart comes from in the first place. It was also wrong while the API was
 * away, when the offline copy answers and an empty answer means "not in the copy", not "not
 * stored". So the sentences live here, beside `compareColumn.ts`, which decides *which* of them a
 * column shows — the branch and the words are tested as text rather than mounted and read back.
 *
 * The shape is `~/reports/emptyState`'s: a lead saying what belongs here, a body saying what to do,
 * and actions that are links, because the only way into this library is the Import ranges page.
 */

import type { EmptyStateView } from '../reports/emptyState';

/** The two columns answered from your own library. The pool's is answered by the server instead. */
export type LibraryColumn = 'own' | 'solver';

/** What the page knows about a library column with nothing in it. */
export interface CompareEmptyFacts {
  readonly source: LibraryColumn;
  /** The situation on screen, in the words the editor above the columns gives it. */
  readonly situation: string;
  /** The lookup was answered by this browser's offline copy, because the API did not answer. */
  readonly offline: boolean;
}

const IMPORT_ACTION = { key: 'import', label: 'Import a folder', to: '/ranges/import' } as const;

const EXACT =
  'A stored chart counts as this situation only when it matches exactly: the seats, the stack, the table size, the stake, the board texture and every step of the action.';

const OFFLINE_BODY = `${EXACT} Nothing in this browser's offline copy matches it, and the API did not answer, so a chart saved since the copy was last filled may be missing from it as well. Importing needs the API too, so start it with \`make api\` in platform/ first.`;

const OWN_BODY = `${EXACT} Import the charts you play, or pick a situation you already have one for from the list above. With a chart of yours drawn here, the page also works out what the field does with it.`;

// "set source for all to solver" on its own changes nothing: that box fills a draft, and the rows
// take it when Apply to all is pressed. A reader who stopped at the box saved every chart as their
// own and came back here to the same empty column.
const SOLVER_BODY = `${EXACT} Import your GTO Wizard or PioSOLVER exports on the Import ranges page, set “source for all” to solver, press Apply to all, and then save them.`;

/** One library column with nothing to draw: what belongs here, why it is bare, and the way in. */
export function compareEmptyView(facts: CompareEmptyFacts): EmptyStateView {
  const whose = facts.source === 'own' ? 'Your own chart' : "A solver's range";
  const lead = `${whose} for ${facts.situation} would be drawn here.`;
  if (facts.offline) return { lead, body: OFFLINE_BODY, actions: [] };
  return { lead, body: facts.source === 'own' ? OWN_BODY : SOLVER_BODY, actions: [IMPORT_ACTION] };
}

/**
 * The pool answered and had too few hands to read a range from. The badge beside this says how
 * few and how many it wants; these are the two knobs that actually widen the question, because
 * the stake and each texture word are the conditions the server adds one by one.
 */
export const POOL_THIN =
  'The pool has not shown down enough hands at this situation to read a range from them. A wider situation holds more: clear the stake box above to take every stake, or drop a word from texture.';

/** Nothing was asked, which is not the same as nothing coming back — say which one this is. */
export const POOL_UNASKED =
  'The pool has not been asked about this situation yet. What the field showed down here is drawn as soon as it answers; change the situation above to ask again.';

/** No stored range at all, so the picker beside the columns has nothing to offer either. */
export const LIBRARY_EMPTY: EmptyStateView = {
  lead: 'Your range library is empty, so there is no stored situation to pick from.',
  body: 'Import a folder of charts and each one becomes a situation you can open here, next to what the field does at it.',
  actions: [IMPORT_ACTION],
};

/**
 * Tier 3 asked and the ask failed. Naming the Pool column matters *when it still has something to
 * draw*: what it holds has quietly changed from the field's estimate of *your* range to the hands
 * it showed down. It often has nothing — the three calls go out together and the database refuses
 * them together — and this sentence used to promise a range the reader could see was not there,
 * beside the Pool column's own "could not be asked". So the tail is `showdownDrawn`'s to allow.
 */
export function tier3Problem(reason: string, showdownDrawn: boolean): string {
  const said = `What the field does with your range here could not be worked out. ${reason}`;
  return showdownDrawn ? `${said} The Pool column is showing the range the field showed down instead.` : said;
}
