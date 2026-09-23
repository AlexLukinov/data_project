/**
 * What the pool does at a node (plan F.8): the tiered answers, keyed by the same `NodeKey` the
 * range library stores and the replayer derives (ADR-028).
 *
 * Every answer carries its own sample size and whether the server was willing to put numbers on
 * it — `enough` is the server's verdict (ADR-067) and nothing here re-decides it. Since plan G.3
 * (ADR-076) a tier-1 frequency also carries the interval it rests on, computed over per-player
 * sums rather than rows, and `min_n` is what *this* node needs rather than a constant: the row
 * count at which, at this node's own player correlation, the widest interval would meet the bar.
 * So "240 of the 1,800 needed" is a true sentence wherever it is printed, and `enough` is
 * `sample_size >= min_n` together with `players >= min_players`.
 */

import type { NodeKey } from '@poker/core';
import { nodeKeyJson } from '@poker/core';

import type { Fetcher } from '../auth/api';
import type { Interval } from '../stats/api';

export interface NodeAnswer {
  tier: 1 | 2 | 3;
  sample_size: number;
  enough: boolean;
  /** What this node needs before its numbers may be acted on: per node for tier 1, a constant for a dealt sample. */
  min_n: number;
}

export interface NodeFrequencies extends NodeAnswer {
  /**
   * Decisions per action at this node. Empty under the floor of `min_n` (100 rows, where nothing
   * is measured yet); filled above it whether or not `enough` — a measured "fold 45%, ±12" is
   * shipped so the reader can see why it is withheld, and is acted on only when `enough`.
   */
  actions: Record<string, number>;
  /** The same, as shares summing to 1. Same rule as `actions`. */
  frequencies: Record<string, number>;
  /** Each frequency's cluster-robust 95% interval, in the same shares. Same rule as `actions`. */
  intervals: Record<string, Interval>;
  /** The distinct players the sample came from — what the intervals rest on. */
  players: number;
  /** The binding action's design effect (the one whose interval is widest), when measured. */
  design_effect: number | null;
  /** The bar `enough` was judged against: the widest arm a frequency may be shown with, as a share. */
  max_half_width: number;
  /** The players a node needs before any interval is offered at all. */
  min_players: number;
}

export interface NodeShowdownRange extends NodeAnswer {
  /** How many decisions happened at this node at all. */
  decisions_at_node: number;
  /** The share of those whose cards were revealed — the range's honest denominator. */
  covers: number;
  /** Shown hands per 169-combo class ('AKs', 'QQ'). Empty while `enough` is false. */
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
  /** Tier 1's interval around it (ADR-076). */
  observed_interval: Interval | null;
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

/**
 * Which players a node is asked about, as one string (plan G.4, ADR-080): `''` the whole field, a
 * saved cohort's id, `preset:<code>` for one of the seven shipped cohorts, or `group:<key>` for one
 * of the five behaviour groups — the same key `cohortChoices` already gives a shipped cohort, so a
 * chooser's key is sent as it stands and nothing decides here which of them it is.
 */
export type CohortKey = string;

export const WHOLE_FIELD_KEY: CohortKey = '';
const PRESET_PREFIX = 'preset:';
const GROUP_PREFIX = 'group:';

/** The key of a shipped cohort, by its code ('reg', 'fish', …). */
export function presetKey(code: string): CohortKey {
  return `${PRESET_PREFIX}${code}`;
}

/** The key of a behaviour group, by its key ('all', 'reg', 'other', 'fish', 'unknown'). */
export function groupKey(key: string): CohortKey {
  return `${GROUP_PREFIX}${key}`;
}

/**
 * The query string a cohort key becomes: a preset or a group goes as `?cohort=`, in the server's own
 * scheme; anything else is a saved cohort's id and goes as `?cohort_id=`; the field is nothing.
 */
export function cohortQuery(key?: CohortKey): string {
  if (key === undefined || key === WHOLE_FIELD_KEY) return '';
  if (key.startsWith(PRESET_PREFIX) || key.startsWith(GROUP_PREFIX)) return `?cohort=${encodeURIComponent(key)}`;
  return `?cohort_id=${encodeURIComponent(key)}`;
}

export interface PoolApi {
  frequencies(key: NodeKey, cohort?: CohortKey): Promise<NodeFrequencies>;
  showdownRange(key: NodeKey, cohort?: CohortKey): Promise<NodeShowdownRange>;
  estimatedRange(key: NodeKey, prior: Record<string, number>, cohort?: CohortKey): Promise<NodeEstimatedRange>;
  realization(key: NodeKey, cohort?: CohortKey): Promise<NodeRealization>;
}

function path(name: string, cohort?: CohortKey): string {
  return `/v1/pool/node/${name}${cohortQuery(cohort)}`;
}

/** Bind the node endpoints to a fetcher (the auth store's, which adds the bearer header). */
export function createPoolApi(fetch: Fetcher): PoolApi {
  return {
    frequencies: (key, cohort) =>
      fetch<NodeFrequencies>(path('frequencies', cohort), { method: 'POST', body: nodeKeyJson(key) }),
    showdownRange: (key, cohort) =>
      fetch<NodeShowdownRange>(path('showdown-range', cohort), { method: 'POST', body: nodeKeyJson(key) }),
    estimatedRange: (key, prior, cohort) =>
      fetch<NodeEstimatedRange>(path('estimated-range', cohort), {
        method: 'POST',
        body: { node: nodeKeyJson(key), prior },
      }),
    realization: (key, cohort) =>
      fetch<NodeRealization>(path('eqr', cohort), { method: 'POST', body: nodeKeyJson(key) }),
  };
}
