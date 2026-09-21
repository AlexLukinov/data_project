/**
 * The winnings graph's geometry (plan D.4), worked out as plain arithmetic so it can be tested
 * without a browser.
 *
 * **The four lines are the point of the screen.** `net` is what the pots actually paid;
 * `ev` is what they were worth when the money went in all-in; `showdown` and `nonShowdown`
 * decompose `net` exactly (`showdown + nonShowdown === net`, every day). Drawn together they
 * answer the question a results graph alone cannot: *was I unlucky, or am I losing?* On the
 * founder's own history the two lines separate for the first time — −1.37 bb/100 actual against
 * +0.28 EV — and the decomposition says where it went.
 *
 * **Three decisions that the arithmetic here enforces.**
 *
 * 1. **The x axis is calendar time, not point index.** A day with no hands is a day with no
 *    point, and spacing points evenly would draw a fortnight's break the same width as an
 *    overnight one — which makes the slope, the only thing a cumulative line means, a lie.
 *    Positions come from the dates themselves.
 * 2. **The y domain always contains zero.** Zero is break-even; a cumulative winnings chart
 *    scaled to its own data can show a line that never crosses it and read as though it did.
 * 3. **The domain is computed from the *visible* series only.** Showdown and non-showdown run
 *    an order of magnitude further from zero than the net does (on this data ±2,000 bb against
 *    −272), so with all four on, the two lines the founder is comparing are squashed into the
 *    middle. Hiding a pair is therefore not a cosmetic toggle — it is how the comparison gets
 *    its resolution back, and the axis must follow. Two y-scales at once would be the other,
 *    forbidden answer.
 */

import type { WinningsPoint } from './api';

export type SeriesKey = 'net' | 'ev' | 'showdown' | 'nonShowdown';

export interface SeriesSpec {
  key: SeriesKey;
  label: string;
  /** Plain English, one sentence, shown on the legend button's own tip and read to a screen reader. */
  description: string;
  /**
   * A dash pattern, `''` for a solid line. Identity is never colour alone (the palette clears
   * its colour-blindness checks, and this is the belt beside those braces): the counterfactual
   * line is dashed, and the two decomposition lines are dotted and thinner than the totals.
   */
  dash: string;
  /** Stroke width in viewBox units. The two totals lead; the decomposition recedes. */
  width: number;
}

/**
 * The series in fixed order. The order is also the colour order — slot 1 is always `net`,
 * whatever is hidden — so toggling a line never repaints the ones that remain.
 */
export const SERIES: readonly SeriesSpec[] = [
  { key: 'net', label: 'Actual', description: 'Big blinds the pots actually paid, as a running total.', dash: '', width: 2 },
  { key: 'ev', label: 'All-in adjusted', description: 'What the hands were worth when the money went in all-in, as a running total.', dash: '6 4', width: 2 },
  { key: 'showdown', label: 'Showdown', description: 'The part of the actual line won at showdown.', dash: '1 4', width: 1.5 },
  { key: 'nonShowdown', label: 'Non-showdown', description: 'The part won without a showdown — bets that took the pot.', dash: '1 4', width: 1.5 },
];

/** The drawing box, in viewBox units. Width is nominal; the SVG scales to its container. */
export const BOX = { width: 720, height: 260, left: 56, right: 84, top: 12, bottom: 26 } as const;

/** Roughly how many gridlines to aim for. A target, not a promise — the ladder decides. */
const Y_TICK_TARGET = 5;
const X_TICK_TARGET = 6;

/** Headroom above and below the data so a line never runs along the frame. */
const PADDING = 0.08;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MS_PER_DAY = 86_400_000;

/**
 * A `YYYY-MM-DD` date as a whole number of days since the epoch.
 *
 * Parsed field by field into a UTC timestamp rather than handed to `new Date(text)`: the string
 * form is only specified for ISO dates, and a local-time parse would shift a day across the
 * date line and put two sessions on one point for a founder in the wrong time zone.
 */
