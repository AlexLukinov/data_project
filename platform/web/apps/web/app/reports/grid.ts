/**
 * The grid's own words: its two app terms, its legend, and how wide a row spanning it must be
 * (plan F.12c, ADR-057).
 *
 * `StatGrid.vue` renders a hundred numbers and three sentences, and the three sentences are the
 * ones that decide whether the numbers are read correctly. They live here rather than in the
 * template for the reason `reports/emptyState.ts` gives: a sentence nailed into a template is a
 * sentence no test reads, and each of these has to stay true of the grid beside it — the legend
 * must not claim every cell clears a threshold when there are no cells at all.
 */

import type { StatMeta } from '../stats/api';
import type { TermEntry } from '../stats/vocabulary';
import { formatN } from './cell';

/**
 * The two words the grid uses that are the grid's own rather than the registry's.
 *
 * "hands" is a column heading whose old explanation reached nobody: it was a `title` on a `<th>`,
 * so no keyboard and no touch, and it said "decision-grain" and "counted by sketch" — engine words
 * for a distinction that matters. The `n` and `thin` a legend needs are `APP_TERMS`', because the
 * KPI tiles and the leak table mean exactly the same thing by them.
 */
export const GRID_TERMS: Record<'hands', TermEntry> = {
  hands: {
    term: 'hands',
    definition: 'How many hands this row covers. It is not the sample behind any one cell beside it: each stat counts only the spots its own situation came up in.',
    formula: 'On a report counted once per decision this is an estimate, because one hand holds several decisions.',
  },
};

/**
 * How many columns a row that spans the whole grid has to cover.
 *
 * The ungrouped case is the one that was wrong: with no group-by the grid still draws an
 * "All hands" column, so the empty-state row was one column short of the table and the border
 * stopped in the middle of it.
 */
export function columnCount(groupBy: readonly string[], stats: readonly StatMeta[], showHands: boolean): number {
  const groups = groupBy.length === 0 ? 1 : groupBy.length;
  return groups + stats.length + (showHands ? 1 : 0);
}

/** What a report with no rows says when the screen mounting the grid has nothing better to say. */
export const NO_ROWS = 'No rows. Nothing in the database matches this situation.';

/** The legend under the grid, in the pieces the two terms sit between. */
export interface LegendView {
  /** Up to the `n` term. */
  readonly opening: string;
  /** From the `n` term to the end of that sentence. */
  readonly counted: string;
  /** How many cells the threshold is holding back, or `''` when it is holding back none. */
  readonly thinCount: string;
  /** What follows the `thin` term, or — with no thin cells — the whole second sentence. */
  readonly note: string;
}

const OPENING = 'Every cell shows the';
const COUNTED = 'it was computed from.';
const THIN_TAIL = ': shown dimmed, and not compared with the field.';

/**
 * The legend, which has to survive a grid with no cells in it.
 *
 * "Every cell here clears 100 observations" over an empty report is not a reassuring sentence, it
 * is a false one — there is no cell that cleared anything — so it is said only when there are
 * cells to say it about.
 */
export function legendView(thin: number, total: number, minN: number): LegendView {
  const legend = { opening: OPENING, counted: COUNTED, thinCount: '', note: '' };
  if (thin > 0) {
    return { ...legend, thinCount: `${formatN(thin)} of ${formatN(total)} cells are under ${formatN(minN)} observations`, note: THIN_TAIL };
  }
  if (total > 0 && minN > 0) return { ...legend, note: `Every cell here clears ${formatN(minN)} observations.` };
  return legend;
}
