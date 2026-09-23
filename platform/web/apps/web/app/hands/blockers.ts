/**
 * The defender's range split into what continues and what folds, with the pool's frequency and
 * the reader's chart (plan H.7; ADR-094).
 *
 * `BlockerPanel` wants villain's calling range and villain's folding range. On the trainers those
 * are hand-painted; here the seat that has to answer the bet is at `facingNode(node)` (the
 * analyzer's own convention, ADR-034) and the pool is asked **tier 1** there: how often that seat
 * folds, calls and raises. Every decision records its action, so that frequency is unbiased and
 * works per group.
 *
 * **Why not tier 3, hand class by hand class.** It was the first design, and it is wrong at a
 * facing node for the reason ADR-035 gives against the direct estimate: hole cards are seen at
 * showdown, a seat that folds is almost never shown, so the revealed hands at the facing node are
 * the continuers. Tier 3's likelihood ratio then compares callers with raisers and carries no
 * fold information at all — `P(call) × L + P(raise) × L'` collapses to the node's own continue
 * rate for every class — and what fold information there is comes from the one seat whose folded
 * cards are recorded: the founder's own. A table cut that way would rank nothing while claiming
 * the pool's per-class rates. A number nobody measured does not reach a row (ADR-033).
 *
 * **What is measured, and what is assumed.** The pool gives the *share* that continues. The
 * *composition* is the reader's chart for the defender, ordered by its equity against the bettor's
 * range, taking the top of it until the share is met — the same construction the MDF panel uses
 * for the defending set (`defendingSet`, poker-core), with the pool's actual rate in place of the
 * theoretical MDF. The panel says which half is which: the rate is the pool's, the ordering is a
 * rule of thumb, and no solver was asked (ADR-034's "a reveal says where it comes from").
 *
 * One ClickHouse query per press, never per step (ADR-079).
 */

import type { ComboIndex, DefendingSet, NodeKey, WeightedRange } from '@poker/core';
import { COMBO_COUNT, createRange, defendingSet } from '@poker/core';

import type { NodeFrequencies, PoolApi } from '../pool/api';

/** The share of the defender's decisions at the facing node that did not fold. */
export function continueShare(answer: NodeFrequencies): number {
  const fold = answer.frequencies.fold ?? 0;
  return Math.min(1, Math.max(0, 1 - fold));
}

export interface EquitySplit {
  readonly call: WeightedRange;
  readonly fold: WeightedRange;
  readonly set: DefendingSet;
}

/**
 * The chart cut at `share` by equity: the strongest combos that add up to the share continue
 * with their chart weight, the rest fold with theirs. A combo the engine gave no equity (blocked
 * by the board, or outside the chart) is in neither half.
 */
export function splitByEquity(chart: WeightedRange, equities: Float32Array, share: number): EquitySplit {
  const set = defendingSet({ equities, weights: chart.weights }, share);
  const continuing = new Set<ComboIndex>(set.combos);
  const call = new Float32Array(COMBO_COUNT);
  const fold = new Float32Array(COMBO_COUNT);
  for (let combo = 0; combo < COMBO_COUNT; combo += 1) {
    const weight = chart.weights[combo] ?? 0;
    if (weight <= 0 || !Number.isFinite(equities[combo] ?? Number.NaN)) continue;
    if (continuing.has(combo)) call[combo] = weight;
    else fold[combo] = weight;
  }
  return { call: createRange(call, 'continues'), fold: createRange(fold, 'folds'), set };
}

/** What the pool said at the facing node, and what was made of it. */
export interface PoolSplit {
  /** Tier 1 at the facing node: the badge's numbers and the continue share. */
  readonly answer: NodeFrequencies;
  /** `1 − fold`; meaningful only while `answer.enough`. */
  readonly continues: number;
  /** Null while the pool withheld its frequency, or while the chart has no equities yet. */
  readonly ranges: EquitySplit | null;
}

/**
 * One ask, then the cut. `null` when the situation went stale before the answer landed. A
 * refused ask rejects, so the caller can word it (`hands/study.ts`). `equities` may be null —
 * the calculator has not run yet — and the answer is then kept with no ranges, so the badge and
 * the rate are shown while the table waits.
 */
export async function poolSplit(
  api: Pick<PoolApi, 'frequencies'>,
  facing: NodeKey,
  chart: WeightedRange | null,
  equities: Float32Array | null,
  cohortId: string,
  stale: () => boolean,
): Promise<PoolSplit | null> {
  const answer = await api.frequencies(facing, cohortId);
  if (stale()) return null;
  const continues = continueShare(answer);
  const ranges = answer.enough && chart !== null && equities !== null ? splitByEquity(chart, equities, continues) : null;
  return { answer, continues, ranges };
}
