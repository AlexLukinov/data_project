/**
 * How the registry's dimensions are grouped for a person choosing a situation (plan D.3).
 *
 * The registry (`stats/registry/dimensions.yaml`) is a flat list of 79 columns in table order,
 * which is the right shape for a compiler and the wrong one for a player: nobody looks for
 * "the third `decisions`-only bool". These families are the order a hand is actually thought
 * about — where am I playing, where do I sit, what happened preflop, how far did it get, what
 * is in front of me now, what is on the board, how big, how deep, what do I hold.
 *
 * The grouping lives here and not in the registry because it is a presentation choice, and the
 * registry is the column contract three other consumers (dbt, the compiler, `/v1/definitions`)
 * are built to. `families.test.ts` reads the YAML and fails if a dimension is not classified,
 * so the registry growing a column is a red test here rather than a column nobody can reach.
 */

import type { Dimension } from './api';

export interface Family {
  name: string;
  /** One line saying what this group of dimensions is, shown under the heading. */
  hint: string;
  codes: readonly string[];
}

export const FAMILIES: readonly Family[] = [
  {
    name: 'Table',
    hint: 'Where and what you are playing. None of it changes within a hand.',
    codes: ['site', 'stake_level', 'game_type', 'table_format', 'players_dealt_in', 'big_blind'],
  },
  {
    name: 'Seat',
    hint: 'Where you sit and when you act.',
    codes: ['position', 'is_ip', 'is_first_to_act', 'is_last_to_act', 'players_live', 'players_acted_before'],
  },
  {
    name: 'Preflop',
    hint: 'What happened before the flop, and so what kind of pot this is.',
    codes: [
      'pot_type', 'opener_position', 'am_preflop_opener', 'am_preflop_aggressor', 'preflop_line',
      'n_raises_preflop', 'n_limpers', 'n_cold_callers', 'did_vpip', 'did_pfr',
    ],
  },
  {
    name: 'Street',
    hint: 'How far the hand got, and where in it this decision is.',
    codes: ['street', 'saw_flop', 'saw_turn', 'saw_river', 'saw_next_street', 'players_to_flop', 'decision_idx'],
  },
  {
    name: 'Facing',
    hint: 'The action in front of you on this street, and the line that led into it.',
    codes: [
      'facing', 'facing_is_cbet', 'prev_street_faced', 'last_raiser_position', 'street_line',
      'prev_street_my_action', 'line_so_far', 'am_prev_street_aggressor', 'n_bets_street',
      'n_raises_street', 'n_callers_before',
    ],
  },
  {
    name: 'Board',
    hint: 'The cards on the table, as of this street.',
    codes: [
      'flop_suitedness', 'flop_pairing', 'flop_high_card', 'flop_connectedness', 'flop_span',
      'turn_rank', 'turn_completes_flush', 'turn_pairs_board',
      'river_rank', 'river_completes_flush', 'river_pairs_board',
      'board_paired', 'board_flush_possible', 'board_straight_possible',
      'board_paired_final', 'board_flush_possible_final',
    ],
  },
  {
    name: 'Sizing',
    hint: 'How big the bets are — theirs and yours.',
    codes: ['facing_size_pct', 'size_pct', 'raise_to_bb', 'amount_bb', 'to_call_bb', 'pot_before_bb', 'invested_bb'],
  },
  {
    name: 'Stacks',
    hint: 'How deep you are, and how deep relative to the pot.',
    codes: ['eff_stack_bb', 'stack_bb', 'spr'],
  },
  {
    name: 'Holding',
    hint: "What you hold. '' means the cards were never shown — most of the pool.",
    codes: ['hand_class', 'hand_shape', 'made_hand', 'hole_cards'],
  },
  {
    name: 'Action',
    hint: 'What the seat actually did. Filtering on it answers "how often", not "what happens then".',
    codes: ['action', 'is_allin'],
  },
  {
    name: 'Outcome',
    hint: 'Results — the future relative to any decision. Filtering on these leaks it backwards.',
    codes: [
      'went_to_showdown', 'won_hand', 'net_won_bb', 'ev_won_bb',
      'showdown_won_bb', 'nonshowdown_won_bb', 'rake_paid_bb',
    ],
  },
  {
    name: 'Player',
    hint: 'A named seat in the pool. On the rollup only.',
    codes: ['player_key'],
  },
];

const FAMILY_OF: ReadonlyMap<string, string> = new Map(
  FAMILIES.flatMap((family) => family.codes.map((code) => [code, family.name] as const)),
);

/** Every code this file classifies — what the coverage test compares the registry against. */
export const CLASSIFIED_CODES: readonly string[] = [...FAMILY_OF.keys()];

/** The family a dimension belongs to, or `null` for one the registry has grown since. */
export function familyOf(code: string): string | null {
  return FAMILY_OF.get(code) ?? null;
}

export interface GroupedDimensions {
  name: string;
  hint: string;
  dimensions: Dimension[];
}

/**
 * The dimensions the server served, in family order, with unclassified ones gathered under
 * "Other" so a registry addition is reachable from the builder on the day it ships — visibly
 * unsorted rather than silently missing.
 */
export function groupByFamily(dimensions: readonly Dimension[]): GroupedDimensions[] {
  const buckets = new Map<string, Dimension[]>(FAMILIES.map((f) => [f.name, []]));
  const other: Dimension[] = [];
  for (const dim of dimensions) {
    const family = familyOf(dim.code);
    if (family === null) other.push(dim);
    else buckets.get(family)!.push(dim);
  }
  const groups = FAMILIES.filter((f) => buckets.get(f.name)!.length > 0).map((f) => ({
    name: f.name,
    hint: f.hint,
    dimensions: order(buckets.get(f.name)!, f.codes),
  }));
  if (other.length > 0) groups.push({ name: 'Other', hint: 'Newer columns, not yet grouped.', dimensions: other });
  return groups;
}

/** Registry order is table order; inside a family the order above is the one a player reads in. */
function order(dimensions: Dimension[], codes: readonly string[]): Dimension[] {
  return [...dimensions].sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code));
}
