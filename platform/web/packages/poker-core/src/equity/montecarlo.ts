/**
 * Monte Carlo equity for any number of players and any street (spec §5.2–5.4). One sample is
 * one matchup — a combo per player drawn by weight, the whole tuple rejected on a card
 * collision so the joint law is ∝ Π wᵢ exactly as in the exact engine — on one random runout.
 * Card removal is therefore exact here too, by construction.
 */

import type { Card } from '../cards';
import { CARD_COUNT, COMBO_COUNT } from '../cards';
import type { HandEvaluator } from '../evaluator/types';
import type { WeightedRange } from '../range';
import { mulberry32, randomSeed } from '../random';
import { checkpoint } from './control';
import type { LiveSet } from './live';
import { cardFlags, liveCombos } from './live';
import type { EquityOptions, EquityResult } from './types';
import { DEFAULT_ITERATIONS } from './types';

const BOARD_SIZE = 5;
const DEFAULT_CHUNK = 4096;
const Z_95 = 1.96;

interface Player {
  readonly live: LiveSet;
  readonly cumulative: Float64Array;
  readonly comboNumerator: Float64Array;
  readonly comboCount: Float64Array;
  equity: number;
  chosen: number;
}

function player(range: WeightedRange, dead: Uint8Array): Player {
  const live = liveCombos(range, dead);
  if (live.n === 0) throw new RangeError('a range has no live combo against the board and dead cards');
  const cumulative = new Float64Array(live.n);
  let running = 0;
  for (let i = 0; i < live.n; i++) {
    running += live.weight[i]!;
    cumulative[i] = running;
  }
  return { live, cumulative, comboNumerator: new Float64Array(COMBO_COUNT), comboCount: new Float64Array(COMBO_COUNT), equity: 0, chosen: 0 };
}

/** Index of the combo whose cumulative weight bracket contains `u`. */
function drawCombo(p: Player, u: number): number {
  const target = u * p.live.totalWeight;
  let lo = 0;
  let hi = p.live.n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (p.cumulative[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Draw one combo per player; return false (and leave `used` clean) on any collision. */
function drawMatchup(players: Player[], used: Uint8Array, random: () => number): boolean {
  let ok = true;
  let drawn = 0;
  for (const p of players) {
    const i = drawCombo(p, random());
    const a = p.live.a[i]!;
    const b = p.live.b[i]!;
    if (used[a] || used[b]) {
      ok = false;
      break;
    }
    used[a] = 1;
    used[b] = 1;
    p.chosen = i;
    drawn++;
  }
  if (!ok) for (let k = 0; k < drawn; k++) unmark(players[k]!, used);
  return ok;
}

function unmark(p: Player, used: Uint8Array): void {
  used[p.live.a[p.chosen]!] = 0;
  used[p.live.b[p.chosen]!] = 0;
}

function drawRunout(unseen: readonly Card[], used: Uint8Array, into: Card[], from: number, random: () => number): void {
  for (let k = from; k < BOARD_SIZE; k++) {
    let c = unseen[Math.floor(random() * unseen.length)]!;
    while (used[c]) c = unseen[Math.floor(random() * unseen.length)]!;
    used[c] = 1;
    into[k] = c;
  }
}

/** Score one matchup: ranks, winners, shares; returns hero's outcome (1 win, 0.5 tie, 0 lose). */
function score(players: Player[], board: Card[], evaluator: HandEvaluator, ranks: Int32Array): number {
  let best = Number.MAX_SAFE_INTEGER;
  let winners = 0;
  for (let p = 0; p < players.length; p++) {
    const pl = players[p]!;
    const r = evaluator.rank7(pl.live.a[pl.chosen]!, pl.live.b[pl.chosen]!, board[0]!, board[1]!, board[2]!, board[3]!, board[4]!);
    ranks[p] = r;
    if (r < best) {
      best = r;
      winners = 1;
    } else if (r === best) winners++;
  }
  let heroOutcome = 0;
  for (let p = 0; p < players.length; p++) {
    const pl = players[p]!;
    const share = ranks[p] === best ? 1 / winners : 0;
    const combo = pl.live.combo[pl.chosen]!;
    pl.equity += share;
    pl.comboNumerator[combo]! += share;
    pl.comboCount[combo]! += 1;
    if (p === 0) heroOutcome = ranks[p] === best ? (winners === 1 ? 1 : 0.5) : 0;
  }
  return heroOutcome;
}

function perCombo(p: Player): Float32Array {
  const out = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  for (let i = 0; i < COMBO_COUNT; i++) if (p.comboCount[i]! > 0) out[i] = p.comboNumerator[i]! / p.comboCount[i]!;
  return out;
}

function assemble(players: Player[], samples: number, heroWins: Float64Array, heroTies: Float64Array, heroCount: Float64Array): EquityResult {
  const equities = players.map((p) => p.equity / samples);
  const per = players.map(perCombo);
  const heroEquity = equities[0]!;
  const win = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  const tie = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  const lose = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  for (let i = 0; i < COMBO_COUNT; i++) {
    const n = heroCount[i]!;
    if (n === 0) continue;
    win[i] = heroWins[i]! / n;
    tie[i] = heroTies[i]! / n;
    lose[i] = 1 - win[i]! - tie[i]!;
  }
  return {
    players: players.length,
    equities,
    heroEquity,
    villainEquity: equities[1]!,
    perComboEquity: per[0]!,
    perComboEquityVillain: per[1]!,
    perCombo: per,
    perComboWinTieLose: { win, tie, lose },
    exact: false,
    iterations: samples,
    confidence95: 100 * Z_95 * Math.sqrt((heroEquity * (1 - heroEquity)) / samples),
    work: samples,
  };
}

/** Monte Carlo equity for 2–10 ranges on a board of 0–5 cards. */
export async function monteCarlo(
  ranges: readonly WeightedRange[],
  board: readonly Card[],
  deadCards: readonly Card[],
  evaluator: HandEvaluator,
  options: EquityOptions,
): Promise<EquityResult> {
  await evaluator.ready();
  const dead = cardFlags([...board, ...deadCards]);
  const players = ranges.map((r) => player(r, dead));
  const unseen: Card[] = [];
  for (let c = 0; c < CARD_COUNT; c++) if (!dead[c]) unseen.push(c);
  const samples = options.iterations ?? DEFAULT_ITERATIONS;
  const chunk = options.chunk ?? DEFAULT_CHUNK;
  const random = mulberry32(options.seed ?? randomSeed());
  const used = new Uint8Array(CARD_COUNT);
  const full: Card[] = [...board, ...new Array<Card>(BOARD_SIZE - board.length).fill(0)];
  const ranks = new Int32Array(players.length);
  const heroWins = new Float64Array(COMBO_COUNT);
  const heroTies = new Float64Array(COMBO_COUNT);
  const heroCount = new Float64Array(COMBO_COUNT);

  for (let s = 0; s < samples; s++) {
    if (s % chunk === 0) await checkpoint(s, samples, options.signal, options.onProgress);
    used.fill(0);
    for (const c of board) used[c] = 1;
    for (const c of deadCards) used[c] = 1;
    while (!drawMatchup(players, used, random));
    drawRunout(unseen, used, full, board.length, random);
    const outcome = score(players, full, evaluator, ranks);
    const heroCombo = players[0]!.live.combo[players[0]!.chosen]!;
    heroCount[heroCombo]! += 1;
    if (outcome === 1) heroWins[heroCombo]! += 1;
    else if (outcome === 0.5) heroTies[heroCombo]! += 1;
  }
  options.onProgress?.(samples, samples);
  return assemble(players, samples, heroWins, heroTies, heroCount);
}
