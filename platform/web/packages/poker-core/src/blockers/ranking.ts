/**
 * Bluff candidates and unblockers (spec §6.2). Given a bet size, a balanced betting range
 * carries `balancedBluffRatio(pot, bet)` bluff combos per value combo; the candidates are
 * hero's non-value combos ranked by `bluffScore`, and `selected` is the prefix of that ranking
 * whose weight covers what the size calls for.
 */

import type { ComboIndex } from '../cards';
import { balancedBluffRatio } from '../metrics/pot';
import type { BlockerRow, BlockerTable } from './scores';

export interface BluffRanking {
  readonly pot: number;
  readonly bet: number;
  /** Bluff combos per value combo the size calls for. */
  readonly bluffsPerValue: number;
  readonly valueWeight: number;
  readonly bluffsNeeded: number;
  /** Weight of hero's non-value combos. */
  readonly bluffsAvailable: number;
  /** `bluffsNeeded − bluffsAvailable` when positive: hero cannot balance this size. */
  readonly shortfall: number;
  /** Non-value combos, best bluff first. */
  readonly candidates: BlockerRow[];
  /** The best candidates up to `bluffsNeeded` weight. */
  readonly selected: BlockerRow[];
}

/** Rank hero's non-value combos as bluffs for a bet of `bet` into `pot`. */
export function rankBluffCandidates(table: BlockerTable, isValue: (combo: ComboIndex) => boolean, pot: number, bet: number): BluffRanking {
  const bluffsPerValue = balancedBluffRatio(pot, bet);
  let valueWeight = 0;
  const candidates: BlockerRow[] = [];
  for (const row of table.rows) {
    if (isValue(row.combo)) valueWeight += row.weight;
    else candidates.push(row);
  }
  candidates.sort((a, b) => b.bluffScore - a.bluffScore || a.combo - b.combo);
  const bluffsNeeded = valueWeight * bluffsPerValue;
  let bluffsAvailable = 0;
  const selected: BlockerRow[] = [];
  let covered = 0;
  for (const row of candidates) {
    bluffsAvailable += row.weight;
    if (covered < bluffsNeeded) {
      selected.push(row);
      covered += row.weight;
    }
  }
  return { pot, bet, bluffsPerValue, valueWeight, bluffsNeeded, bluffsAvailable, shortfall: Math.max(0, bluffsNeeded - bluffsAvailable), candidates, selected };
}

/** Hero's combos that least remove villain's folding range, best unblocker first. */
export function unblockers(table: BlockerTable): BlockerRow[] {
  return [...table.rows].sort((a, b) => a.removalFold - b.removalFold || b.removalCall - a.removalCall || a.combo - b.combo);
}

/** Hero's combos ranked as thin value bets: they remove folds and keep calls. */
export function valueCandidates(table: BlockerTable): BlockerRow[] {
  return [...table.rows].sort((a, b) => b.valueScore - a.valueScore || a.combo - b.combo);
}
