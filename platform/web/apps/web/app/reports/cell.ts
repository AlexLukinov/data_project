/**
 * How one cell of the grid is read — and when it must not be read at all (plan D.5, spec §17).
 *
 * Spec §17: *never fabricate a pool number.* A stat grid is where a thin sample most easily
 * passes for a real one, because every cell is the same eight pixels wide: `0.0%` over three
 * observations sits in the same column as `41.0%` over eleven thousand and looks exactly as
 * confident. A baseline makes it worse rather than better — measured on the founder's own hands,
 * VPIP in 5-bet pots from the big blind is `6.67%` against the field's `35.18%`, a **−28.5 point
 * leak** drawn from **fifteen hands**.
 *
 * Hence three rules, all applied here so that no screen can forget one:
 *
 *  1. **Every cell shows its own `n`**, always, next to the value and never only in a tooltip.
 *     The row's hand count is not a substitute: a row of 2,219 flops carries cells of n = 3,
 *     because each stat counts only the decisions where its own situation arose.
 *  2. **Under `MIN_N` the cell is thin**: the value is still shown — hiding it would just move
 *     the guessing elsewhere — but marked as thin and its *delta is withheld*, because a
 *     difference from a handful of observations measures the handful, not the play.
 *  3. **No observations, no number.** `value: null` reads as a dash even when the pool has a
 *     baseline for that row, which it often does (the field has seen every flop; the founder
 *     has not).
 *
 * A `count` never gets a delta either, whatever its sample: the engine dutifully answers
 * `hands` hero 3,245 against pool 9,036,302 with a delta of −9,033,057, which is arithmetic
 * rather than information.
 */

import type { Cell, ConfidenceLevel, Dimension, Stat, StatFormat } from '../stats/api';
import { valueWords } from '../stats/vocabulary';

/**
 * The sample a cell needs before its delta is worth drawing.
 *
 * 100 is the floor the rest of the platform already uses, and using a second number here would
 * make the same cell "enough" on one screen and "thin" on another: `analysis/pool/node_query.py`
 * refuses to print a pool frequency under `MIN_N = 100`, and `analysis/hero/presets.yaml` gives
 * the leak finder `min_n: 100` for the same reason.
 */
export const MIN_N = 100;

/** What a person may set the threshold to. Zero is allowed: "show me everything, I know why." */
export const MIN_N_CHOICES: readonly number[] = [0, 30, 100, 300, 1000];

export interface CellView {
  /** The value as it is read: `41.0%`, `1.35`, `−2.4 bb/100`, `3,245`, or `—`. */
  text: string;
  n: number;
  nText: string;
  /** No observations at all: the value is a dash and nothing is compared. */
  empty: boolean;
  /** Under the threshold: shown, but marked, and not compared. */
  thin: boolean;
  /** The baseline as read, or `''` where there is none to show. */
  baselineText: string;
  /** The signed difference from the baseline, or `''` where it is withheld or absent. */
  deltaText: string;
  /** `'good' | 'bad'` only where the registry commits on direction; `''` otherwise. */
  deltaSense: 'good' | 'bad' | '';
  /** Why this cell is marked, for the title attribute and the screen reader. */
  note: string;
  /**
   * The confidence interval's bounds in the value's own units, or `null` where the server sent
   * none (plan E.2). Both or neither, always — a lone bound is dropped rather than half-drawn,
   * because `MetricValue` would silently render a tile that merely *looks* like it has no band.
   *
   * A **thin** cell keeps its interval deliberately. Thin is exactly the case the interval
   * exists for: `0.0%` over three observations is a Wilson span of 0–56%, and withholding the
   * band there would hide the warning while still printing the number. What thinness withholds
   * is the *delta*, which measures the handful rather than the play.
   */
  low: number | null;
  high: number | null;
  level: ConfidenceLevel | null;
}

const DASH = '—';

/** A percentage reads to a tenth; money and ratios to a hundredth. */
const PERCENT_PLACES = 1;
const MONEY_PLACES = 2;

/**
 * The grouping locale, stated rather than inherited.
 *
 * `toLocaleString()` with no argument follows the browser's locale, so the same number reads
 * `3,245` in a unit test under Node and `3 245` in Chrome on this machine — which means the tests
 * assert a rendering the founder never sees. `PoolDataBadge` already pins `'en-US'` for the same
 * reason; this is that decision applied to the grid.
 */
const LOCALE = 'en-US';

/**
 * A count is whole and separated; everything else has the precision its format implies. Values
 * arrive from the engine already in the unit of their format — a percent is 22.59, not 0.2259 —
 * so `@poker/ui`'s `percent()`, which multiplies a 0..1 share by a hundred, is the wrong tool
 * here and would render 2259.0%.
 */
