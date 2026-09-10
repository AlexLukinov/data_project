/**
 * The API's `HandDetail` as `poker-core` wants it (plan F.7).
 *
 * One conversion, at the edge: a stored hand, a pool hand and a pasted one all arrive in this
 * shape, so nothing downstream — the replayer, the node derivation, the panels — knows which
 * of the three it is looking at (ADR-029).
 */

import type { ActionKind, ReplayAction, ReplayHand, ReplaySeat } from '@poker/core';
import { ACTION_KINDS } from '@poker/core';

import type { HandAction, HandDetail, HandPlayer } from './api';

/** An action kind the model does not know is a parser change, not a hand to guess at. */
function kindOf(action: HandAction): ActionKind {
  if ((ACTION_KINDS as readonly string[]).includes(action.action_type)) return action.action_type as ActionKind;
  throw new Error(`unknown action type "${action.action_type}" at index ${action.action_index}`);
}

function cardsOf(text: string): string[] {
  return text.split(/\s+/).filter((c) => c !== '');
}

function seatOf(player: HandPlayer): ReplaySeat {
  return {
    seat: player.seat,
    name: player.screen_name,
    position: player.position,
    isHero: player.is_hero,
    isAnonymous: player.is_anonymized,
    stack: player.starting_stack,
    cards: cardsOf(player.hole_cards),
    wonHand: player.won_hand,
    netWon: player.net_won,
  };
}

function actionOf(action: HandAction): ReplayAction {
  return {
    index: action.action_index,
    street: action.street as ReplayAction['street'],
    seat: action.seat,
    kind: kindOf(action),
    amount: action.amount,
    amountTo: action.amount_to,
    potBefore: action.pot_before,
    isAllIn: action.is_allin,
  };
}

export function toReplayHand(detail: HandDetail): ReplayHand {
  return {
    handUid: detail.hand_uid,
    site: detail.site,
    siteHandId: detail.site_hand_id,
    playedAt: detail.played_at_utc,
    stake: detail.stake_level,
    bigBlind: detail.big_blind,
    board: [...detail.board],
    totalPot: detail.total_pot,
    rake: detail.rake,
    seats: detail.players.map(seatOf),
    actions: detail.actions.map(actionOf),
  };
}

/** Hero's seat, or the seat the list said to watch when the hand has no hero (a pool hand). */
export function seatToWatch(hand: ReplayHand, fallback: number | null): number | null {
  return hand.seats.find((s) => s.isHero)?.seat ?? fallback ?? hand.seats[0]?.seat ?? null;
}
