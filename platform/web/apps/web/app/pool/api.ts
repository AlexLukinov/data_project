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
  tier: 1 | 2;
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

export interface PoolApi {
  frequencies(key: NodeKey, cohortId?: string): Promise<NodeFrequencies>;
  showdownRange(key: NodeKey, cohortId?: string): Promise<NodeShowdownRange>;
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
  };
}
