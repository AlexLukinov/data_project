/**
 * The situation filter on the hand list (plan F.7): four registry dimensions turned into the
 * filter tree `POST /v1/hands/search` takes (ADR-022).
 *
 * The vocabularies are the registry's own (`stats/registry/dimensions.yaml`), so a hand list
 * filter and a report filter are the same document — the workbench's situations will drop in
 * here unchanged when phase D builds it.
 */

import type { FilterNode, HandSearchBody } from './api';

export const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
export const FACING = ['none', 'limp', 'bet', 'raise', '3bet', '4bet', '5bet_plus'] as const;
export const ACTIONS = ['fold', 'check', 'call', 'bet', 'raise'] as const;
export const POSITIONS = ['UTG', 'UTG1', 'UTG2', 'MP', 'MP1', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;

export interface Situation {
  street?: string;
  position?: string;
  facing?: string;
  action?: string;
}

/** The words each choice reads as, in the order the sentence puts them. */
const PHRASE: [keyof Situation, string][] = [
  ['action', ''],
  ['street', 'on the '],
  ['position', 'from '],
  ['facing', 'facing '],
];

function chosen(situation: Situation): [keyof Situation, string][] {
  return PHRASE.map(([key]) => [key, situation[key] ?? ''] as [keyof Situation, string]).filter(([, value]) => value !== '');
}

/** The filter tree for a situation, or null when nothing is chosen (then the plain list is right). */
export function situationFilter(situation: Situation): FilterNode | null {
  const leaves = chosen(situation).map(([dim, value]) => ({ dim, op: 'eq', value }));
  return leaves.length === 0 ? null : { all: leaves };
}

/** `bet on the flop from BTN facing raise` — what the list says it is showing. */
export function situationLabel(situation: Situation): string {
  const words = new Map(PHRASE);
  const parts = chosen(situation).map(([key, value]) => `${words.get(key) ?? ''}${value.replace('_plus', '+')}`);
  return parts.length === 0 ? 'every hand' : parts.join(' ');
}

/** The search body for a situation on one dataset; no situation means no `filter` field at all. */
export function searchBody(situation: Situation, dataset: 'hero' | 'population', limit: number): HandSearchBody {
  const filter = situationFilter(situation);
  return { dataset, hero_only: dataset === 'hero', limit, ...(filter === null ? {} : { filter }) };
}
