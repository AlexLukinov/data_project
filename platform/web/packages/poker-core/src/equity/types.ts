/**
 * The equity engine's contract (spec §5.2–5.4). Two players are computed exactly on a flop,
 * turn or river; preflop and three or more players go through Monte Carlo.
 */

import type { Card } from '../cards';
import type { HandEvaluator } from '../evaluator/types';
import type { WeightedRange } from '../range';

export interface EquityRequest {
  /** Player 0 is "hero", player 1 "villain"; up to 10 players for Monte Carlo. */
  readonly ranges: readonly WeightedRange[];
  /** 0, 3, 4 or 5 cards. */
  readonly board: readonly Card[];
  /** Cards known to be out of play (folded and shown, exposed, …). */
  readonly deadCards?: readonly Card[];
}

export type EquityMode = 'auto' | 'exact' | 'monte-carlo';

export interface EquityOptions {
  /** `auto` (default): exact when two players and a board of three or more cards, else Monte Carlo. */
  readonly mode?: EquityMode;
  /** Monte Carlo samples (default 100,000). One sample = one matchup on one runout. */
  readonly iterations?: number;
  /** Seed for Monte Carlo; the same seed reproduces the same result. */
  readonly seed?: number;
  readonly evaluator?: HandEvaluator;
  /** Abort between chunks; the promise rejects with `EquityCancelled`. */
  readonly signal?: AbortSignal;
  /** Called between chunks with work done and total (runouts, or samples). */
  readonly onProgress?: (done: number, total: number) => void;
  /** Runouts (exact) or samples (Monte Carlo) between two yields to the event loop. */
  readonly chunk?: number;
}

export interface WinTieLose {
  readonly win: Float32Array;
  readonly tie: Float32Array;
  readonly lose: Float32Array;
}

export interface EquityResult {
  readonly players: number;
  /** Equity per player, summing to 1. */
  readonly equities: readonly number[];
  readonly heroEquity: number;
  readonly villainEquity: number;
  /** Player 0's equity per combo; NaN for a combo not in the range or blocked by the board. */
  readonly perComboEquity: Float32Array;
  readonly perComboEquityVillain: Float32Array;
  /** Per player, same layout as `perComboEquity`. */
  readonly perCombo: readonly Float32Array[];
  /** Player 0's win / tie / lose probabilities per combo (each sums to 1 where defined). */
  readonly perComboWinTieLose: WinTieLose;
  readonly exact: boolean;
  /** Monte Carlo only. */
  readonly iterations?: number;
  /** Monte Carlo only: ± percentage points on `heroEquity` at 95%. */
  readonly confidence95?: number;
  /** Runouts enumerated (exact) or samples drawn (Monte Carlo). */
  readonly work: number;
}

/** Thrown when the `signal` aborts a computation. */
export class EquityCancelled extends Error {
  constructor() {
    super('equity computation cancelled');
    this.name = 'EquityCancelled';
  }
}

export const DEFAULT_ITERATIONS = 100_000;
export const MAX_PLAYERS = 10;
