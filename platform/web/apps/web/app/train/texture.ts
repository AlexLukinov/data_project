/**
 * A short name for what a board looks like, used to break `/progress` down "per hand class or
 * texture where applicable" (spec §16).
 *
 * Deliberately coarse: suitedness and whether the board is paired give six buckets, which is
 * few enough that a month of practice puts a readable sample in each. The registry's richer
 * texture dimensions live server-side and are not needed to drill offline.
 */
import type { Card } from '@poker/core';
import { rankOf, suitOf } from '@poker/core';

const MIN_BOARD = 3;
const MONOTONE = 3;
const TWO_TONE = 2;

function counts(values: readonly number[]): number[] {
  const seen = new Map<number, number>();
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
  return [...seen.values()].sort((a, b) => b - a);
}

/** How many of the board's cards share its most common suit. */
function longestSuit(board: readonly Card[]): number {
  return counts(board.map(suitOf))[0] ?? 0;
}

function suitedness(board: readonly Card[]): string {
  const longest = longestSuit(board);
  if (longest >= MONOTONE) return 'monotone';
  if (longest === TWO_TONE) return 'two-tone';
  return 'rainbow';
}

/** Whether any rank appears more than once. */
export function isPairedBoard(board: readonly Card[]): boolean {
  return (counts(board.map(rankOf))[0] ?? 0) > 1;
}

/**
 * The bucket a board belongs to: `two-tone · paired`, `rainbow · unpaired`, and so on.
 *
 * A board that has not been dealt yet is its own bucket — preflop equity and preflop pot odds
 * are worth tracking separately from anything that happened on a flop.
 */
export function textureTag(board: readonly Card[]): string {
  if (board.length < MIN_BOARD) return 'preflop';
  return `${suitedness(board)} · ${isPairedBoard(board) ? 'paired' : 'unpaired'}`;
}
