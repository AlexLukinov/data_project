/**
 * What a hero number says about itself (plan F.12, spec §13 "Explain the number").
 *
 * `words.ts` is what the **page** says — the luck sentence, the chart's caption, the empty states.
 * This is what a **figure** says: the one-line reading beside a KPI tile, a leak row and the
 * sittings table, generated from the values already computed for them.
 *
 * **The rule these obey, and the reason they are not prose in a template.** A reading may only say
 * what the numbers on screen support, so every clause is a branch on a value rather than a
 * sentence someone believed when they wrote it:
 *
 *  - a tile compares the field with the *band*, not with the point estimate, so "you are 3.8
 *    points above the field" never appears over a sample that cannot tell the two apart;
 *  - a stat the registry gives no better end to is read as a **difference**, never as a fault —
 *    `deltaSense`/`higher_is_better` is `null` for most frequency stats on purpose
 *    (`reports/cell.ts#sense`), and colouring or wording those would invent a judgement the
 *    platform has not made;
 *  - a sample under `MIN_N` says so and claims nothing else, which is the same floor the grid and
 *    the leak finder use (`reports/cell.ts`, `analysis/hero/presets.yaml`);
 *  - nothing measured, or nothing to compare with, returns `''` — a tile with no field behind it
 *    (every `count`) gets no reading rather than a reading about nothing.
 *
 * They are also deliberately **not restatements**. The tile already prints its value, its band and
 * its `n`; the leak row prints four numbers; the sittings table prints its totals. What none of
 * them prints is the *verdict* — whether the difference survives the sample, which way it points
 * when the registry commits to one, and whether one sitting swings further than the whole result.
 * That is what is here, and it is tested as text (`readings.test.ts`).
 */

import { MIN_N, formatN } from '../reports/cell';
import type { Leak, SessionsResult } from './api';
import type { KpiTileView } from './kpis';
import { THIN_HANDS } from './sessions';

/** A percentage band and a percentage value read to a tenth, as every leak figure does. */
const PERCENT_PLACES = 1;

/** Too few measurements to compare, said as the consequence: the tip on the word says how few. */
const TOO_THIN = 'Too few measurements here to say whether this differs from the field at all.';

/** What the registry's `higher_is_better` means for the gap, and what its absence means. */
const SENSE_WORDS: Readonly<Record<'good' | 'bad' | '', string>> = {
  good: 'This stat has a better end, and you are on it.',
  bad: 'This stat has a better end, and you are on the wrong side of the field.',
  '': 'Neither end of this stat is better than the other, so this is a difference to explain rather than a fault to fix.',
};

/**
 * The same, but only claiming a side once there is one.
 *
 * Found in the browser on the founder's own data: −1.37 bb/100 with a band of ±9.52 reads "the
 * field's −7.54 falls inside your 95% band, so this many hands cannot tell the two apart" — and
 * the old code then added "you are on the better end", which is the claim the clause before it had
 * just withdrawn. `deltaSense` is computed from the point estimate (`reports/cell.ts#sense`), so it
 * has an opinion wherever the delta is non-zero; whether that opinion is *earned* is this
 * function's question. "Neither end is better" is kept in both branches: that is a property of the
 * stat, true whatever the sample.
 */
function senseWords(sense: 'good' | 'bad' | '', settled: boolean): string {
  if (sense === '') return SENSE_WORDS[''];
  if (!settled) return 'Which side of the field you are on is not settled by this many hands.';
  return SENSE_WORDS[sense];
}

/**
 * One KPI tile's reading: does the field's number fall inside your own confidence band?
 *
 * That is the question the tile poses and does not answer. It prints `22.59 % ± 0.58` and, beside
 * it, `the field 24.61 % −2.02 pts` — two numbers and a gap, with nothing saying whether 19,802
 * hands are enough for the gap to be about the play rather than about the sample. Comparing the
 * baseline with the *bounds* answers it from figures the server already sent.
 *
 * Returns `''` where there is nothing to read: no observations, or no field to compare with (every
 * `count`, whose delta `reports/cell.ts` withholds as arithmetic).
 */
export function tileReading(tile: KpiTileView): string {
  const { view } = tile;
  if (view.empty || view.baselineText === '') return '';
  if (view.thin) return TOO_THIN;
  const band = bandVerdict(tile);
  const verdict = band?.words ?? deltaVerdict(tile);
  if (verdict === '') return '';
  // With no band the difference is taken as read — `cellView` has already withheld the delta over
  // a thin sample — and the sentence says instead how much of it is unaccounted for.
  return `${verdict} ${senseWords(view.deltaSense, band === null || band.settled)}`;
}

/**
 * The field against the band, when the server sent one, and whether that settles a difference.
 * `null` when it sent none, which is a different sentence rather than a missing clause.
 */
function bandVerdict(tile: KpiTileView): { words: string; settled: boolean } | null {
  const { low, high, baseline, level, view } = tile;
  if (low === null || high === null || baseline === null) return null;
  const inside = baseline >= low && baseline <= high;
  const tail = inside
    ? 'so this many hands cannot tell the two apart'
    : "so the gap is wider than this sample's own uncertainty";
  return {
    words: `The field's ${view.baselineText} falls ${inside ? 'inside' : 'outside'} your ${level}% band, ${tail}.`,
    settled: !inside,
  };
}

/**
 * The fallback where no interval came back — `ratio` stats have none by name (plan E.2), and a
 * per-100 answered off the daily rollup has none either. The gap is still worth reading; how much
 * of it is sampling is not known here, and saying so is the honest half.
 */
