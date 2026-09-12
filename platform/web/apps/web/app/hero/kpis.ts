/**
 * The headline numbers of My game (plan D.4): which stats a dashboard leads with, how each one
 * reads, and the single request that answers them all.
 *
 * **Why this is a module and not markup.** The rules that make a KPI tile honest are the same
 * rules the grid obeys — a number carries its `n`, a thin sample is not compared, a count is
 * never compared at all — and they already live in `reports/cell.ts`. This file adds the one
 * thing a tile needs beyond a grid cell: the *unit and precision* a headline figure is read in,
 * which is a property of the stat's format and belongs next to the stat list rather than inside
 * a component. `cellView` still decides everything it already decided.
 *
 * **Why these eight.** The first three are the result — how much was played and what it made,
 * actual against all-in adjusted. The last five are the style that produced it, and they are the
 * five a player recognises without a glossary. `af_total` is deliberately absent despite being
 * the obvious ninth: it is the registry's only `ratio`, so E.2 gives it no interval by name, and
 * it is one of the few stats with `cached: false`, so asking for it would take the whole request
 * off the daily rollup for a tile that could not show a band anyway.
 */

import { cellView } from '../reports/cell';
import type { CellView } from '../reports/cell';
import type { ConfidenceLevel, ReportRequest, ReportResult, Stat } from '../stats/api';

/** The level every tile asks for. One number, so a screenful of tiles cannot disagree. */
export const KPI_CONFIDENCE: ConfidenceLevel = 95;

/** The stat codes of the KPI row, in the order they are read. */
export const KPI_CODES: readonly string[] = [
  'hands',
  'bb_per_100',
  'ev_bb_per_100',
  'vpip',
  'pfr',
  'threebet',
  'wtsd',
  'wsd',
];

/**
 * Where the row breaks: the first three are the result, the rest are the play behind it. An
 * index rather than two lists, so `KPI_CODES` stays the one statement of what is asked for.
 */
export const KPI_RESULT_COUNT = 3;

export interface KpiDates {
  from?: string;
  to?: string;
}

/**
 * The one request behind every tile.
 *
 * `group_by: []` — a KPI is the ungrouped answer. `compare_to: 'population'` puts the field in
 * every cell's `baseline`, which is what makes a tile a judgement rather than a number.
 * `confidence` is what E.2 built and what this step consumes; it costs the rollup on the two
 * per-100 stats (`stats/router.py` needs the per-hand spread, which the daily rollup does not
 * store) and nothing on the percentages, which is the trade the E.2 docstring describes as
 * worth making for exactly this screen.
 */
export function kpiRequest(dates: KpiDates = {}): ReportRequest {
  return {
    dataset: 'hero',
    hero_only: true,
    group_by: [],
    stats: [...KPI_CODES],
    compare_to: 'population',
    confidence: KPI_CONFIDENCE,
    ...(dates.from ? { date_from: dates.from } : {}),
    ...(dates.to ? { date_to: dates.to } : {}),
  };
}

/** How a headline figure is read: its unit, its precision, and whether a `+` is worth printing. */
export interface KpiFormat {
  unit: string;
  digits: number;
  signed: boolean;
}

/**
 * Units and precision by format.
 *
 * A percentage reads to a tenth and money to a hundredth — the same precisions `reports/cell.ts`
 * prints — and a count has no unit and no decimals. `signed` is on for `per100` alone: a winrate
 * that reads `+0.28` says something a bare `0.28` does not, while `+22.96%` on a VPIP is noise.
 */
const FORMATS: Record<string, KpiFormat> = {
  percent: { unit: '%', digits: 1, signed: false },
  per100: { unit: 'bb/100', digits: 2, signed: true },
  ratio: { unit: '', digits: 2, signed: false },
  count: { unit: '', digits: 0, signed: false },
};

export function kpiFormat(stat: Stat): KpiFormat {
  return FORMATS[stat.format] ?? FORMATS.count!;
}

/**
 * One tile, ready to render.
 *
 * `view` is `cellView`'s verdict unchanged — the same object the grid renders — so a cell the
 * workbench dims is a tile this screen dims, with the same threshold and the same wording.
 * Everything beside it is presentation the tile needs and a grid cell does not.
 */
export interface KpiTileView {
  code: string;
  label: string;
  /** The registry's own sentence, shown on hover. Never a phrase invented by the client. */
  description: string;
  /** The registry's caveats on the definition, where it records any. */
  notes: string;
  /** The band this stat usually falls in, for reading the value. Never for gating it. */
  typical: readonly [number, number] | null;
  /** The raw value, handed to `MetricValue`; `null` when there is nothing to show. */
  value: number | null;
  low: number | null;
  high: number | null;
  level: number;
  /** `null` rather than `0` when there is no sample: `MetricValue` prints a literal `n = 0`. */
  n: number | null;
  format: KpiFormat;
  view: CellView;
}

/**
 * The tiles for a result, in `KPI_CODES` order, skipping any code the registry does not know.
 *
 * Skipping rather than throwing is the deliberate choice: a stat renamed in the registry should
 * cost the dashboard one tile, not the whole page — and it cannot pass silently either, because
 * the request named it and the caller can compare lengths.
 */
export function kpiTiles(
  result: ReportResult | null,
  stats: readonly Stat[],
  codes: readonly string[] = KPI_CODES,
): KpiTileView[] {
  const byCode = new Map(stats.map((stat) => [stat.code, stat]));
  const row = result?.rows[0];
  return codes.flatMap((code) => {
    const stat = byCode.get(code);
    if (stat === undefined) return [];
    const view = cellView(row?.cells[code], stat);
    return [
      {
        code,
        label: stat.label,
        description: stat.description ?? '',
        notes: stat.notes ?? '',
        typical: stat.typical ?? null,
        value: view.empty ? null : (row?.cells[code]?.value ?? null),
        low: view.low,
        high: view.high,
        level: view.level ?? KPI_CONFIDENCE,
        // A count carries no `n`: the value *is* the sample, and `19,802` with `n = 19,802`
        // under it is the same number printed twice.
        n: view.n === 0 || stat.format === 'count' ? null : view.n,
        format: kpiFormat(stat),
        view,
      },
    ];
  });
}

/**
 * How far the actual winrate sits from the all-in adjusted one, in bb/100, or `null` when there
 * is no honest answer.
 *
 * Worth its own function because it is the one number on this page the API does not send and the
 * founder most wants: the gap between what the cards were worth and what the pots paid. It is a
 * subtraction of two values the server already rounded, so it is reported to that precision and
 * never to more.
 *
 * **It is withheld on a thin sample, and that is the whole point.** Narrowed to a single day of
 * eleven hands, the two winrates are both −131.82 and the gap is exactly 0.00 — from which the
 * page would announce that the cards have paid about what they were worth, in a confident
 * sentence, about eleven hands, while every tile above it is dimmed as too thin to read. A
 * sentence is harder to discount than a number, so the threshold has to be applied before the
 * words are built, not left to whoever writes them.
 */
export function evGap(tiles: readonly KpiTileView[]): number | null {
  const actual = tiles.find((tile) => tile.code === 'bb_per_100');
  const ev = tiles.find((tile) => tile.code === 'ev_bb_per_100');
  if (actual === undefined || ev === undefined) return null;
  if (actual.value === null || ev.value === null) return null;
  if (actual.view.thin || ev.view.thin) return null;
  return actual.value - ev.value;
}
