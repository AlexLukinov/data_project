/**
 * What the analysis panels need at the replayer's current node (spec §9.3).
 *
 * Stepping asks the library the same question a player would: "what do I have written down for
 * this spot, and what do I have written down for what they just did?". Answers are cached per
 * situation, so stepping back and forth through a hand is one lookup per distinct node.
 */

import type { NodeKey, ReplayHand } from '@poker/core';
import { DECISIONS, canonicalNodeKey, nodeKeyAt } from '@poker/core';

import type { StoredRange } from '../ranges/api';

export interface NodeRanges {
  /** The stored range for the seat that just acted. */
  readonly mine: StoredRange | null;
  /** The stored range for what the other seat did before that. */
  readonly villain: StoredRange | null;
  readonly villainNode: NodeKey | null;
}

export const NO_RANGES: NodeRanges = { mine: null, villain: null, villainNode: null };

/** The action index of the last decision strictly before `index`, or -1. */
function lastDecisionBefore(hand: ReplayHand, index: number): number {
  for (let i = Math.min(index, hand.actions.length) - 1; i >= 0; i--) {
    if (DECISIONS.has(hand.actions[i]!.kind)) return i;
  }
  return -1;
}

/**
 * The step at which the *other* seat last did something before `index` — the node whose stored
 * range is the range hero is up against. Folds are skipped: a seat that got out of the way is
 * not who anybody is playing against. `0` when there is none (an open faces nobody).
 */
export function villainStep(hand: ReplayHand, index: number): number {
  const mine = lastDecisionBefore(hand, index);
  if (mine === -1) return 0;
  const seat = hand.actions[mine]!.seat;
  for (let i = mine - 1; i >= 0; i--) {
    const action = hand.actions[i]!;
    if (DECISIONS.has(action.kind) && action.kind !== 'fold' && action.seat !== seat) return i + 1;
  }
  return 0;
}

export type Lookup = (key: NodeKey) => Promise<StoredRange[]>;

export interface NodeRangeReader {
  at(hand: ReplayHand, index: number): Promise<NodeRanges>;
}

/**
 * A reader over the library's `lookup`, with one cache entry per situation. A lookup that fails
 * (the API is away) resolves to "nothing stored" rather than throwing: the replayer must keep
 * working with no server, since the hand it is showing is already in the browser.
 */
export function createNodeRangeReader(lookup: Lookup): NodeRangeReader {
  const cache = new Map<string, StoredRange | null>();

  async function first(key: NodeKey | null): Promise<StoredRange | null> {
    if (key === null) return null;
    const id = canonicalNodeKey(key);
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    const found = await lookup(key).catch(() => []);
    const range = found[0] ?? null;
    cache.set(id, range);
    return range;
  }

  return {
    async at(hand, index) {
      const mineKey = nodeKeyAt(hand, index);
      const villainKey = nodeKeyAt(hand, villainStep(hand, index));
      const [mine, villain] = await Promise.all([first(mineKey), first(villainKey)]);
      return { mine, villain, villainNode: villainKey };
    },
  };
}
