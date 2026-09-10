/**
 * Exact heads-up equity by enumerating every runout (spec §5.2).
 *
 * Per runout, each side ranks its surviving combos once (≈ 2 × 1,081 evaluations, never the
 * 1,081² matchups), indexes them by rank and by card, and then every combo of one side reads
 * off — in O(1) plus two small binary searches — how much of the other side it beats, ties and
 * loses to, with the combos it collides with removed exactly (see `side.ts`).
 *
 * Definitions. For hero combo i with weight wᵢ and villain combo j with weight wⱼ, over the
 * runouts neither combo blocks: hero's per-combo equity is Σⱼ wⱼ·result / Σⱼ wⱼ, and hero's
 * range equity is Σᵢ wᵢ Σⱼ wⱼ·result / Σᵢ wᵢ Σⱼ wⱼ — every matchup weighted by wᵢ·wⱼ, as the
 * spec's step 5 says. A tie counts one half.
 */

import type { Card } from '../cards';
import { CARD_COUNT, COMBO_COUNT } from '../cards';
import type { HandEvaluator } from '../evaluator/types';
import type { WeightedRange } from '../range';
import { checkpoint } from './control';
import { cardFlags } from './live';
import { Side } from './side';
import type { EquityOptions, EquityResult } from './types';

const BOARD_SIZE = 5;
const DEFAULT_CHUNK = 32;

/** Every way to complete the board from the unseen cards: pairs on the flop, singles on the turn, one empty runout on the river. */
export function enumerateRunouts(unseen: readonly Card[], missing: number): Card[][] {
  if (missing === 0) return [[]];
  if (missing === 1) return unseen.map((c) => [c]);
  const out: Card[][] = [];
  for (let i = 0; i < unseen.length; i++) for (let j = i + 1; j < unseen.length; j++) out.push([unseen[i]!, unseen[j]!]);
  return out;
}

/** Credit `attacker`'s combos for this runout against `defender`'s indexes. */
function creditRunout(attacker: Side, defender: Side): void {
  const { idx, rank, m, live } = attacker;
  for (let k = 0; k < m; k++) {
    const i = idx[k]!;
    const r = rank[k]!;
    const a = live.a[i]!;
    const b = live.b[i]!;
    const combo = live.combo[i]!;
    let lose = defender.cumulativeByRank[r - 1]!;
    let tie = defender.weightByRank[r]!;
    let win = defender.total - defender.cumulativeByRank[r]!;
    // Exact card removal: villain combos holding a or b never play against (a, b).
    for (const card of [a, b]) {
      const below = defender.cardWeightBelow(card, r);
      const atOrBelow = defender.cardWeightAtOrBelow(card, r);
      lose -= below;
      tie -= atOrBelow - below;
      win -= defender.segmentTotal[card]! - atOrBelow;
    }
    // The villain combo with the same two cards sat in both lists: it was subtracted twice.
    tie += defender.weights[combo]!;
    attacker.numerator[combo]! += win + 0.5 * tie;
    attacker.denominator[combo]! += win + tie + lose;
    attacker.winWeight[combo]! += win;
    attacker.tieWeight[combo]! += tie;
    attacker.loseWeight[combo]! += lose;
  }
}

function rangeEquity(side: Side): number {
  let numerator = 0;
  let denominator = 0;
  for (let k = 0; k < side.live.n; k++) {
    const combo = side.live.combo[k]!;
    const w = side.live.weight[k]!;
    numerator += w * side.numerator[combo]!;
    denominator += w * side.denominator[combo]!;
  }
  return denominator > 0 ? numerator / denominator : Number.NaN;
}

function ratio(numerator: Float64Array, denominator: Float64Array): Float32Array {
  const out = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  for (let i = 0; i < COMBO_COUNT; i++) if (denominator[i]! > 0) out[i] = numerator[i]! / denominator[i]!;
  return out;
}

function assemble(hero: Side, villain: Side, runouts: number): EquityResult {
  const heroEquity = rangeEquity(hero);
  const villainEquity = rangeEquity(villain);
  const perComboEquity = ratio(hero.numerator, hero.denominator);
  const perComboEquityVillain = ratio(villain.numerator, villain.denominator);
  return {
    players: 2,
    equities: [heroEquity, villainEquity],
    heroEquity,
    villainEquity,
    perComboEquity,
    perComboEquityVillain,
    perCombo: [perComboEquity, perComboEquityVillain],
    perComboWinTieLose: {
      win: ratio(hero.winWeight, hero.denominator),
      tie: ratio(hero.tieWeight, hero.denominator),
      lose: ratio(hero.loseWeight, hero.denominator),
    },
    exact: true,
    work: runouts,
  };
}

/** Exact equity of two ranges on a board of 3–5 cards. */
export async function exactHeadsUp(
  ranges: readonly [WeightedRange, WeightedRange],
  board: readonly Card[],
  deadCards: readonly Card[],
  evaluator: HandEvaluator,
  options: EquityOptions,
): Promise<EquityResult> {
  await evaluator.ready();
  const dead = cardFlags([...board, ...deadCards]);
  const hero = new Side(ranges[0], dead);
  const villain = new Side(ranges[1], dead);
  const unseen: Card[] = [];
  for (let c = 0; c < CARD_COUNT; c++) if (!dead[c]) unseen.push(c);
  const runouts = enumerateRunouts(unseen, BOARD_SIZE - board.length);
  const chunk = options.chunk ?? DEFAULT_CHUNK;
  const blocked = new Uint8Array(CARD_COUNT);
  const full: Card[] = [...board, ...new Array<Card>(BOARD_SIZE - board.length).fill(0)];

  for (let r = 0; r < runouts.length; r++) {
    if (r % chunk === 0) await checkpoint(r, runouts.length, options.signal, options.onProgress);
    const runout = runouts[r]!;
    for (let k = 0; k < runout.length; k++) {
      blocked[runout[k]!] = 1;
      full[board.length + k] = runout[k]!;
    }
    hero.evaluate(blocked, full, evaluator);
    villain.evaluate(blocked, full, evaluator);
    hero.index();
    villain.index();
    creditRunout(hero, villain);
    creditRunout(villain, hero);
    for (const c of runout) blocked[c] = 0;
  }
  options.onProgress?.(runouts.length, runouts.length);
  return assemble(hero, villain, runouts.length);
}
