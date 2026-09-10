/**
 * The equity engine's front door: validate, pick exact or Monte Carlo, and a stable cache key.
 */

import type { Card } from '../cards';
import { CARD_COUNT, COMBO_COUNT, cardToString } from '../cards';
import { fastEvaluator } from '../evaluator/fast';
import type { WeightedRange } from '../range';
import { exactHeadsUp } from './exact';
import { monteCarlo } from './montecarlo';
import type { EquityOptions, EquityRequest, EquityResult } from './types';
import { DEFAULT_ITERATIONS, MAX_PLAYERS } from './types';

const FLOP = 3;
const RIVER = 5;

function validate(request: EquityRequest): void {
  const { ranges, board, deadCards = [] } = request;
  if (ranges.length < 2 || ranges.length > MAX_PLAYERS) {
    throw new RangeError(`equity needs 2 to ${MAX_PLAYERS} ranges, got ${ranges.length}`);
  }
  for (const r of ranges) if (r.weights.length !== COMBO_COUNT) throw new RangeError('a range has 1326 weights');
  if (board.length !== 0 && (board.length < FLOP || board.length > RIVER)) {
    throw new RangeError(`a board has 0, 3, 4 or 5 cards, got ${board.length}`);
  }
  const seen = new Uint8Array(CARD_COUNT);
  for (const c of [...board, ...deadCards]) {
    if (!Number.isInteger(c) || c < 0 || c >= CARD_COUNT) throw new RangeError(`${c} is not a card id`);
    if (seen[c]) throw new RangeError(`${cardToString(c)} appears twice among the board and dead cards`);
    seen[c] = 1;
  }
}

/** Whether the request can be enumerated exactly: two players on a flop, turn or river. */
export function isExactlySolvable(request: EquityRequest): boolean {
  return request.ranges.length === 2 && request.board.length >= FLOP;
}

/** Compute equities. Rejects with `EquityCancelled` when `options.signal` aborts. */
export async function computeEquity(request: EquityRequest, options: EquityOptions = {}): Promise<EquityResult> {
  validate(request);
  const evaluator = options.evaluator ?? fastEvaluator;
  const dead = request.deadCards ?? [];
  const mode = options.mode ?? 'auto';
  const exact = mode === 'exact' || (mode === 'auto' && isExactlySolvable(request));
  if (exact) {
    if (!isExactlySolvable(request)) {
      throw new RangeError('exact equity needs exactly two ranges and a board of at least three cards');
    }
    return exactHeadsUp([request.ranges[0]!, request.ranges[1]!], request.board, dead, evaluator, options);
  }
  return monteCarlo(request.ranges, request.board, dead, evaluator, options);
}

/** FNV-1a over bytes, as 8 hex digits. */
function fnv1a(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function rangeDigest(range: WeightedRange): string {
  const bytes = new Uint8Array(range.weights.buffer, range.weights.byteOffset, range.weights.byteLength);
  return fnv1a(bytes).toString(16).padStart(8, '0') + fnv1a(bytes, 0x9747b28c).toString(16).padStart(8, '0');
}

/**
 * A key that is equal exactly when two computations would return the same numbers: the
 * ranges' weights, the board, the dead cards, and — for Monte Carlo — iterations and seed.
 */
export function equityKey(request: EquityRequest, options: EquityOptions = {}): string {
  const cards = (list: readonly Card[]): string => list.map(cardToString).join('');
  const exact = options.mode === 'exact' || ((options.mode ?? 'auto') === 'auto' && isExactlySolvable(request));
  const method = exact ? 'exact' : `mc:${options.iterations ?? DEFAULT_ITERATIONS}:${options.seed ?? 'random'}`;
  return [request.ranges.map(rangeDigest).join('|'), cards(request.board), cards(request.deadCards ?? []), method].join('/');
}

export { enumerateRunouts } from './exact';
export * from './types';
