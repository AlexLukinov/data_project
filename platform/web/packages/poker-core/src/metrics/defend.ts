/**
 * The defending set (spec §8, MDF): the strongest part of a range whose weight reaches a given
 * share — the combos that continue when a range defends exactly its MDF by equity. Combos are
 * taken from the top of the equity distribution until the share is met; the last one taken sets
 * the cutoff equity. An approximation the way every MDF chart is one: it assumes the range
 * defends its best equity first and ignores blockers and playability.
 */

import type { ComboIndex } from '../cards';
import type { WeightedEquities } from './advantage';
import { equityPoints, totalWeight } from './advantage';

export interface DefendingSet {
  /** The combos that continue, strongest first. */
  readonly combos: ComboIndex[];
  /** Their weight. */
  readonly weight: number;
  /** The whole range's weight. */
  readonly totalWeight: number;
  /** The equity of the weakest continuing combo; NaN when nothing continues. */
  readonly cutoffEquity: number;
}

/** The top `share` (0..1) of the range by equity. */
export function defendingSet(side: WeightedEquities, share: number): DefendingSet {
  if (!(share >= 0 && share <= 1)) throw new RangeError(`share must be in [0, 1], got ${share}`);
  const points = equityPoints(side).reverse();
  const total = totalWeight(points);
  const target = share * total;
  const combos: ComboIndex[] = [];
  let weight = 0;
  let cutoffEquity = Number.NaN;
  for (const p of points) {
    if (weight >= target) break;
    combos.push(p.combo);
    weight += p.weight;
    cutoffEquity = p.equity;
  }
  return { combos, weight, totalWeight: total, cutoffEquity };
}