export function epochDay(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined || Number.isNaN(year + month + day)) {
    return Number.NaN;
  }
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** `18 Aug` — short, unambiguous, and never dependent on the reader's locale. */
export function dayLabel(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  if (month === undefined || day === undefined) return iso;
  return `${day} ${MONTHS[month - 1] ?? '?'}`;
}

export interface Plotted {
  day: string;
  label: string;
  hands: number;
  x: number;
  /** The y of each series at this day, whether or not the series is currently drawn. */
  y: Record<SeriesKey, number>;
  values: Record<SeriesKey, number>;
}

export interface Tick {
  value: number;
  offset: number;
  label: string;
}

export interface EndLabel {
  key: SeriesKey;
  x: number;
  y: number;
  label: string;
}

export interface Geometry {
  points: Plotted[];
  paths: { key: SeriesKey; d: string }[];
  yTicks: Tick[];
  xTicks: Tick[];
  /** Where break-even sits, always inside the box because the domain always contains zero. */
  zeroY: number;
  min: number;
  max: number;
  /** The last value of each visible series, placed for a direct label beside the line. */
  ends: EndLabel[];
}

/**
 * A nice round step for an axis: 1, 2 or 5 times a power of ten, whichever lands nearest the
 * target number of ticks. A step of 137.4 is a correct axis and an unreadable one.
 */
export function niceStep(span: number, target: number): number {
  if (!(span > 0)) return 1;
  const rough = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const multiple of [1, 2, 5]) {
    if (rough <= multiple * magnitude) return multiple * magnitude;
  }
  return 10 * magnitude;
}

/**
 * A number with a real minus sign, as `reports/cell.ts` prints one.
 *
 * `toLocaleString` emits a hyphen-minus, which is narrower than the digits beside it and reads
 * as a dash rather than a sign. Every other number on the platform uses `−`; an axis that did
 * not would be the one place the typography changed for no reason.
 */
function money(value: number, digits: number): string {
  const text = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return value < 0 ? `−${text}` : text;
}

/** A tick value with only the decimals it needs: `1,500` and `0.5`, never `1500.00`. */
function tickLabel(value: number, step: number): string {
  const digits = step >= 1 ? 0 : Math.min(2, Math.ceil(-Math.log10(step)));
  return money(value, digits);
}

/**
 * The visible domain: the extremes of the drawn series, zero, and a little headroom.
 *
 * Zero is forced in rather than merely allowed, which also makes the empty-ish case safe — a
 * single flat series at zero still yields a domain with height instead of a division by zero.
 */
