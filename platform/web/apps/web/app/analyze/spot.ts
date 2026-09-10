/**
 * What the nine steps have built so far, read back as one spot (spec §15).
 *
 * The steps are cumulative: step 1 gives every seat a range, step 2 narrows the seat that faced
 * an action to what it continues with, step 3 puts a board out and step 5 names hero's own two
 * cards. Every later step reads the result rather than asking for it again, which is what makes
 * the analyzer feel like one hand and not nine forms.
 */
import type { Card, NodeKey, WeightedRange } from '@poker/core';
import { parseCards, parseRange, union } from '@poker/core';

import type { AnalysisStep, StepWork } from './api';

export interface Spot {
  /** Hero's range as it stands after the subtraction, or `null` while none is assigned. */
  readonly hero: WeightedRange | null;
  readonly villain: WeightedRange | null;
  readonly board: Card[];
  readonly heroCards: Card[];
}

export const EMPTY_SPOT: Spot = { hero: null, villain: null, board: [], heroCards: [] };

/** The continuing actions of step 2: what is left of a range once the folds are gone. */
const CONTINUES: ReadonlySet<string> = new Set(['call', 'raise', 'bet', 'allin', 'limp']);

function work(steps: readonly AnalysisStep[], step: number): StepWork | null {
  return steps.find((s) => s.step === step)?.work ?? null;
}

/**
 * A stored body as a range. Unreadable text yields `null` rather than throwing: the spot is
 * derived on every render, and a half-typed board must not take the page down with it.
 */
function parse(weights: string, label: string): WeightedRange | null {
  if (weights === '') return null;
  try {
    return { ...parseRange(weights).range, label };
  } catch {
    return null;
  }
}

/** The range a seat was given at step 1. */
function assigned(steps: readonly AnalysisStep[], position: string): WeightedRange | null {
  const found = work(steps, 1)?.ranges.find((r) => r.position === position);
  return found === undefined ? null : parse(found.weights, found.label === '' ? position : found.label);
}

/**
 * The part of a seat's range that is still in the hand after step 2 — every branch that is not a
 * fold, added together. A seat that was never split keeps the whole range it was assigned.
 */
function continuing(steps: readonly AnalysisStep[], position: string): WeightedRange | null {
  const splits = (work(steps, 2)?.splits ?? []).filter((s) => s.position === position && CONTINUES.has(s.action));
  const parts = splits.map((s) => parse(s.weights, position)).filter((r): r is WeightedRange => r !== null);
  if (parts.length === 0) return assigned(steps, position);
  return parts.reduce((all, part) => ({ ...union(all, part), label: position }));
}

function cards(text: string): Card[] {
  try {
    return parseCards(text);
  } catch {
    return [];
  }
}

/** Everything the steps so far have established about this spot. */
export function spotFrom(steps: readonly AnalysisStep[], node: NodeKey | null): Spot {
  if (node === null) return EMPTY_SPOT;
  return {
    hero: continuing(steps, node.hero_position),
    villain: node.villain_position === null ? null : continuing(steps, node.villain_position),
    board: cards(work(steps, 3)?.board ?? ''),
    heroCards: cards(work(steps, 5)?.hero_cards ?? ''),
  };
}
