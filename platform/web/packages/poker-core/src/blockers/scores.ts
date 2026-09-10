/**
 * Blocker scores (spec §6.1). With villain's range split into the part that continues
 * (`call`) and the part that folds (`fold`), for a hero combo h:
 *
 *   blockedCall(h) = weight of `call` combos sharing a card with h
 *   blockedFold(h) = weight of `fold` combos sharing a card with h
 *   removalCall(h) = blockedCall / total(call)      removalFold(h) = blockedFold / total(fold)
 *   bluffScore(h)  = removalCall − removalFold        valueScore(h) = removalFold − removalCall
 *
 * A good bluff blocks calls and unblocks folds; a good thin value bet does the opposite.
 * The weight sharing a card with (a, b) is weight(a) + weight(b) − weight(ab): the combo with
 * both cards is in both per-card sums.
 */

import type { Card, ComboIndex } from '../cards';
import { CARD_COUNT, COMBOS_WITH_CARD, COMBO_COUNT, comboCards } from '../cards';
import type { WeightedRange } from '../range';
import { removeCards } from '../range';

export interface BlockerRow {
  readonly combo: ComboIndex;
  readonly weight: number;
  readonly blockedCall: number;
  readonly blockedFold: number;
  readonly removalCall: number;
  readonly removalFold: number;
  readonly bluffScore: number;
  readonly valueScore: number;
}

export interface BlockerTable {
  /** One row per live hero combo, in combo order; sort as the view needs. */
  readonly rows: BlockerRow[];
  readonly callTotal: number;
  readonly foldTotal: number;
  readonly byCombo: Map<ComboIndex, BlockerRow>;
}

/** Weight of the range's combos holding each card. */
export function weightByCard(range: WeightedRange): Float64Array {
  const out = new Float64Array(CARD_COUNT);
  for (let card = 0; card < CARD_COUNT; card++) {
    let sum = 0;
    for (const combo of COMBOS_WITH_CARD[card]!) sum += range.weights[combo]!;
    out[card] = sum;
  }
  return out;
}

function total(range: WeightedRange): number {
  let sum = 0;
  for (let i = 0; i < COMBO_COUNT; i++) sum += range.weights[i]!;
  return sum;
}

/** Weight of `range` sharing at least one card with the combo (a, b). */
export function blockedWeight(range: WeightedRange, byCard: Float64Array, combo: ComboIndex): number {
  const [a, b] = comboCards(combo);
  return byCard[a]! + byCard[b]! - range.weights[combo]!;
}

/**
 * The per-combo blocker table. `dead` (the board, exposed cards) is removed from all three
 * ranges first, so a combo the board makes impossible never counts as blocked or blocking.
 */
export function blockerTable(hero: WeightedRange, villainCall: WeightedRange, villainFold: WeightedRange, dead: readonly Card[] = []): BlockerTable {
  const h = removeCards(hero, dead);
  const call = removeCards(villainCall, dead);
  const fold = removeCards(villainFold, dead);
  const callByCard = weightByCard(call);
  const foldByCard = weightByCard(fold);
  const callTotal = total(call);
  const foldTotal = total(fold);
  const rows: BlockerRow[] = [];
  const byCombo = new Map<ComboIndex, BlockerRow>();
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    const weight = h.weights[combo]!;
    if (weight <= 0) continue;
    const blockedCall = blockedWeight(call, callByCard, combo);
    const blockedFold = blockedWeight(fold, foldByCard, combo);
    const removalCall = callTotal === 0 ? 0 : blockedCall / callTotal;
    const removalFold = foldTotal === 0 ? 0 : blockedFold / foldTotal;
    const row: BlockerRow = { combo, weight, blockedCall, blockedFold, removalCall, removalFold, bluffScore: removalCall - removalFold, valueScore: removalFold - removalCall };
    rows.push(row);
    byCombo.set(combo, row);
  }
  return { rows, callTotal, foldTotal, byCombo };
}
