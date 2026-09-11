/**
 * The stat registry and the report engine on the wire (plan §2.5, §2.7, ADR-021, ADR-022).
 *
 * Field names are the API's (snake_case), exactly as `stats/definitions.py`, `stats/ast.py` and
 * `stats/request.py` send them. Two aliases matter and are the only shape the client may emit:
 * negation is `not` (never `not_`) and a conditional count is `countIf` (never `count_if`).
 *
 * Every model on the Python side is `extra="forbid"`, so a stray key — a UI id, a label on a
 * leaf — is a 422 rather than a field the server ignores. Nothing here carries UI state.
 */

import type { Fetcher } from '../auth/api';

export type Table = 'decisions' | 'player_hands' | 'stats_daily';
export type DimType = 'enum' | 'number' | 'bool' | 'line' | 'string';
export type Dataset = 'hero' | 'population';
export type StatFormat = 'percent' | 'ratio' | 'per100' | 'count';
export type Grain = 'hand' | 'decision';

export type Op = 'in' | 'not_in' | 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'prefix' | 'like';

/** Ops whose value is a list. Everything else takes one scalar (`stats/ast.py` LIST_OPS). */
export const LIST_OPS: readonly Op[] = ['in', 'not_in', 'between'];

export type Scalar = string | number;

/** One comparison. `value` is a list for `in`/`not_in`/`between`, a scalar otherwise. */
export interface Leaf {
  dim: string;
  op: Op;
  value: Scalar | Scalar[];
}

/** The filter tree of §2.5. `{all: []}` is the default and means every row; `{any: []}` is a 422. */
export type FilterNode = Leaf | { all: FilterNode[] } | { any: FilterNode[] } | { not: FilterNode };

/** A presentation bucket `[low, high)`; `null` is an open end. */
export type BucketRange = [number | null, number | null];

export interface Dimension {
  code: string;
  label: string;
  type: DimType;
  tables: Table[];
  description: string;
  /** The vocabulary of an enum, `[]` otherwise. `''` is a real value meaning "not applicable". */
  values: string[];
  /** Set only where the registry narrows the type's defaults; read `allowed_ops` instead. */
  ops: Op[] | null;
  group_by: boolean;
  buckets: Record<string, BucketRange>;
  /** Computed server-side: the ops this dimension accepts. The op picker is driven by this. */
  allowed_ops: Op[];
}

export interface Stat {
  code: string;
  label: string;
  category: 'preflop' | 'postflop' | 'showdown' | 'money';
  grain: Grain;
  format: StatFormat;
  description?: string;
  higher_is_better?: boolean | null;
}

export interface DefinitionsResponse {
  stats: Stat[];
  dimensions: Dimension[];
}

/**
 * A report request. Only the fields a screen actually sets are optional here; the server
 * defaults the rest. `dataset: 'population'` must travel with `hero_only: false` — the pair is
 * validated together and either alone is a 422.
 */
export type ReportRequest = {
  dataset?: Dataset;
  hero_only?: boolean;
  date_from?: string | null;
  date_to?: string | null;
  filter?: FilterNode;
  group_by?: string[];
  stats?: string[];
  limit?: number;
};
/* A type alias, not an interface: the fetcher takes `Record<string, unknown>` as a body, and
   only an alias carries the implicit index signature that assignment needs. */

export interface Cell {
  value: number | null;
  n: number;
  baseline: number | null;
  baseline_n: number | null;
  delta: number | null;
}

export interface ReportRow {
  group: Record<string, string | number | null>;
  hands: number;
  cells: Record<string, Cell>;
}

export interface StatMeta {
  code: string;
  label: string;
  format: StatFormat;
  grain: Grain;
  description: string;
}

export interface ReportResult {
  hands: number;
  group_by: string[];
  stats: StatMeta[];
  rows: ReportRow[];
  cached: boolean;
}

export interface StatsApi {
  definitions(): Promise<DefinitionsResponse>;
  runReport(request: ReportRequest): Promise<ReportResult>;
}

/** Bind the registry and report endpoints to a fetcher (the auth store's, which adds the bearer). */
export function createStatsApi(fetch: Fetcher): StatsApi {
  return {
    definitions: () => fetch<DefinitionsResponse>('/v1/definitions'),
    runReport: (request) => fetch<ReportResult>('/v1/reports/run', { method: 'POST', body: request }),
  };
}
