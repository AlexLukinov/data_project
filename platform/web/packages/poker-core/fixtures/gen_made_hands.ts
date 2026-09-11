/**
 * Generates `platform/tests/fixtures/made_hands.json` — the fixture that pins
 * `classifyMadeHand` (TypeScript, here) and `core.classify.made_hand_of` (Python) to the same
 * answers, the way `tests/fixtures/nodes.json` pins `NodeKey` (ADR-028, ADR-031).
 *
 * The expected classes are written by THIS implementation, deliberately: it shipped first in
 * F.1 and has its own unit tests, so it is the reference the parse-time port must match. Both
 * suites then assert against the committed file, so a change to either side breaks a test
 * rather than silently splitting the mart from the screen.
 *
 * The sample is a seeded walk over every board size, plus hand-picked spots for the classes a
 * random draw almost never produces (quads from a paired board, a board that already plays,
 * the river case where the hole cards improve the rank without changing the category).
 *
 *   node --experimental-strip-types ../../../node_modules/jiti/lib/jiti-cli.mjs gen_made_hands.ts
 *   (or: npx jiti gen_made_hands.ts — it writes the JSON itself and prints a count)
 */

import { writeFileSync } from 'node:fs';
import { parseCard } from '../src/cards';
import { classifyMadeHand } from '../src/classify';
import type { Card } from '../src/cards';

/** Mulberry32 — a tiny seeded PRNG, so the fixture is reproducible byte for byte. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
const DECK: string[] = [];
for (const r of RANKS) for (const s of SUITS) DECK.push(r + s);

interface Case {
  readonly hole: [string, string];
  readonly board: string[];
  readonly made: string;
  readonly note?: string;
}

const PICKED: ReadonlyArray<{ hole: [string, string]; board: string[]; note: string }> = [
  { hole: ['Ah', 'Ad'], board: ['Ac', 'As', '2d'], note: 'quads with a pocket pair' },
  { hole: ['Ah', 'Kd'], board: ['Ac', 'Ad', 'As'], note: 'quads on the board, kicker plays' },
  { hole: ['2h', '3d'], board: ['Ac', 'Ad', 'As', 'Ah', 'Kd'], note: 'board quads, hole cards dead' },
  { hole: ['Kh', 'Kd'], board: ['Ac', 'Ad', 'As', 'Ah', '2d'], note: 'board quads beat the pair' },
  { hole: ['9h', '8h'], board: ['7h', '6h', '5h'], note: 'straight flush' },
  { hole: ['Ah', '2h'], board: ['Kh', 'Qh', 'Jh'], note: 'flush, board is four to a flush? no' },
  { hole: ['2c', '3d'], board: ['Ah', 'Kh', 'Qh', 'Jh', 'Th'], note: 'board plays a royal' },
  { hole: ['Ah', '3d'], board: ['Kh', 'Qh', 'Jh', 'Th', '2c'], note: 'ace of the board flush' },
  { hole: ['9c', '8d'], board: ['7h', '6s', '5d'], note: 'straight using both cards' },
  { hole: ['2c', '3d'], board: ['7h', '6s', '5d', '4c', '8h'], note: 'board plays a straight' },
  { hole: ['Ah', 'Kh'], board: ['Ad', 'Kd', '2c'], note: 'two pair' },
  { hole: ['7h', '7d'], board: ['7c', '2d', '3s'], note: 'set' },
  { hole: ['Ah', '7d'], board: ['7c', '7s', '3s'], note: 'trips, board paired twice over' },
  { hole: ['Ah', 'Kd'], board: ['Ac', '7c', '2s'], note: 'top pair' },
  { hole: ['Ah', '7d'], board: ['Kc', '7c', '2s'], note: 'second pair' },
  { hole: ['Ah', '2d'], board: ['Kc', '7c', '2s'], note: 'third pair' },
  { hole: ['Ah', '2d'], board: ['Kc', '9c', '7s', '2h'], note: 'weak pair on four cards' },
  { hole: ['Ah', 'Ad'], board: ['Kc', '9c', '7s'], note: 'overpair' },
  { hole: ['2h', '2d'], board: ['Kc', '9c', '7s'], note: 'under pair' },
  { hole: ['Ah', '5d'], board: ['Kc', '9c', '7s'], note: 'ace high' },
  { hole: ['Kh', '5d'], board: ['Qc', '9c', '7s'], note: 'king high' },
  { hole: ['8h', '5d'], board: ['Qc', '9c', '7s'], note: 'no pair' },
  { hole: ['Ah', 'Kh'], board: ['Qh', 'Jh', '2h'], note: 'flush, hole cards improve it' },
  { hole: ['3h', '2h'], board: ['Ah', 'Kh', 'Qh'], note: 'flush that loses to the board alone' },
];

function toCards(names: readonly string[]): Card[] {
  return names.map((n) => parseCard(n));
}

function sample(seed: number, boardSize: number, count: number): Case[] {
  const next = rng(seed);
  const out: Case[] = [];
  while (out.length < count) {
    const drawn = new Set<number>();
    while (drawn.size < 2 + boardSize) drawn.add(Math.floor(next() * 52));
    const names = [...drawn].map((i) => DECK[i]!);
    const hole: [string, string] = [names[0]!, names[1]!];
    const board = names.slice(2);
    out.push({
      hole,
      board,
      made: classifyMadeHand(toCards(hole) as [Card, Card], toCards(board)),
    });
  }
  return out;
}

const cases: Case[] = [
  ...PICKED.map(({ hole, board, note }) => ({
    hole,
    board,
    note,
    made: classifyMadeHand(toCards(hole) as [Card, Card], toCards(board)),
  })),
  ...sample(1, 3, 400),
  ...sample(2, 4, 300),
  ...sample(3, 5, 300),
];

const classes = new Set(cases.map((c) => c.made));
const payload = {
  note:
    'Shared by the TypeScript suite (poker-core/test/classify.test.ts) and the Python suite ' +
    '(tests/test_classify.py). Generated by poker-core/fixtures/gen_made_hands.ts from ' +
    'classifyMadeHand, which is the reference implementation. Regenerate, never hand-edit.',
  cards: 'rank+suit, e.g. "Ac"; board is 3, 4 or 5 cards',
  cases,
};

const target = new URL('../../../../tests/fixtures/made_hands.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`${cases.length} cases, ${classes.size} distinct classes -> ${target.pathname}`);
console.log([...classes].sort().join(' '));
