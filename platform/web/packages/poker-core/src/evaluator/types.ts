import type { Card } from '../cards';

/**
 * A 7-card hand evaluator (spec §5.1). Ranks are Cactus-Kev / PokerHandEvaluator compatible:
 * 1 = royal flush … 7462 = 7-5-4-3-2 offsuit, lower is stronger, equal means a tie.
 */
export interface HandEvaluator {
  /** Human-readable, for the "exact / Monte Carlo / which engine" status line. */
  readonly name: string;
  /** Resolves when the evaluator can be called; the pure-TS one resolves immediately. */
  ready(): Promise<void>;
  /** Rank of the best 5-card hand among 7 cards. Lower is stronger. */
  rank7(c0: Card, c1: Card, c2: Card, c3: Card, c4: Card, c5: Card, c6: Card): number;
}

/** Hand categories, weakest first. */
export const enum Category {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES: readonly string[] = [
  'high card',
  'pair',
  'two pair',
  'three of a kind',
  'straight',
  'flush',
  'full house',
  'four of a kind',
  'straight flush',
];

/** Cactus-Kev rank layout: the first (strongest) rank of each category, strongest category first. */
export const RANK_BASE = {
  straightFlush: 1,
  quads: 11,
  fullHouse: 167,
  flush: 323,
  straight: 1600,
  trips: 1610,
  twoPair: 2468,
  pair: 3326,
  highCard: 6186,
} as const;

export const WORST_RANK = 7462;

/** The category a rank belongs to. */
export function categoryOfRank(rank: number): Category {
  if (rank < RANK_BASE.quads) return Category.StraightFlush;
  if (rank < RANK_BASE.fullHouse) return Category.Quads;
  if (rank < RANK_BASE.flush) return Category.FullHouse;
  if (rank < RANK_BASE.straight) return Category.Flush;
  if (rank < RANK_BASE.trips) return Category.Straight;
  if (rank < RANK_BASE.twoPair) return Category.Trips;
  if (rank < RANK_BASE.pair) return Category.TwoPair;
  if (rank < RANK_BASE.highCard) return Category.Pair;
  return Category.HighCard;
}
