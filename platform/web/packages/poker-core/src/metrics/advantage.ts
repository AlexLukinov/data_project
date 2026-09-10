/**
 * Range advantage and nut advantage (spec §8), from the per-combo equities the engine returns.
 *
 * Range advantage compares the weight-weighted mean (and median) equity of the two ranges.
 * Nut advantage asks who holds the strongest part of the combined distribution: either every
 * combo at or above an equity cutoff (default 80%), or the top N% by weight of both ranges
 * put together (default 5%). The "nut share split" is each side's nut weight over the total.
 */

import { COMBO_COUNT } from '../cards';

/** A range's per-combo equities (NaN where absent) and weights, both indexed by combo. */
export interface WeightedEquities {
  readonly equities: Float32Array;
  readonly weights: ArrayLike<number>;
}

interface Point {
  readonly equity: number;
  readonly weight: number;
}

/** Live (weight > 0, finite equity) points, sorted by equity ascending. */
export function equityPoints(side: WeightedEquities): Point[] {
  const points: Point[] = [];
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    const w = side.weights[combo]!;
    const e = side.equities[combo]!;
    if (w > 0 && Number.isFinite(e)) points.push({ equity: e, weight: w });
  }
  return points.sort((a, b) => a.equity - b.equity);
}

function totalWeight(points: readonly Point[]): number {
  let sum = 0;
  for (const p of points) sum += p.weight;
  return sum;
}

export function weightedMeanEquity(side: WeightedEquities): number {
  const points = equityPoints(side);
  const total = totalWeight(points);
  if (total === 0) return Number.NaN;
  let sum = 0;
  for (const p of points) sum += p.equity * p.weight;
  return sum / total;
}

/** The equity at which half the weight lies below. */
export function weightedMedianEquity(side: WeightedEquities): number {
  const points = equityPoints(side);
  const total = totalWeight(points);
  if (total === 0) return Number.NaN;
  let running = 0;
  for (const p of points) {
    running += p.weight;
    if (running >= total / 2) return p.equity;
  }
  return points[points.length - 1]!.equity;
}

export const DEFAULT_EQUITY_EDGES: readonly number[] = [0, 0.2, 0.4, 0.6, 0.8, 1];

export interface EquityBuckets {
  readonly edges: readonly number[];
  /** Weight in each bucket [edge_i, edge_{i+1}); the last bucket includes 1. */
  readonly weights: number[];
  /** Weight share of the range in each bucket. */
  readonly shares: number[];
}

/** Index of the bucket holding `equity`. */
export function bucketIndex(equity: number, edges: readonly number[] = DEFAULT_EQUITY_EDGES): number {
  for (let i = edges.length - 2; i >= 1; i--) if (equity >= edges[i]!) return i;
  return 0;
}

export function equityBuckets(side: WeightedEquities, edges: readonly number[] = DEFAULT_EQUITY_EDGES): EquityBuckets {
  const weights = new Array<number>(edges.length - 1).fill(0);
  const points = equityPoints(side);
  for (const p of points) weights[bucketIndex(p.equity, edges)]! += p.weight;
  const total = totalWeight(points);
  return { edges, weights, shares: weights.map((w) => (total === 0 ? 0 : w / total)) };
}

export interface RangeAdvantage {
  readonly heroMean: number;
  readonly villainMean: number;
  /** `heroMean − villainMean`, in equity (0.05 = five points). */
  readonly difference: number;
  readonly heroMedian: number;
  readonly villainMedian: number;
  readonly buckets: { readonly edges: readonly number[]; readonly hero: number[]; readonly villain: number[] };
}

export function rangeAdvantage(hero: WeightedEquities, villain: WeightedEquities, edges: readonly number[] = DEFAULT_EQUITY_EDGES): RangeAdvantage {
  const heroMean = weightedMeanEquity(hero);
  const villainMean = weightedMeanEquity(villain);
  return {
    heroMean,
    villainMean,
    difference: heroMean - villainMean,
    heroMedian: weightedMedianEquity(hero),
    villainMedian: weightedMedianEquity(villain),
    buckets: { edges, hero: equityBuckets(hero, edges).shares, villain: equityBuckets(villain, edges).shares },
  };
}

export type NutMode = 'cutoff' | 'topPercent';

export interface NutOptions {
  readonly mode?: NutMode;
  /** For `cutoff`: a combo is "nutted" at or above this equity. Default 0.8. */
  readonly cutoff?: number;
  /** For `topPercent`: the share of the combined weight that counts as nutted. Default 5. */
  readonly topPercent?: number;
}

export const DEFAULT_NUT_CUTOFF = 0.8;
export const DEFAULT_NUT_TOP_PERCENT = 5;

/** The equity at which the top `topPercent` of the combined weight of both ranges begins. */
export function nutThreshold(hero: WeightedEquities, villain: WeightedEquities, topPercent: number = DEFAULT_NUT_TOP_PERCENT): number {
  if (!(topPercent > 0 && topPercent <= 100)) throw new RangeError(`topPercent must be in (0, 100], got ${topPercent}`);
  const combined = [...equityPoints(hero), ...equityPoints(villain)].sort((a, b) => b.equity - a.equity);
  const target = (totalWeight(combined) * topPercent) / 100;
  let running = 0;
  for (const p of combined) {
    running += p.weight;
    if (running >= target) return p.equity;
  }
  return combined.length === 0 ? Number.NaN : combined[combined.length - 1]!.equity;
}

export interface NutSide {
  /** Weight of this range's combos at or above the threshold. */
  readonly nutWeight: number;
  /** That weight as a share of this range. */
  readonly share: number;
}

export interface NutAdvantage {
  readonly mode: NutMode;
  readonly threshold: number;
  readonly hero: NutSide;
  readonly villain: NutSide;
  /** Each side's nut weight over both sides' nut weight: the "hero 78% / villain 22%" split. */
  readonly split: { readonly hero: number; readonly villain: number };
}

function nutSide(side: WeightedEquities, threshold: number): NutSide {
  const points = equityPoints(side);
  const total = totalWeight(points);
  let nutWeight = 0;
  for (const p of points) if (p.equity >= threshold) nutWeight += p.weight;
  return { nutWeight, share: total === 0 ? 0 : nutWeight / total };
}

export function nutAdvantage(hero: WeightedEquities, villain: WeightedEquities, options: NutOptions = {}): NutAdvantage {
  const mode = options.mode ?? 'cutoff';
  const threshold = mode === 'cutoff' ? (options.cutoff ?? DEFAULT_NUT_CUTOFF) : nutThreshold(hero, villain, options.topPercent);
  const h = nutSide(hero, threshold);
  const v = nutSide(villain, threshold);
  const both = h.nutWeight + v.nutWeight;
  return { mode, threshold, hero: h, villain: v, split: both === 0 ? { hero: 0, villain: 0 } : { hero: h.nutWeight / both, villain: v.nutWeight / both } };
}
