/**
 * What `/hands` says when the list came back with nothing (audit §2.4).
 *
 * "No hands match." was true and taught nothing. It did not say what this list holds, why it is
 * empty, or which of the four things narrowing it — the situation, a tag, the two date boxes —
 * to let go of. Those sentences live here, beside the transport they describe, so they are
 * asserted as text rather than fished out of a rendered page.
 *
 * The shape, the action labels and the phrase for what narrowed a list come from
 * `~/reports/emptyState`: the same way out should read the same wherever it is offered, and
 * "None of your hands match …" is the same sentence on a list as on a grid.
 */

import type { EmptyAction, EmptyStateView, Narrowing } from '../reports/emptyState';
import { EMPTY_ACTIONS, narrowingWords, widenActions } from '../reports/emptyState';
import type { Dataset } from './api';

/** What the page knows about an empty list: which body of hands, and everything narrowing it. */
export interface HandsEmptyFacts extends Narrowing {
  readonly dataset: Dataset;
  /** The `?tag=` this list is narrowed to (ADR-048); `''` for none. */
  readonly tag: string;
}

const MINE_LEAD = 'Every hand you upload is listed here, newest first; open one to step through it.';
const POOL_LEAD = 'The hands from tables you observed are listed here — every seat at them, not only yours.';
const MINE_EMPTY =
  'Nothing is stored yet. Upload the hand histories your poker site exports and they appear here seconds after they land; to read one hand without storing it, paste it instead. If you have uploaded already, the Upload page says when a file had no seat recognised as yours. To see what a hand looks like stepped through before you have one of your own, open a worked example.';
const POOL_EMPTY =
  'No pool hands are stored yet. Upload the hand histories of the tables you observed on the Upload page and mark them Pool hands.';
const WIDEN = 'Each condition narrows the list, and enough of them leave nothing.';

/** The list with no rows: nothing is stored under this dataset, or the situation is too narrow. */
export function handsEmptyView(facts: HandsEmptyFacts): EmptyStateView {
  const hero = facts.dataset === 'hero';
  const words = narrowingWords(facts);
  if (words === '') return nothingStored(hero);
  return {
    lead: hero ? `None of your hands match ${words}.` : `No hand in the pool matches ${words}.`,
    body: `${WIDEN} Drop one, or look for the same situation in ${hero ? 'the pool' : 'your own hands'}.`,
    actions: [...widenActions(facts), elsewhere(hero)],
  };
}

function elsewhere(hero: boolean): EmptyAction {
  return hero ? EMPTY_ACTIONS.lookInPool : EMPTY_ACTIONS.lookInMine;
}

/**
 * Nothing stored under this dataset. The worked example is offered on *my* hands alone
 * (ADR-073): a reader with no hands of their own has no way to see one stepped through, and an
 * example needs neither an account nor an upload. The pool's empty state is about a body of hands
 * somebody else played, which an example is not, and the list narrowed by a condition is read by
 * somebody who already has data and wants it widened — a link away from it there is noise.
 */
function nothingStored(hero: boolean): EmptyStateView {
  if (hero) return { lead: MINE_LEAD, body: MINE_EMPTY, actions: [EMPTY_ACTIONS.upload, EMPTY_ACTIONS.paste, EMPTY_ACTIONS.example] };
  return { lead: POOL_LEAD, body: POOL_EMPTY, actions: [EMPTY_ACTIONS.upload, EMPTY_ACTIONS.lookInMine] };
}
