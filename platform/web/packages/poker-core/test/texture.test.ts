/**
 * The board fixture both suites parse (plan H.3): the Python side runs the same boards through
 * the dbt macros the marts are built from, so a board this file classifies differently from
 * `tests/fixtures/board_texture.json` is a board the replayer would key differently from the
 * pool.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CardError, parseCards } from '../src/cards';
import { FLOP_CONNECTIVITY, FLOP_HIGH_CARD_CLASS, FLOP_PAIRING, FLOP_SUITEDNESS, RIVER_CHANGE, TURN_CHANGE, flopTexture, riverChange, textureTags, turnChange } from '../src/texture';

interface Fixture {
  dimensions: string[];
  precedence: Record<string, string[]>;
  boards: { board: string[]; tags: string[]; why: string }[];
}

const FIXTURE: Fixture = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/board_texture.json', import.meta.url), 'utf8'));

const VALUES_OF: Readonly<Record<string, readonly string[]>> = {
  flop_suitedness: FLOP_SUITEDNESS,
  flop_pairing: FLOP_PAIRING,
  flop_connectivity: FLOP_CONNECTIVITY,
  flop_high_card_class: FLOP_HIGH_CARD_CLASS,
  turn_change: TURN_CHANGE,
  river_change: RIVER_CHANGE,
};

describe('textureTags against the shared fixture', () => {
  it.each(FIXTURE.boards.map((c) => [c.board.join(' ') || '(no board)', c] as const))('%s', (_name, c) => {
    expect(textureTags(c.board), c.why).toEqual(c.tags);
  });

  it('emits one value of each dimension, in the order the fixture lists them', () => {
    expect(FIXTURE.dimensions).toEqual(Object.keys(VALUES_OF));
    for (const c of FIXTURE.boards) {
      c.tags.forEach((tag, i) => {
        expect(VALUES_OF[FIXTURE.dimensions[i]!], `${c.board.join(' ')}: ${tag}`).toContain(tag);
      });
    }
  });

  it('covers every value of every dimension, so a truncated fixture cannot pass silently', () => {
    const seen = new Set(FIXTURE.boards.flatMap((c) => c.tags));
    for (const [dim, values] of Object.entries(VALUES_OF)) {
      for (const value of values) expect(seen.has(value), `${dim}: no fixture board is tagged ${value}`).toBe(true);
    }
  });

  it('lists the precedence the fixture records, in the same order', () => {
    expect(FIXTURE.precedence.turn_change).toEqual([...TURN_CHANGE]);
    expect(FIXTURE.precedence.river_change).toEqual([...RIVER_CHANGE]);
  });

  it('never reuses a value across two dimensions', () => {
    const all = Object.values(VALUES_OF).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('textureTags refuses a board that is not a board', () => {
  it('rejects one, two or six cards', () => {
    expect(() => textureTags(['Ah'])).toThrow(CardError);
    expect(() => textureTags(['Ah', 'Kh'])).toThrow(CardError);
    expect(() => textureTags(['Ah', 'Kh', '7d', '7h', 'Ac', '2c'])).toThrow(CardError);
  });

  it('rejects a card dealt twice, a card that is not one, and an element that is not one card', () => {
    expect(() => textureTags(['Ah', 'Kh', 'Ah'])).toThrow(CardError);
    expect(() => textureTags(['Ah', 'Kh', '10h'])).toThrow(CardError);
    expect(() => textureTags(['Ah', 'Kh', ''])).toThrow(CardError);
    expect(() => textureTags(['AhKh', '7d', '2c'])).toThrow(CardError);
  });

  it('reads either case, as the parsers spell cards both ways', () => {
    expect(textureTags(['qh', '7H', '2s'])).toEqual(textureTags(['Qh', '7h', '2s']));
  });
});

describe('the typed pieces', () => {
  it('classifies a flop from card ids', () => {
    expect(flopTexture(parseCards('9c 7h 7d'))).toEqual({ suitedness: 'rainbow', pairing: 'paired', connectivity: 'oesd', highCardClass: 'middle' });
  });

  it('needs exactly the cards of the street before', () => {
    expect(() => flopTexture(parseCards('9c 7h'))).toThrow(CardError);
    expect(() => turnChange(parseCards('9c 7h 7d 8s'), parseCards('2c')[0]!)).toThrow(CardError);
    expect(() => riverChange(parseCards('9c 7h 7d'), parseCards('2c')[0]!)).toThrow(CardError);
  });
});
