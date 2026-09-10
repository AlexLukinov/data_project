/**
 * Card-level and class-level removal (spec §6.2): what holding one card does to villain's
 * range, which of villain's classes a hero combo makes impossible, and what the board itself
 * took away from a range as it was dealt.
 */

import type { Card, ComboIndex } from '../cards';
import { CARD_COUNT, COMBOS_WITH_CARD, COMBO_COUNT, comboCards } from '../cards';
import type { DrawClass, MadeHandClass } from '../classify';
import { DRAW_CLASSES, MADE_HAND_CLASSES, classifyCombos } from '../classify';
import type { WeightedRange } from '../range';
import { removeCards, totalCombos, weightedCombos } from '../range';

const FLOP = 3;

export interface ClassRemoval {
  readonly removedWeight: number;
  readonly totalWeight: number;
  /** `removedWeight / totalWeight`, 0 when the class is empty. */
  readonly fraction: number;
}

export interface CardRemoval {
  readonly card: Card;
  readonly onBoard: boolean;
  readonly removedWeight: number;
  /** Share of villain's live range the card removes. */
  readonly fraction: number;
  /** Per made-hand class present in villain's range; empty before the flop. */
  readonly byClass: Partial<Record<MadeHandClass, ClassRemoval>>;
}

/** For each of the 52 cards, how much of `villain` (already reduced by the board) it removes. */
export function cardRemovalHeatmap(villain: WeightedRange, board: readonly Card[]): CardRemoval[] {
  const live = removeCards(villain, board);
  const total = weightedCombos(live);
  const classes = board.length >= FLOP ? classifyCombos(live, board) : undefined;
  const classTotals: Partial<Record<MadeHandClass, number>> = {};
  if (classes !== undefined) {
    for (let combo = 0; combo < COMBO_COUNT; combo++) {
      const c = classes[combo];
      if (c !== undefined) classTotals[c.made] = (classTotals[c.made] ?? 0) + live.weights[combo]!;
    }
  }
  const onBoard = new Set(board);
  const out: CardRemoval[] = [];
  for (let card = 0; card < CARD_COUNT; card++) {
    let removed = 0;
    const byClassWeight: Partial<Record<MadeHandClass, number>> = {};
    for (const combo of COMBOS_WITH_CARD[card]!) {
      const w = live.weights[combo]!;
      if (w <= 0) continue;
      removed += w;
      const c = classes?.[combo];
      if (c !== undefined) byClassWeight[c.made] = (byClassWeight[c.made] ?? 0) + w;
    }
    const byClass: Partial<Record<MadeHandClass, ClassRemoval>> = {};
    for (const cls of MADE_HAND_CLASSES) {
      const classTotal = classTotals[cls];
      if (classTotal === undefined) continue;
      const removedWeight = byClassWeight[cls] ?? 0;
      byClass[cls] = { removedWeight, totalWeight: classTotal, fraction: removedWeight / classTotal };
    }
    out.push({ card, onBoard: onBoard.has(card), removedWeight: removed, fraction: total === 0 ? 0 : removed / total, byClass });
  }
  return out;
}

export interface Count {
  readonly combos: number;
  readonly weight: number;
}

export interface ClassBreakdownRow {
  readonly kind: 'made' | 'draw';
  readonly cls: MadeHandClass | DrawClass;
  readonly before: Count;
  readonly after: Count;
}

function countClasses(range: WeightedRange, board: readonly Card[]): { made: Map<string, Count>; draw: Map<string, Count> } {
  const classes = classifyCombos(range, board);
  const made = new Map<string, Count>();
  const draw = new Map<string, Count>();
  const add = (map: Map<string, Count>, key: string, w: number): void => {
    const cur = map.get(key) ?? { combos: 0, weight: 0 };
    map.set(key, { combos: cur.combos + 1, weight: cur.weight + w });
  };
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    const c = classes[combo];
    if (c === undefined) continue;
    const w = range.weights[combo]!;
    add(made, c.made, w);
    for (const d of c.draws) add(draw, d, w);
  }
  return { made, draw };
}

/**
 * Which of villain's made-hand and draw classes lost combos to hero's two cards, and how many:
 * "flush draws 5 → 2". Only classes villain had before the removal are listed.
 */
export function classRemovalBreakdown(villain: WeightedRange, board: readonly Card[], heroCombo: ComboIndex): ClassBreakdownRow[] {
  if (board.length < FLOP) throw new RangeError('class removal needs a board of at least three cards');
  const before = countClasses(removeCards(villain, board), board);
  const after = countClasses(removeCards(villain, [...board, ...comboCards(heroCombo)]), board);
  const none: Count = { combos: 0, weight: 0 };
  const rows: ClassBreakdownRow[] = [];
  for (const cls of MADE_HAND_CLASSES) {
    const b = before.made.get(cls);
    if (b !== undefined) rows.push({ kind: 'made', cls, before: b, after: after.made.get(cls) ?? none });
  }
  for (const cls of DRAW_CLASSES) {
    const b = before.draw.get(cls);
    if (b !== undefined) rows.push({ kind: 'draw', cls, before: b, after: after.draw.get(cls) ?? none });
  }
  return rows;
}

export interface BoardCardEffect {
  readonly card: Card;
  readonly before: Count;
  readonly after: Count;
}

export interface BoardRemovalEffects {
  readonly before: Count;
  readonly after: Count;
  /** One step per board card in the order dealt; each `after` is the next step's `before`. */
  readonly steps: BoardCardEffect[];
}

/** How the board, card by card, removed combos from a range. */
export function boardRemovalEffects(range: WeightedRange, board: readonly Card[]): BoardRemovalEffects {
  const count = (r: WeightedRange): Count => ({ combos: totalCombos(r), weight: weightedCombos(r) });
  let current = range;
  const before = count(current);
  const steps: BoardCardEffect[] = [];
  for (const card of board) {
    const next = removeCards(current, [card]);
    steps.push({ card, before: count(current), after: count(next) });
    current = next;
  }
  return { before, after: count(current), steps };
}
