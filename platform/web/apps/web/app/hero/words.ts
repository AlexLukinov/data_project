/**
 * What My game says in sentences rather than in numbers (plan F.12c, ADR-057).
 *
 * The page's prose had drifted away from the figures it describes. The one number the founder
 * most wants — the distance between what the pots paid and what the hands were worth — was
 * announced under **three** names on one screen: "all-in EV" in the luck sentence, "EV" in the
 * chart legend, and "EV bb/100" on the tile beside them. A reader has no way of telling three
 * names from three numbers. The registry has exactly one name for it, in the description of
 * `ev_bb_per_100`: *all-in adjusted*. That is the name used here, everywhere.
 *
 * The sentences live in a module rather than in `pages/index.vue` for the reason
 * `hands/searchable.ts` gives: a sentence nailed into a template is a sentence no test reads.
 * They are also **built from what is on screen** — the unit and precision come from the tile's own
 * format, the chart's caption from `SERIES` — so renaming a line or changing a unit moves the
 * prose with it instead of leaving it behind.
 */

import type { EmptyStateView } from '../reports/emptyState';
import { EMPTY_ACTIONS } from '../reports/emptyState';
import type { TermEntry } from '../stats/vocabulary';
import type { KpiTileView } from './kpis';
import { evGap } from './kpis';
import type { SeriesKey, SeriesSpec } from './winnings';
import { SERIES } from './winnings';

/** The rate the luck sentence is read in; the all-in adjusted one is `evGap`'s own business. */
const ACTUAL_CODE = 'bb_per_100';

/**
 * Under this many big blinds per 100 the two winrates are the same winrate, and the sentence says
 * so instead of dressing a rounding difference as a run of luck.
 */
const SAME_RATE = 0.5;

/**
 * The registry's own name for `ev_bb_per_100`, whose description opens with it ("All-in adjusted
 * big blinds won per 100 hands."). `words.test.ts` pins that against the registry file itself, so
 * the day the description is rewritten this sentence fails loudly rather than quietly ageing.
 */
export const ADJUSTED_WORDS = 'all-in adjusted';

/**
 * The one sentence the dashboard exists to say: were the cards paid, or were they not?
 *
 * It is arithmetic on two numbers the server sent, so it is stated only when `evGap` has both —
 * never "you are running about average" by default, and never over a sample too thin to carry it.
 */
export function luckWords(tiles: readonly KpiTileView[]): string {
  const gap = evGap(tiles);
  const actual = tiles.find((tile) => tile.code === ACTUAL_CODE);
  if (gap === null || actual === undefined) return '';
  const size = `${Math.abs(gap).toFixed(actual.format.digits)} ${actual.format.unit}`;
  if (Math.abs(gap) < SAME_RATE) {
    return `Your winrate and its ${ADJUSTED_WORDS} twin are within ${size} of each other — the cards have paid about what they were worth.`;
  }
  const side = gap < 0 ? 'below' : 'above';
  const paid = gap < 0 ? 'less' : 'more';
  return `You are running ${size} ${side} your ${ADJUSTED_WORDS} winrate: the pots have paid ${paid} than the hands were worth.`;
}

/** A line of the winnings graph by name — `SERIES` is the one place the four are named. */
function seriesLabel(key: SeriesKey): string {
  return SERIES.find((series) => series.key === key)?.label ?? key;
}

/**
 * The paragraph over the winnings graph.
 *
 * The same four lines used to be named twice — once in `SERIES` for the legend, once in a
 * hard-coded sentence above the chart — so renaming one moved half the screen and not the rest.
 */
export function winningsCaption(): string {
  return [
    'Running totals in big blinds; the dashed line across the middle is break-even.',
    `${seriesLabel('showdown')} and ${seriesLabel('nonShowdown')} add up to the ${seriesLabel('net')} line, and ${seriesLabel('ev')} is what the hands were worth when the money went in.`,
    'Click a name to hide a line — the axis rescales to what is left.',
  ].join(' ');
}

/**
 * A legend entry as a term: the line's own name, and the sentence saying what it draws.
 *
 * The legend buttons carried this on a `title`, which a browser shows on hover and on nothing
 * else — no keyboard, no touch — on the one control a reader has to understand before the chart
 * means anything.
 */
export function seriesTerm(series: SeriesSpec): TermEntry {
  return { term: series.label, definition: series.description };
}

/**
 * The chart with no points. It names the Upload page by its label rather than telling anyone to
 * "import a session", which is not something this app has ever been able to do.
 */
export const WINNINGS_EMPTY =
  'No hands in this range, so there is no curve to draw. Widen the dates above, or upload more hand histories on the Upload page.';

// Not "nothing is stored yet": a file whose seat did not resolve (ADR-051 §7) stores every one of
// its hands and My game counts none of them, so the lead says what this page can see — that no
// hand is counted as the founder's — and the body carries the same pointer at the Upload page's
// warning that `hands/emptyState.ts` and `reports/emptyState.ts` carry.
const NOTHING_STORED_LEAD = 'No hand of yours is counted yet, so there is nothing here to measure.';
const NOTHING_STORED_BODY =
  'Upload the hand histories your poker site exports on the Upload page, and every number here — the winrate, the leaks, the sittings — starts counting seconds after they land. ' +
  'If you have uploaded already, the Upload page says when a file had no seat recognised as yours.';
const NO_HANDS_IN_RANGE_LEAD = 'No hands were played in these dates, so there is nothing here to measure.';
const NO_HANDS_IN_RANGE_BODY =
  'Clear the two date boxes above to read your whole history, or upload the hand histories of the days you are looking for on the Upload page.';

/**
 * My game before a hand of the founder's own is counted, or narrowed to days nothing was played.
 *
 * Eight tiles of dashes are an honest screen and a silent one: they say the numbers are missing
 * and nothing about why, or about the one thing to do next. Deliberately two short branches and
 * no more — an account with no hands is a first run, not a puzzle to be walked through.
 *
 * `hands` is the report's own count (`ReportResult.hands`) rather than the hands tile, because a
 * tile reads `null` both for "nothing was counted" and for "nothing has answered yet", and those
 * two must not share a screen: the second is the pending line's business. `null` here means the
 * request has not answered, and returns nothing to say.
 */
export function heroEmptyView(hands: number | null, dates: { from: string; to: string }): EmptyStateView | null {
  if (hands === null || hands > 0) return null;
  if (dates.from === '' && dates.to === '') {
    return { lead: NOTHING_STORED_LEAD, body: NOTHING_STORED_BODY, actions: [EMPTY_ACTIONS.upload] };
  }
  return {
    lead: NO_HANDS_IN_RANGE_LEAD,
    body: NO_HANDS_IN_RANGE_BODY,
    actions: [EMPTY_ACTIONS.clearDates, EMPTY_ACTIONS.upload],
  };
}