function deltaVerdict(tile: KpiTileView): string {
  const { view } = tile;
  if (view.deltaText === '') return '';
  return `That is ${view.deltaText} from the field's ${view.baselineText} over ${view.nText} measurements, with no confidence band behind it, so how much of the gap is the sample is not known here.`;
}

/** `62.0%`, the precision every percentage on a leak row is read to. */
function leakPercent(value: number): string {
  return `${value.toFixed(PERCENT_PLACES)}%`;
}

/** Which way the gap points, in the words the row's colour only hints at. */
function leakDirection(leak: Leak): string {
  const side = leak.delta >= 0 ? 'above' : 'below';
  const sense: 'good' | 'bad' | '' =
    typeof leak.higher_is_better !== 'boolean' || leak.delta === 0
      ? ''
      : leak.delta > 0 === leak.higher_is_better
        ? 'good'
        : 'bad';
  // A leak carries no interval, so `settled` is what the leak finder's own floor gives it: every
  // row on screen cleared `min_n`, and `leakSample` says so where a caller lowered that floor.
  return `${leakPercent(leak.value)} against the field's ${leakPercent(leak.baseline)} puts you ${Math.abs(leak.delta).toFixed(PERCENT_PLACES)} points ${side} it. ${senseWords(sense, leak.n >= MIN_N)}`;
}

/**
 * Where the number sits in the band the registry says the stat usually falls in.
 *
 * The useful case is the one a gap alone hides: a value **inside** its usual band that still
 * differs from this field means the field is unusual, not the play — which is the opposite
 * conclusion from the one a red gap invites. Said only where the registry commits to a band.
 */
function leakBand(leak: Leak): string {
  const band = leak.typical;
  if (band === null || band === undefined) return '';
  const [low, high] = band;
  const usual = `the ${low}–${high}% this stat usually falls in`;
  if (leak.value < low) return `At ${leakPercent(leak.value)} you are below ${usual}.`;
  if (leak.value > high) return `At ${leakPercent(leak.value)} you are above ${usual}.`;
  return `${leakPercent(leak.value)} is itself inside ${usual}, so the gap is to this field rather than to normal play.`;
}

/**
 * A leak measured over fewer spots than the platform's one floor.
 *
 * The leak finder applies `min_n` server-side, so this is normally silent — it fires when the
 * caller lowered the floor, which is exactly when a row most needs to say what it is resting on.
 */
function leakSample(leak: Leak): string {
  if (leak.n >= MIN_N) return '';
  return `It rests on ${formatN(leak.n)} spots, under the ${formatN(MIN_N)} this app treats as enough to compare, so read it as a hint rather than a finding.`;
}

/**
 * One leak row's reading: which way the gap points, whether the number is unusual in itself, and
 * what it rests on. The row prints the four numbers; this says what they mean.
 */
export function leakReading(leak: Leak): string {
  return [leakDirection(leak), leakBand(leak), leakSample(leak)].filter((part) => part !== '').join(' ');
}

/** Big blinds to the hundredth, unsigned: every caller here says "made" or "lost" in words. */
const BB_PLACES = 2;

function bb(value: number): string {
  return Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: BB_PLACES,
    maximumFractionDigits: BB_PLACES,
  });
}

/** `made 412.50 bb` / `lost 180.50 bb` / `finished level` — the sign said rather than printed. */
function outcome(value: number): string {
  if (value === 0) return 'finished level';
  return `${value > 0 ? 'made' : 'lost'} ${bb(value)} bb`;
}

/**
 * How far a single sitting swings against the total they add up to.
 *
 * The one thing a column of sittings will not tell a reader who scrolls it: that the biggest
 * single result is larger than the whole run's. Where that is true the total is a handful of
 * sittings rather than a trend, and the sentence says it only when the arithmetic holds.
 */
function sessionSpread(nets: readonly number[], net: number): string {
  const best = Math.max(...nets);
  const worst = Math.min(...nets);
  const widest = Math.max(Math.abs(best), Math.abs(worst));
  const swings = `The best sitting ${outcome(best)} and the worst ${outcome(worst)}`;
  if (widest <= Math.abs(net)) return `${swings}.`;
  return `${swings} — a wider swing either way than the ${bb(net)} bb they all add up to, so this total is a handful of sittings rather than a trend.`;
}

/** How many sittings are too short to carry a rate, and what is still exact about them. */
function sessionThin(thin: number, played: number): string {
  if (thin === 0) return '';
  const one = thin === 1;
  const which = thin === played ? `Every one of them is` : `${formatN(thin)} of them ${one ? 'is' : 'are'}`;
  return `${which} under ${THIN_HANDS} hands, so no per-100 rate is shown for ${one ? 'it' : 'them'}; the big blinds beside ${one ? 'it' : 'them'} are exact whatever the sample.`;
}

/**
 * The sittings table's reading. `result` is the server's own totals; the spread is read off the
 * rows, which is the only place it exists. `''` when nothing was played, which is the empty
 * state's business rather than a sentence's.
 */
export function sessionsReading(result: SessionsResult): string {
  const played = result.sessions.filter((session) => session.hands > 0);
  if (played.length === 0) return '';
  const nets = played.map((session) => session.net_bb);
  const thin = played.filter((session) => session.hands < THIN_HANDS).length;
  return [sessionSpread(nets, result.net_bb), sessionThin(thin, played.length)].filter((part) => part !== '').join(' ');
}
