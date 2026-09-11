/**
 * Tier 3 in both directions (spec §10.3, plan F.10): a prior range into the shape the server
 * estimates over, and the estimate back into a range a matrix can draw.
 *
 * The server works per 169-combo class because that is the only grain showdown data can
 * support, while a range is per combo. The two meet cleanly: every combo of a class is moved by
 * the same factor, so the shape *inside* a class — a chart that plays A5s but not A4s — survives
 * the reconstruction untouched, and only the weight *between* classes changes.
 *
 * `likelihood` is the factor, not `action_rate`: it is exactly 1 for a class the pool could not
 * measure, so a fallback class keeps the prior's own weight and the range only moves where
 * there was data to move it.
 */

import type { NodeKey, WeightedRange } from '@poker/core';
import { COMBO_COUNT, createRange, handClassName, handClassOf } from '@poker/core';

import type { ClassEstimate, NodeEstimatedRange, PoolApi } from './api';

/** Weights below this fraction of the top combo are noise, not range (matches `poolRange`). */
export const FLOOR = 0.02;

/**
 * A range as the per-class weights the estimator takes: each class's total weight. Classes with
 * no weight are left out, so a prior of 36 classes is 36 numbers rather than 169 zeroes.
 */
export function classWeights(range: WeightedRange): Record<string, number> {
  const totals: Record<string, number> = {};
  for (let combo = 0; combo < COMBO_COUNT; combo += 1) {
    const weight = range.weights[combo] ?? 0;
    if (weight <= 0) continue;
    const name = handClassName(handClassOf(combo));
    totals[name] = (totals[name] ?? 0) + weight;
  }
  return totals;
}

/**
 * The prior after the reconstruction: every combo scaled by its class's likelihood, rescaled so
 * the heaviest combo sits at 1. `null` when nothing survives — an empty matrix is not a range.
 */
export function reweight(prior: WeightedRange, classes: readonly ClassEstimate[], label = 'Pool estimate'): WeightedRange | null {
  const factor = new Map(classes.map((row) => [row.hand_class, row.likelihood]));
  const scaled = new Float32Array(COMBO_COUNT);
  for (let combo = 0; combo < COMBO_COUNT; combo += 1) {
    const weight = prior.weights[combo] ?? 0;
    if (weight <= 0) continue;
    scaled[combo] = weight * (factor.get(handClassName(handClassOf(combo))) ?? 1);
  }
  const top = Math.max(...scaled);
  if (!(top > 0)) return null;
  for (let combo = 0; combo < COMBO_COUNT; combo += 1) {
    const share = (scaled[combo] ?? 0) / top;
    scaled[combo] = share >= FLOOR ? share : 0;
  }
  return createRange(scaled, label);
}

/**
 * Per-169-class equity from an equity run's per-combo answer, for the EQR table.
 *
 * The engine reports a combo's equity against the range it was run against, and `NaN` for a
 * combo outside the range or blocked by the board. A class's equity is the mean of the combos
 * that do have one; a class with none is simply absent, and its EQR stays blank rather than
 * being filled in from a neighbour.
 */
export function classEquity(perCombo: Float32Array): Record<string, number> {
  const sums = new Map<string, { total: number; seen: number }>();
  for (let combo = 0; combo < COMBO_COUNT; combo += 1) {
    const equity = perCombo[combo] ?? Number.NaN;
    if (!Number.isFinite(equity)) continue;
    const name = handClassName(handClassOf(combo));
    const cell = sums.get(name) ?? { total: 0, seen: 0 };
    sums.set(name, { total: cell.total + equity, seen: cell.seen + 1 });
  }
  const means: Record<string, number> = {};
  for (const [name, { total, seen }] of sums) means[name] = total / seen;
  return means;
}

/** The classes whose weight the field moved most, biggest mover first. Fallbacks are not movers. */
export function movers(answer: NodeEstimatedRange, limit: number): ClassEstimate[] {
  return answer.classes
    .filter((row) => !row.fallback)
    .sort((a, b) => Math.abs(b.posterior - b.prior) - Math.abs(a.posterior - a.prior))
    .slice(0, limit);
}

/** Ask for the reconstruction of `prior` at `key`, or `null` if the pool cannot answer at all. */
export async function estimateAt(api: PoolApi, key: NodeKey, prior: WeightedRange): Promise<NodeEstimatedRange | null> {
  const weights = classWeights(prior);
  if (Object.keys(weights).length === 0) return null;
  return api.estimatedRange(key, weights).catch(() => null);
}