export function domain(points: readonly WinningsPoint[], visible: readonly SeriesKey[]): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const point of points) {
    for (const key of visible) {
      const value = point[key];
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  const pad = (max - min) * PADDING;
  if (pad === 0) return { min: min - 1, max: max + 1 };
  return { min: min - pad, max: max + pad };
}

/**
 * Everything the chart draws, for these points and these visible series.
 *
 * Returns `null` for no points at all: the caller renders the empty state. A chart that drew
 * axes with no line would be the "never a fabricated number" promise failing in the other
 * direction — an empty frame reads as "you lost nothing", not as "there is nothing here".
 */
export function geometry(
  points: readonly WinningsPoint[],
  visible: readonly SeriesKey[],
  box: typeof BOX = BOX,
): Geometry | null {
  if (points.length === 0) return null;

  const days = points.map((point) => epochDay(point.day));
  const first = days[0]!;
  const span = days[days.length - 1]! - first;
  const plotWidth = box.width - box.left - box.right;
  const plotHeight = box.height - box.top - box.bottom;

  /** Calendar position. A single day, or every hand on one day, sits at the left edge. */
  const xOf = (at: number): number => (span <= 0 ? box.left : box.left + ((days[at]! - first) / span) * plotWidth);

  const { min, max } = domain(points, visible);
  const yOf = (value: number): number => box.top + (1 - (value - min) / (max - min)) * plotHeight;

  const plotted = points.map((point, at) => plot(point, xOf(at), yOf));
  const drawn = SERIES.filter((series) => visible.includes(series.key));

  const paths = drawn.map((series) => ({
    key: series.key,
    d: `M ${plotted.map((point) => `${point.x.toFixed(1)},${point.y[series.key].toFixed(1)}`).join(' L ')}`,
  }));

  const xTicks: Tick[] = xTickIndices(points.length, X_TICK_TARGET).map((at) => ({
    value: days[at]!,
    offset: xOf(at),
    label: plotted[at]!.label,
  }));

  const last = plotted[plotted.length - 1]!;
  const ends = spread(
    drawn.map((series) => ({
      key: series.key,
      x: last.x,
      y: last.y[series.key],
      label: money(Math.round(last.values[series.key]), 0),
    })),
  );

  return { points: plotted, paths, yTicks: yAxis(min, max, yOf), xTicks, zeroY: yOf(0), min, max, ends };
}

/** One day placed: its x from the calendar, and a y for every series whether drawn or not. */
function plot(point: WinningsPoint, x: number, yOf: (value: number) => number): Plotted {
  const values = { net: point.net, ev: point.ev, showdown: point.showdown, nonShowdown: point.nonShowdown };
  return {
    day: point.day,
    label: dayLabel(point.day),
    hands: point.hands,
    x,
    values,
    y: { net: yOf(values.net), ev: yOf(values.ev), showdown: yOf(values.showdown), nonShowdown: yOf(values.nonShowdown) },
  };
}

/**
 * The height of an end label, in viewBox units — its font size plus a hair of breathing room.
 * Two labels closer than this overlap and become unreadable.
 */
export const LABEL_GAP = 12;

/**
 * Push end labels apart where they would sit on top of each other.
 *
 * The lines this chart draws routinely finish close together: actual and EV end at −272 and +56
 * on the founder's own history, which is 5 viewBox units apart and one illegible smudge. The
 * labels move; the lines and their dots do not, so nothing about the data is misrepresented —
 * only the text that names it is nudged off its neighbour.
 *
 * Sorted top to bottom, then each label is pushed below the one above it where it has to be.
 * Keeps the `y` order stable, so a label never crosses another and swaps their identities.
 */
export function spread(ends: readonly EndLabel[], gap: number = LABEL_GAP): EndLabel[] {
  const sorted = [...ends].sort((a, b) => a.y - b.y);
  let floor = Number.NEGATIVE_INFINITY;
  for (const end of sorted) {
    end.y = Math.max(end.y, floor);
    floor = end.y + gap;
  }
  return sorted;
}

/** Gridlines on a round step, every one of them inside the drawn domain. */
function yAxis(min: number, max: number, yOf: (value: number) => number): Tick[] {
  const step = niceStep(max - min, Y_TICK_TARGET);
  const ticks: Tick[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) {
    // -0 is a real float and prints as "-0"; adding zero folds it back onto 0.
    const at = value + 0;
    ticks.push({ value: at, offset: yOf(at), label: tickLabel(at, step) });
  }
  return ticks;
}

/**
 * Which points get an x label: evenly spaced by *index*, and always the last one.
 *
 * Deliberately not evenly spaced by date — the labels name real points, and a label under empty
 * space would invite reading a value off a day nothing was played.
 */
export function xTickIndices(count: number, target: number): number[] {
  if (count <= target) return Array.from({ length: count }, (_, at) => at);
  const stride = (count - 1) / (target - 1);
  const seen = new Set<number>();
  for (let tick = 0; tick < target; tick += 1) seen.add(Math.round(tick * stride));
  seen.add(count - 1);
  return [...seen].sort((a, b) => a - b);
}

/**
 * The point nearest a position along the x axis — what the crosshair snaps to.
 *
 * A linear scan: eighteen days today and a few thousand at the outside, which is far below the
 * point where a binary search would earn the extra branch.
 */
export function nearestPoint(points: readonly Plotted[], x: number): Plotted | null {
  let best: Plotted | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const gap = Math.abs(point.x - x);
    if (gap < bestGap) {
      bestGap = gap;
      best = point;
    }
  }
  return best;
}
