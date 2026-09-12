/**
 * The My game endpoints (plan D.7, D.4, §2.8, ADR-026): the leak finder, the sessions, and the
 * winnings series behind the dashboard.
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

/* The three filter shapes are type aliases rather than interfaces for the reason `stats/api.ts`
   records about `ReportRequest`: only an alias carries the implicit index signature, and without
   it none of them can be handed to the `query()` helper below. */

export type LeaksFilters = {
  date_from?: string;
  date_to?: string;
  min_n?: number;
  cohort_id?: string;
};

/**
 * One sitting, exactly as `analysis/hero/sessions.py` sends it. Every number here is the
 * server's — `bb_per_100` included — and none of them is recomputed in the browser: two places
 * deriving the same winrate is two winrates, and the one on screen would be the wrong one.
 *
 * There is no id: a session is a *derived* grouping of hands split on a gap, not a stored row,
 * so `started_at` is the key. It changes when `gap_minutes` changes, which is correct — a
 * different gap is a different set of sessions.
 */
export interface Session {
  /** ClickHouse `DateTime`, serialized without an offset. Read as the site's own clock. */
  started_at: string;
  ended_at: string;
  minutes: number;
  hands: number;
  net_bb: number;
  ev_bb: number;
  bb_per_100: number;
  sites: string[];
  stakes: string[];
}

export interface SessionsResult {
  gap_minutes: number;
  hands: number;
  net_bb: number;
  /** Oldest first, as the server orders them. */
  sessions: Session[];
}

export type SessionsFilters = {
  date_from?: string;
  date_to?: string;
  /** Minutes of no play that end a session. The server's own default is 30; 1..1440. */
  gap_minutes?: number;
};

/**
 * One day of the winnings graph. **Already cumulative** — the server runs the running totals so
 * a reload and a re-read cannot disagree about them — so summing these again is nonsense.
 *
 * The four sums decompose exactly: `showdown + nonShowdown === net`, which is what makes the
 * pair worth drawing beside the total rather than instead of it.
 */
export interface WinningsPoint {
  /** `YYYY-MM-DD`. */
  day: string;
  hands: number;
  net: number;
  ev: number;
  showdown: number;
  nonShowdown: number;
}

export interface Winnings {
  points: WinningsPoint[];
  hands: number;
  /** The headline rates over the whole range, or `null` when no hands fall in it. */
  bbPer100: number | null;
  evBbPer100: number | null;
}

export type WinningsFilters = {
  date_from?: string;
  date_to?: string;
};

export interface HeroApi {
  leaks(filters?: LeaksFilters): Promise<LeaksResult>;
  sessions(filters?: SessionsFilters): Promise<SessionsResult>;
  winnings(filters?: WinningsFilters): Promise<Winnings>;
}

/** The wire shape of `GET /v1/stats/timeline`, kept private — see `winnings()`. */
interface TimelineResponse {
  points: {
    day: string;
    hands: number;
    cumulative_bb: number;
    cumulative_ev_bb: number;
    cumulative_showdown_bb: number;
    cumulative_nonshowdown_bb: number;
  }[];
  total_hands: number;
  bb_per_100: number | null;
  ev_bb_per_100: number | null;
}

function query(filters: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, String(value));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** Bind the hero endpoints to a fetcher (the auth store's, which adds the bearer header). */
export function createHeroApi(fetch: Fetcher): HeroApi {
  return {
    leaks: (filters = {}) => fetch<LeaksResult>(`/v1/hero/leaks${query(filters)}`),
    sessions: (filters = {}) => fetch<SessionsResult>(`/v1/hero/sessions${query(filters)}`),

    /**
     * The winnings series.
     *
     * **This is the one call in the hero client that does not go to `/v1/hero`, and that is a
     * recorded debt rather than an oversight.** There is no hero winnings route: the only time
     * series in the API is the v1 adapter `GET /v1/stats/timeline`, whose own module docstring
     * says it is "Deleted in plan D.9". `POST /v1/reports/run` cannot stand in — the registry
     * has no day dimension among its eighty, so a report cannot group by time at all.
     *
     * So the shape is translated here, at the boundary, into this module's own `WinningsPoint`:
     * every consumer above depends on the hero client and never on a condemned route's field
     * names, and D.9 changes this function body and nothing else. Plan D.9 carries the
     * obligation; see ADR-045.
     */
    winnings: async (filters = {}) => {
      const raw = await fetch<TimelineResponse>(`/v1/stats/timeline${query({ ...filters, dataset: 'hero' })}`);
      return {
        points: raw.points.map((point) => ({
          day: point.day,
          hands: point.hands,
          net: point.cumulative_bb,
          ev: point.cumulative_ev_bb,
          showdown: point.cumulative_showdown_bb,
          nonShowdown: point.cumulative_nonshowdown_bb,
        })),
        hands: raw.total_hands,
        bbPer100: raw.bb_per_100,
        evBbPer100: raw.ev_bb_per_100,
      };
    },
  };
}
