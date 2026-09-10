/**
 * The pool's showdown counts as a range (spec §10.3, plan F.8).
 *
 * The server answers with how many times each 169-combo class was **shown** at a node. Turning
 * that into a range needs one correction: a class with twelve combos will be shown more often
 * than one with six even if a player is no likelier to hold any particular one of them. So the
 * weight of a class is its count *per combo*, and the whole thing is scaled so the most
 * frequent class sits at 1 — a relative range, which is what a matrix reads.
 *
 * It is built through `parseRange` in class notation rather than by writing weights into a
 * range object directly, so the notation stays the one tested path into a `WeightedRange`.
 */

import type { WeightedRange } from '@poker/core';
import { HAND_CLASS_COMBOS, handClassOfName, parseRange } from '@poker/core';

/** Below this share of the top class a hand is noise, not range. */
export const FLOOR = 0.02;
const PLACES = 3;

function combosIn(name: string): number {
  try {
    return HAND_CLASS_COMBOS[handClassOfName(name)]?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * `{ AA: 60, AKs: 40, … }` (counts or shares, either works) -> a weighted range, or null when
 * there is nothing to draw.
 */
export function poolRange(counts: Record<string, number>, label = 'Pool'): WeightedRange | null {
  const perCombo = new Map<string, number>();
  for (const [name, count] of Object.entries(counts)) {
    const combos = combosIn(name);
    if (combos > 0 && count > 0) perCombo.set(name, count / combos);
  }
  const top = Math.max(...perCombo.values(), 0);
  if (top <= 0) return null;

  const parts: string[] = [];
  for (const [name, value] of perCombo) {
    const weight = value / top;
    if (weight >= FLOOR) parts.push(`${name}:${weight.toFixed(PLACES)}`);
  }
  if (parts.length === 0) return null;
  return { ...parseRange(parts.join(',')).range, label };
}
