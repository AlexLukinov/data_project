/**
 * What one column of `/ranges/compare` shows (POKER_UX_AUDIT.md §2.4, §2.13; ADR-053).
 *
 * The order is the point. A column whose answer is still on its way says so, whatever it showed
 * for the previous situation — the empty sentence used to appear while the lookup ran. A pool
 * call that failed is an error, never "insufficient data": that is an answer, and there was none.
 * "Insufficient data" needs an answer that said so, and a pool that was never asked says that.
 */

export type ColumnSource = 'own' | 'solver' | 'pool';
export type AsyncStatus = 'idle' | 'pending' | 'success' | 'error';
export type ColumnView = 'loading' | 'error' | 'range' | 'insufficient' | 'unasked' | 'empty';

/** What the page knows about one column. */
export interface ColumnFacts {
  source: ColumnSource;
  /** The status of the call that answers this column: the library lookup, or the showdown range. */
  status: AsyncStatus;
  /** That call threw. */
  failed: boolean;
  /** There is a range to draw. The pool's can come from tier 3 or the library while its own call failed. */
  hasRange: boolean;
  /** The pool's showdown call answered, enough or not. Ignored for the library columns. */
  answered: boolean;
}

/** The one thing a column shows. */
export function columnView(facts: ColumnFacts): ColumnView {
  if (facts.status === 'pending') return 'loading';
  if (facts.source !== 'pool') {
    if (facts.failed) return 'error';
    return facts.hasRange ? 'range' : 'empty';
  }
  if (facts.hasRange) return 'range';
  if (facts.failed) return 'error';
  return facts.answered ? 'insufficient' : 'unasked';
}
