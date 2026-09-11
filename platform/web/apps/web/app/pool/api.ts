/**
 * What the pool does at a node (plan F.8): the two tiered answers, keyed by the same `NodeKey`
 * the range library stores and the replayer derives (ADR-028).
 *
 * Both answers carry their own sample size and whether the server was willing to put numbers on
 * it — a node under `min_n` comes back with empty maps, never with a percentage.
 */

import type { NodeKey } from '@poker/core';
import { nodeKeyJson } from '@poker/core';

import type { Fetcher } from '../auth/api';

export interface NodeAnswer {
  tier: 1 | 2 | 3;
  sample_size: number;
  enough: boolean;
  min_n: number;
}

export interface NodeFrequencies extends NodeAnswer {
  /** Decisions per action at this node. Empty while `enough` is false. */
  actions: Record<string, number>;
  /** The same, as shares summing to 1. Empty while `enough` is false. */
  frequencies: Record<string, number>;
}

export interface NodeShowdownRange extends NodeAnswer {
  /** How many decisions happened at this node at all. */
  decisions_at_node: number;
  /** The share of those whose cards were revealed — the range's honest denominator. */
  covers: number;
  /** Shown hands per 169-combo class ('AKs', 'QQ'). */
  classes: Record<string, number>;
  weights: Record<string, number>;
}

/** One 169-combo class of a tier-3 reconstruction (plan F.10). */
export interface ClassEstimate {
  hand_class: string;
  /** The class's share of the prior that was sent. */
  prior: number;
  posterior: number;
  /** How much the class moves: 1 is "takes this action as often as the node's average". */
  likelihood: number;
  action_rate: number;
  /** Revealed decisions of this class at the node — what `likelihood` was measured from. */
  sample_size: number;
  /** True when the sample was too thin to reweight, so the prior was left exactly alone. */
  fallback: boolean;
}

export interface NodeEstimatedRange extends NodeAnswer {
  /** The action the node's last step takes, as the decision fact spells it. */
  action: string;
  min_bucket_n: number;
  /** Revealed decisions at the node, all classes together. */
  shown: number;
  covers: number;
  /** Tier 1's frequency for the action: unbiased, because every decision records its action. */
  observed_frequency: number | null;
  /** What the reweighting says that frequency should be. The gap is the prior's error. */
  implied_frequency: number | null;
  classes: ClassEstimate[];
}

/** What one holding took away from a node. Numbers are null under the bucket threshold. */
export interface ClassRealization {
  hand_class: string;
  sample_size: number;
  mean_net_bb: number | null;
  mean_pot_bb: number | null;
  /** EV as a share of the pot. Divide by equity for EQR — the equity is ours to compute. */
  realized: number | null;
}

export interface NodeRealization extends NodeAnswer {
  action: string;
  min_bucket_n: number;
  covers: number;
  /** `invested_bb` is not on the built mart yet, so the question cannot be asked at all. */
  needs_rebuild: boolean;
  /** Every decision that took the action, revealed or not: the sample nothing selects. */
  overall: ClassRealization | null;
  by_hand_class: ClassRealization[];
}

export interface PoolApi {
  frequencies(key: NodeKey, cohortId?: string): Promise<NodeFrequencies>;
  showdownRange(key: NodeKey, cohortId?: string): Promise<NodeShowdownRange>;
  estimatedRange(key: NodeKey, prior: Record<string, number>, cohortId?: string): Promise<NodeEstimatedRange>;
  realization(key: NodeKey, cohortId?: string): Promise<NodeRealization>;
}

function path(name: string, cohortId?: string): string {
  return `/v1/pool/node/${name}${cohortId === undefined || cohortId === '' ? '' : `?cohort_id=${cohortId}`}`;
}

/** Bind the node endpoints to a fetcher (the auth store's, which adds the bearer header). */
export function createPoolApi(fetch: Fetcher): PoolApi {
  return {
    frequencies: (key, cohortId) =>
      fetch<NodeFrequencies>(path('frequencies', cohortId), { method: 'POST', body: nodeKeyJson(key) }),
    showdownRange: (key, cohortId) =>
      fetch<NodeShowdownRange>(path('showdown-range', cohortId), { method: 'POST', body: nodeKeyJson(key) }),
    estimatedRange: (key, prior, cohortId) =>
      fetch<NodeEstimatedRange>(path('estimated-range', cohortId), {
        method: 'POST',
        body: { node: nodeKeyJson(key), prior },
      }),
    realization: (key, cohortId) =>
      fetch<NodeRealization>(path('eqr', cohortId), { method: 'POST', body: nodeKeyJson(key) }),
  };
}
