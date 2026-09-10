/**
 * The grouping axes of the combo distribution (spec §7.1). Each axis maps a live combo to one
 * or more group keys; the draw axis is the one that can yield several, and a combo then
 * appears under each — explicitly, as the spec asks, rather than forced into one bucket.
 */

import type { ComboIndex } from '../cards';
import { handClassOf, isPairClass, isSuitedClass } from '../cards';
import type { DrawClass, HandClassification, MadeHandClass } from '../classify';
import { DRAW_CLASSES, MADE_HAND_CLASSES, isRealDraw } from '../classify';
import { DEFAULT_EQUITY_EDGES, bucketIndex } from '../metrics/advantage';

export type Axis = 'made' | 'draw' | 'strategic' | 'equity' | 'structure' | 'nut';

export const AXES: readonly Axis[] = ['made', 'draw', 'strategic', 'equity', 'structure', 'nut'];

export type StrategicCategory = 'value' | 'draw' | 'bluff_catcher' | 'air';

export const STRATEGIC_CATEGORIES: readonly StrategicCategory[] = ['value', 'draw', 'bluff_catcher', 'air'];

export interface Thresholds {
  /** Equity at or above which a combo is value. */
  readonly value: number;
  /** Equity at or above which a non-draw is a bluff-catcher rather than air. */
  readonly bluffCatcher: number;
  readonly equityEdges: readonly number[];
  /** Equity at or above which a combo is in the nut bucket; from `nutThreshold()` or a cutoff. */
  readonly nut?: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { value: 0.6, bluffCatcher: 0.35, equityEdges: DEFAULT_EQUITY_EDGES };

export interface AxisContext {
  readonly classes: readonly (HandClassification | undefined)[];
  readonly equities?: Float32Array;
  readonly thresholds: Thresholds;
}

const MADE_LABELS: Record<MadeHandClass, string> = {
  straight_flush: 'Straight flush',
  quads: 'Four of a kind',
  full_house: 'Full house',
  flush: 'Flush',
  straight: 'Straight',
  set: 'Set',
  trips: 'Trips',
  two_pair: 'Two pair',
  overpair: 'Overpair',
  top_pair: 'Top pair',
  under_pair: 'Underpair',
  second_pair: 'Second pair',
  third_pair: 'Third pair',
  weak_pair: 'Weak pair',
  ace_high: 'Ace high',
  king_high: 'King high',
  no_pair: 'No pair',
};

const DRAW_LABELS: Record<DrawClass, string> = {
  flush_draw: 'Flush draw',
  backdoor_flush_draw: 'Backdoor flush draw',
  open_ended_straight_draw: 'Open-ended straight draw',
  gutshot: 'Gutshot',
  backdoor_straight_draw: 'Backdoor straight draw',
  combo_draw: 'Combo draw',
  no_draw: 'No draw',
};

const STRATEGIC_LABELS: Record<StrategicCategory, string> = { value: 'Value', draw: 'Draw', bluff_catcher: 'Bluff-catcher', air: 'Air' };

const STRUCTURE_KEYS = ['pair', 'suited', 'offsuit'] as const;
const STRUCTURE_LABELS = { pair: 'Pocket pairs (6 combos per class)', suited: 'Suited (4 per class)', offsuit: 'Offsuit (12 per class)' } as const;

function strategic(combo: ComboIndex, ctx: AxisContext): StrategicCategory {
  const equity = ctx.equities![combo]!;
  if (equity >= ctx.thresholds.value) return 'value';
  const c = ctx.classes[combo];
  if (c !== undefined && c.draws.some(isRealDraw)) return 'draw';
  return equity >= ctx.thresholds.bluffCatcher ? 'bluff_catcher' : 'air';
}

function equityLabel(index: number, edges: readonly number[]): string {
  return `${Math.round(100 * edges[index]!)}–${Math.round(100 * edges[index + 1]!)}%`;
}

/** The group keys of a combo on an axis. */
export function keysFor(axis: Axis, combo: ComboIndex, ctx: AxisContext): string[] {
  switch (axis) {
    case 'made':
      return [ctx.classes[combo]!.made];
    case 'draw':
      return [...ctx.classes[combo]!.draws];
    case 'strategic':
      return [strategic(combo, ctx)];
    case 'equity':
      return [String(bucketIndex(ctx.equities![combo]!, ctx.thresholds.equityEdges))];
    case 'structure': {
      const cls = handClassOf(combo);
      return [isPairClass(cls) ? 'pair' : isSuitedClass(cls) ? 'suited' : 'offsuit'];
    }
    case 'nut':
      return [ctx.equities![combo]! >= ctx.thresholds.nut! ? 'nut' : 'rest'];
  }
}

/** The fixed display order of an axis's keys. */
export function keyOrder(axis: Axis, ctx: AxisContext): readonly string[] {
  switch (axis) {
    case 'made':
      return MADE_HAND_CLASSES;
    case 'draw':
      return DRAW_CLASSES;
    case 'strategic':
      return STRATEGIC_CATEGORIES;
    case 'equity':
      return ctx.thresholds.equityEdges.slice(0, -1).map((_, i) => String(i));
    case 'structure':
      return STRUCTURE_KEYS;
    case 'nut':
      return ['nut', 'rest'];
  }
}

export function labelFor(axis: Axis, key: string, ctx: AxisContext): string {
  switch (axis) {
    case 'made':
      return MADE_LABELS[key as MadeHandClass];
    case 'draw':
      return DRAW_LABELS[key as DrawClass];
    case 'strategic':
      return STRATEGIC_LABELS[key as StrategicCategory];
    case 'equity':
      return equityLabel(Number(key), ctx.thresholds.equityEdges);
    case 'structure':
      return STRUCTURE_LABELS[key as (typeof STRUCTURE_KEYS)[number]];
    case 'nut':
      return key === 'nut' ? `Nutted (equity ≥ ${Math.round(100 * ctx.thresholds.nut!)}%)` : 'Rest of range';
  }
}

/** Which inputs an axis needs, so a missing one fails plainly rather than as NaN groups. */
export function requirementsOf(axis: Axis): { board: boolean; equities: boolean; nut: boolean } {
  switch (axis) {
    case 'made':
    case 'draw':
      return { board: true, equities: false, nut: false };
    case 'strategic':
      return { board: true, equities: true, nut: false };
    case 'equity':
      return { board: false, equities: true, nut: false };
    case 'structure':
      return { board: false, equities: false, nut: false };
    case 'nut':
      return { board: false, equities: true, nut: true };
  }
}
