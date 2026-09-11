/**
 * Turning a spot's stored text back into the things a component draws.
 *
 * A spot travels as text so it is plain JSON (see `types.ts`); every trainer needs it back as a
 * `WeightedRange` and a `Card[]`. These never throw: a component recomputes them on every render,
 * and a half-typed board must not take the page down — the same rule `analyze/spot.ts` follows.
 */
import type { Card, WeightedRange } from '@poker/core';
import { createRange, parseCards, parseRange } from '@poker/core';

/** The range a spot's text names, or an empty one if it cannot be read. */
export function rangeOf(text: string, label?: string): WeightedRange {
  try {
    const parsed = parseRange(text).range;
    return label === undefined ? parsed : createRange(parsed.weights, label);
  } catch {
    return createRange(undefined, label);
  }
}

/** The cards a spot's board text names, or none if it cannot be read. */
export function boardOf(text: string): Card[] {
  try {
    return text === '' ? [] : parseCards(text);
  } catch {
    return [];
  }
}
