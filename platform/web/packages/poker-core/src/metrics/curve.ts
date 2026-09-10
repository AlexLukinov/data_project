/**
 * The equity distribution curve (spec §8, acceptance 3): every live combo of a range from the
 * strongest to the weakest, plotted against the share of the range's weight that is at least
 * that strong. Each combo occupies a horizontal step as wide as its weight, so the curve is the
 * weighted survival function of equity: `equityAtShare(curve, 0.3)` is the equity of the combo
 * sitting at the 30th percentile from the top — the strongest 30% of the range has at least
 * that much.
 */

import type { WeightedEquities } from './advantage';
import { equityPoints, totalWeight } from './advantage';

export interface CurvePoint {
  /** Cumulative weight share from the top, 0..1: the right edge of this combo's step. */
  readonly share: number;
  readonly equity: number;
}

/** Points from (0, best equity) to (1, worst equity); empty for an empty range. */
export function equityCurve(side: WeightedEquities): CurvePoint[] {
  const points = equityPoints(side).reverse();
  const total = totalWeight(points);
  if (total === 0) return [];
  const curve: CurvePoint[] = [{ share: 0, equity: points[0]!.equity }];
  let running = 0;
  for (const p of points) {
    running += p.weight;
    curve.push({ share: running / total, equity: p.equity });
  }
  return curve;
}

/** The equity of the combo at cumulative share `share` from the top; NaN on an empty curve. */
export function equityAtShare(curve: readonly CurvePoint[], share: number): number {
  if (curve.length === 0) return Number.NaN;
  for (let i = 1; i < curve.length; i++) if (curve[i]!.share >= share) return curve[i]!.equity;
  return curve[curve.length - 1]!.equity;
}
