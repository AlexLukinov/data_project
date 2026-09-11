/**
 * The My game endpoints (plan D.7, §2.8, ADR-026) — for now, the leak finder.
 *
 * Field names are the API's, exactly as `analysis/hero/leaks.py` sends them. A leak is
 * deliberately thin: a **stat code**, the hero's value, the baseline's, the gap and
 * `|delta| * sqrt(n)` as a score, so a large deviation over many opportunities outranks a larger
 * one over few. It carries no situation — what the leak is *about* lives in the registry entry
 * that `code` names, which is what makes the drill-through of `leaks.ts` possible without the
 * client knowing any poker.
 */

import type { Fetcher } from '../auth/api';

export interface Leak {
  /** The registry stat this leak is about; `stats.byCode` has its situation and action. */
  code: string;
  label: string;
  category: 'preflop' | 'postflop' | 'showdown' | 'money';
  /** The hero's value, in the stat's own format (a percentage, for every ranked stat). */
  value: number;
  /** Opportunities behind `value` — the denominator, and the size of the spot itself. */
  n: number;
  baseline: number;
  baseline_n: number;
  delta: number;
  score: number;
  direction: 'above' | 'below';
  /** The band the stat usually falls in, `[low, high]`, where the registry commits to one. */
  typical?: [number, number] | null;
  higher_is_better?: boolean | null;
}

export interface LeaksResult {
  hands: number;
  /** Opportunities below this are noise, not a leak; `skipped` names what fell under it. */
  min_n: number;
  leaks: Leak[];
  skipped: string[];
}

export interface LeaksFilters {
  date_from?: string;
  date_to?: string;
  min_n?: number;
  cohort_id?: string;
}

export interface HeroApi {
  leaks(filters?: LeaksFilters): Promise<LeaksResult>;
}

function query(filters: LeaksFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, String(value));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** Bind the hero endpoints to a fetcher (the auth store's, which adds the bearer header). */
export function createHeroApi(fetch: Fetcher): HeroApi {
  return {
    leaks: (filters = {}) => fetch<LeaksResult>(`/v1/hero/leaks${query(filters)}`),
  };
}
