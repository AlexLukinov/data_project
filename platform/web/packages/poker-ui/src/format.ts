/** Small display helpers shared by the components. */

import type { Card } from '@poker/core';
import { RANK_CHARS, rankOf, suitOf } from '@poker/core';

export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const;
export const SUIT_NAMES = ['club', 'diamond', 'heart', 'spade'] as const;

/** `A♠` for display; `As` stays the text form. */
export function cardLabel(card: Card): string {
  return `${RANK_CHARS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
}

export function suitName(card: Card): (typeof SUIT_NAMES)[number] {
  return SUIT_NAMES[suitOf(card)]!;
}

/** `56.0%`, or `—` for NaN. */
export function percent(value: number, digits = 1): string {
  return Number.isFinite(value) ? `${(100 * value).toFixed(digits)}%` : '—';
}

/** `12.5` with trailing zeros trimmed, or `—`. */
export function num(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return Number(value.toFixed(digits)).toString();
}
