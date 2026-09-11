/**
 * The replayer transport (plan F.7): the four ways a hand reaches the app — my hands, a
 * situation search, the pool, and pasted text — plus the single-hand fetch behind all of them.
 * Field names are the API's (snake_case), exactly as `api/schemas.py` sends them.
 */

import type { Fetcher } from '../auth/api';
import type { FilterNode } from '../stats/api';

export type Dataset = 'hero' | 'population';

export interface HandSummary {
  hand_uid: string;
  site: string;
  played_at_utc: string;
  stake_level: string;
  /** The seat this row is about: hero's, or the one whose decision matched the search. */
  seat: number;
  position: string;
  hole_cards: string;
  board: string;
  net_won_bb: number;
  went_to_showdown: boolean;
}

export interface HandPlayer {
  seat: number;
  screen_name: string;
  position: string;
  is_hero: boolean;
  is_anonymized: boolean;
  starting_stack: number;
  hole_cards: string;
  net_won: number;
  net_won_bb: number;
  went_to_showdown: boolean;
  won_hand: boolean;
}

export interface HandAction {
  action_index: number;
  street: string;
  seat: number;
  action_type: string;
  amount: number;
  amount_to: number;
  pot_before: number;
  to_call: number;
  is_allin: boolean;
}

export interface HandDetail {
  hand_uid: string;
  site: string;
  site_hand_id: string;
  played_at_utc: string;
  game_type: string;
  stake_level: string;
  big_blind: number;
  board: string[];
  total_pot: number;
  rake: number;
  players: HandPlayer[];
  actions: HandAction[];
}

/** The filter tree of `stats/ast.py`, shared with the reports engine (`~/stats/api`). */
export type { FilterNode };

export interface HandSearchBody {
  dataset?: Dataset;
  hero_only?: boolean;
  date_from?: string;
  date_to?: string;
  player_key?: string;
  filter?: FilterNode;
  limit?: number;
}

export interface RecentFilters {
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export interface PoolFilters extends RecentFilters {
  stake_level?: string;
}

export interface HandsApi {
  recent(filters?: RecentFilters): Promise<HandSummary[]>;
  search(body: HandSearchBody): Promise<HandSummary[]>;
  pool(filters?: PoolFilters): Promise<HandSummary[]>;
  get(handUid: string): Promise<HandDetail>;
  /** Parse pasted text. Nothing is stored (ADR-029). */
  parse(text: string, site?: string): Promise<HandDetail>;
}

function query(filters: RecentFilters | PoolFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, String(value));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** Bind the hand endpoints to a fetcher (the auth store's, which adds the bearer header). */
export function createHandsApi(fetch: Fetcher): HandsApi {
  return {
    recent: (filters = {}) => fetch<HandSummary[]>(`/v1/hands${query(filters)}`),
    search: (body) => fetch<HandSummary[]>('/v1/hands/search', { method: 'POST', body: { ...body } }),
    pool: (filters = {}) => fetch<HandSummary[]>(`/v1/pool/hands${query(filters)}`),
    get: (handUid) => fetch<HandDetail>(`/v1/hands/${handUid}`),
    parse: (text, site) => fetch<HandDetail>('/v1/hands/parse', { method: 'POST', body: site === undefined ? { text } : { text, site } }),
  };
}
