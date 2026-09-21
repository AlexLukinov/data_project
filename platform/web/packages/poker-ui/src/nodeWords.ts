/**
 * The situation shorthand explained piece by piece (ADR-056): `BB call vs CO 2.5bb · 40bb · NL5`
 * cut into the words it is made of, each with its row from `vocabulary.ts`.
 *
 * The text of every piece is sliced out of `nodeKeyLabel`'s own output rather than rebuilt, so
 * the pieces joined are the label exactly and the rules that choose the words — RFI against iso
 * against 3-bet, which seat is the villain, which size it faced — stay in `@poker/core` alone.
 * Only the tail (street, stack, stake) is written from the key, and it is checked against the
 * label before anything is cut.
 */

import type { NodeKey } from '@poker/core';
import { NODE_ACTIONS, nodeKeyLabel } from '@poker/core';

import type { TermEntry } from './glossary';
import type { NodeWord } from './vocabulary';
import { NODE_WORDS, POSITION_WORDS, isPosition } from './vocabulary';

/** One piece of the label: its text as printed (separators included) and the row that explains it. */
export interface NodeLabelPart {
  readonly text: string;
  readonly entry: TermEntry;
}

/** What the shorthand as a whole is: the entry a `NodeLabel`'s trigger carries. */
export const NODE_SHORTHAND: TermEntry = {
  term: 'Situation shorthand',
  definition: 'Hero’s seat and action, the seat hero is up against with the size it faced, then the street, the effective stack and the stake.',
};

const SEPARATOR = ' · ';
const VS = ' vs ';
const RAISE_WORDS: Readonly<Record<string, NodeWord>> = { RFI: 'rfi', iso: 'iso', '3-bet': 'threeBet', '4-bet': 'fourBet', '5-bet': 'fiveBet', 'to act': 'toAct' };
const MORE_BETS = /^\d+-bet$/;
const LEADING = /^[\s·]+/;

/** The row for hero's verb as `nodeKeyLabel` prints it; a word it does not know fails loudly. */
function verbEntry(verb: string): TermEntry {
  const word = RAISE_WORDS[verb];
  if (word !== undefined) return NODE_WORDS[word];
  if (MORE_BETS.test(verb)) return NODE_WORDS.moreBets;
  const action = NODE_ACTIONS.find((a) => NODE_WORDS[a].term === verb);
  if (action === undefined) throw new Error(`nodeLabelParts: no vocabulary row for the verb "${verb}"`);
  return NODE_WORDS[action];
}

function seatEntry(seat: string): TermEntry {
  if (!isPosition(seat)) throw new Error(`nodeLabelParts: "${seat}" is not a seat`);
  return POSITION_WORDS[seat];
}

/** `CO 2.5bb` after the `vs`: the seat, and the size it faced when there is one. */
function facedParts(faced: string): NodeLabelPart[] {
  const space = faced.indexOf(' ');
  if (space === -1) return [{ text: faced, entry: seatEntry(faced) }];
  const size = faced.slice(space);
  return [
    { text: faced.slice(0, space), entry: seatEntry(faced.slice(0, space)) },
    { text: size, entry: size.endsWith('%') ? NODE_WORDS.betPct : NODE_WORDS.raiseTo },
  ];
}

/** `BB call vs CO 2.5bb`: hero's seat, the verb, and what hero is up against. */
function headParts(key: NodeKey, head: string): NodeLabelPart[] {
  const rest = head.slice(key.hero_position.length);
  const at = rest.indexOf(VS);
  const verb = at === -1 ? rest : rest.slice(0, at);
  const parts: NodeLabelPart[] = [
    // Through `seatEntry`, not the table directly: a key carrying a seat the vocabulary does not
    // know is a shape this file cannot explain, and it has to say so rather than hand back a row
    // that is `undefined` and only breaks where it is rendered.
    { text: key.hero_position, entry: seatEntry(key.hero_position) },
    { text: verb, entry: verbEntry(verb.trim()) },
  ];
  if (at === -1) return parts;
  return [...parts, { text: VS, entry: NODE_WORDS.vs }, ...facedParts(rest.slice(at + VS.length))];
}

/** ` · flop · 40bb · NL5`: written from the key, in the order `nodeKeyLabel` appends them. */
function tailParts(key: NodeKey): NodeLabelPart[] {
  const parts: NodeLabelPart[] = [];
  if (key.street !== 'preflop') parts.push({ text: `${SEPARATOR}${key.street}`, entry: NODE_WORDS.street });
  parts.push({ text: `${SEPARATOR}${key.eff_stack_bb}bb`, entry: NODE_WORDS.stack });
  if (key.stake !== '') parts.push({ text: `${SEPARATOR}${key.stake}`, entry: NODE_WORDS.stake });
  return parts;
}

/** `nodeKeyLabel(key)` as pieces whose texts, joined, are that label exactly. */
export function nodeLabelParts(key: NodeKey): NodeLabelPart[] {
  const label = nodeKeyLabel(key);
  const tail = tailParts(key);
  const tailText = tail.map((part) => part.text).join('');
  if (!label.endsWith(tailText) || !label.startsWith(key.hero_position)) throw new Error(`nodeLabelParts: "${label}" is not shaped as the shorthand expects`);
  return [...headParts(key, label.slice(0, label.length - tailText.length)), ...tail];
}

/** A piece's word without the separator in front of it: `· 40bb` reads as `40bb`. */
export function partWord(part: NodeLabelPart): string {
  return part.text.replace(LEADING, '').trim();
}