export function formatValue(value: number | null, format: StatFormat): string {
  if (value === null) return DASH;
  if (format === 'count') return Math.round(value).toLocaleString(LOCALE);
  if (format === 'percent') return `${value.toFixed(PERCENT_PLACES)}%`;
  if (format === 'per100') return `${signed(value, MONEY_PLACES)} bb/100`;
  return value.toFixed(MONEY_PLACES);
}

/** A sample size, always separated: `1443908` is unreadable and `1,443,908` is the point. */
export function formatN(n: number): string {
  return n.toLocaleString(LOCALE);
}

/** `+4.2` / `−2.5`, with a real minus sign rather than a hyphen. */
function signed(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits);
  if (value > 0) return `+${text}`;
  return value < 0 ? `−${text}` : text;
}

/** A delta carries the unit of the thing it is a difference of; percentages are points. */
function formatDelta(delta: number, format: StatFormat): string {
  if (format === 'percent') return `${signed(delta, PERCENT_PLACES)} pts`;
  if (format === 'per100') return `${signed(delta, MONEY_PLACES)} bb/100`;
  return signed(delta, MONEY_PLACES);
}

/**
 * Whether a delta is worth drawing at all: a count's is arithmetic, a thin cell's is noise, and
 * an empty cell has nothing to differ from.
 */
function comparable(cell: Cell, format: StatFormat, thin: boolean, empty: boolean): boolean {
  return !empty && !thin && format !== 'count' && cell.baseline !== null && cell.delta !== null;
}

/**
 * One cell, ready to render. `minN` is the screen's current threshold so that a link which greys
 * a cell greys it for whoever opens the link too.
 */
export function cellView(cell: Cell | undefined, stat: Stat, minN: number = MIN_N): CellView {
  if (cell === undefined) return missing(stat);
  const format = stat.format;
  const empty = cell.value === null || cell.n === 0;
  const thin = !empty && cell.n < minN;
  const compare = comparable(cell, format, thin, empty);
  const band = bounds(cell, empty);
  return {
    text: formatValue(empty ? null : cell.value, format),
    n: cell.n,
    nText: formatN(cell.n),
    empty,
    thin,
    baselineText: cell.baseline === null || format === 'count' ? '' : formatValue(cell.baseline, format),
    deltaText: compare ? formatDelta(cell.delta!, format) : '',
    deltaSense: compare ? sense(cell.delta!, stat.higher_is_better) : '',
    note: note(empty, thin, cell.n, minN),
    ...band,
  };
}

/**
 * The interval as two finite bounds, or three nulls. A partial or non-finite interval is
 * discarded here rather than passed on: `MetricValue` drops the whole support line when one
 * bound is unusable, so a half-sent interval would render as a tile that quietly looks like it
 * never had one. Deciding it in this one place is the same argument as `thin` — no screen can
 * forget the rule if no screen owns it.
 */
function bounds(cell: Cell, empty: boolean): Pick<CellView, 'low' | 'high' | 'level'> {
  const none = { low: null, high: null, level: null };
  const interval = cell.interval;
  if (empty || interval === null || interval === undefined) return none;
  if (!Number.isFinite(interval.low) || !Number.isFinite(interval.high)) return none;
  return { low: interval.low, high: interval.high, level: interval.level };
}

/** A stat the server did not answer for this row. Distinct from one it answered with no data. */
function missing(stat: Stat): CellView {
  return {
    text: DASH,
    n: 0,
    nText: '0',
    empty: true,
    thin: false,
    baselineText: '',
    deltaText: '',
    deltaSense: '',
    note: `${stat.label} was not measured for this row`,
    low: null,
    high: null,
    level: null,
  };
}

/**
 * Which way is better — only where the registry says so. Most stats leave `higher_is_better`
 * `null` (is a 42% fold-to-c-bet good? it depends on the board and on whom), and colouring those
 * green or red would invent a judgement the platform has not made.
 */
function sense(delta: number, higherIsBetter: boolean | null | undefined): 'good' | 'bad' | '' {
  if (typeof higherIsBetter !== 'boolean' || delta === 0) return '';
  return delta > 0 === higherIsBetter ? 'good' : 'bad';
}

function note(empty: boolean, thin: boolean, n: number, minN: number): string {
  if (empty) return 'no observations here';
  if (thin) return `only ${formatN(n)} observations — fewer than the ${formatN(minN)} this view treats as enough, so it is not compared with the field`;
  return '';
}

/**
 * A row's group key as it reads, given the column it is a value of (ADR-057).
 *
 * The dimension is the whole point of the argument. Without it the old wording could only guess:
 * it rewrote `5bet_plus` as `5bet+` for every string it met, which is right for an enum and wrong
 * for a pool player called `a_plus_b`, and it could not print what a bucket named `small` covers
 * because the bounds live on the dimension. `stats/vocabulary.ts` owns both rules, so a row
 * heading, a filter chip and a definition panel cannot spell the same value three ways.
 */
export function formatGroupValue(value: string | number | null, dim?: Dimension): string {
  return valueWords(dim, value);
}
