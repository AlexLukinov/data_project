import { describe, expect, it } from 'vitest';

import {
  CardError,
  COMBO_COUNT,
  COMBOS_WITH_CARD,
  HAND_CLASS_COMBOS,
  HAND_CLASS_COUNT,
  cardToString,
  comboCards,
  comboHasCard,
  comboIndex,
  comboToString,
  combosShareCard,
  handClassName,
  handClassOf,
  handClassOfName,
  isPairClass,
  isSuitedClass,
  makeCard,
  parseCard,
  parseCards,
  parseCombo,
  rankOf,
  suitOf,
} from '../src/cards';

describe('cards', () => {
  it('encodes rank * 4 + suit with 2c = 0 and As = 51', () => {
    expect(parseCard('2c')).toBe(0);
    expect(parseCard('2d')).toBe(1);
    expect(parseCard('As')).toBe(51);
    expect(parseCard('Ah')).toBe(50);
    expect(makeCard(12, 3)).toBe(51);
    expect(rankOf(parseCard('Td'))).toBe(8);
    expect(suitOf(parseCard('Td'))).toBe(1);
  });

  it('accepts either case and prints uppercase rank, lowercase suit', () => {
    expect(cardToString(parseCard('as'))).toBe('As');
    expect(cardToString(parseCard('TC'))).toBe('Tc');
    expect(cardToString(parseCard('kD'))).toBe('Kd');
  });

  it('rejects things that are not cards, naming the problem', () => {
    expect(() => parseCard('1s')).toThrow(CardError);
    expect(() => parseCard('Ax')).toThrow(/suit must be one of cdhs/);
    expect(() => parseCard('10s')).toThrow(/rank and a suit/);
    expect(() => parseCards('As Ad As')).toThrow(/twice/);
    expect(() => parseCards('AsK')).toThrow(/list of cards/);
  });

  it('parses card lists with spaces, commas or nothing between them', () => {
    expect(parseCards('As Kd 7h')).toEqual([51, 45, 22]);
    expect(parseCards('As,Kd,7h')).toEqual([51, 45, 22]);
    expect(parseCards('AsKd7h')).toEqual([51, 45, 22]);
  });
});

describe('combos', () => {
  it('maps every pair of distinct cards to a unique index and back', () => {
    const seen = new Set<number>();
    for (let a = 0; a < 52; a++) {
      for (let b = a + 1; b < 52; b++) {
        const index = comboIndex(a, b);
        expect(index).toBe(comboIndex(b, a));
        expect(seen.has(index)).toBe(false);
        seen.add(index);
        expect(comboCards(index)).toEqual([b, a]);
      }
    }
    expect(seen.size).toBe(COMBO_COUNT);
    expect(Math.max(...seen)).toBe(COMBO_COUNT - 1);
  });

  it('uses the spec formula b(b-1)/2 + a', () => {
    expect(comboIndex(0, 1)).toBe(0);
    expect(comboIndex(0, 2)).toBe(1);
    expect(comboIndex(1, 2)).toBe(2);
    expect(comboIndex(50, 51)).toBe(1325);
  });

  it('spells combos canonically: higher rank first, equal ranks higher suit first', () => {
    expect(comboToString(comboIndex(parseCard('2c'), parseCard('2d')))).toBe('2d2c');
    expect(comboToString(comboIndex(parseCard('3h'), parseCard('3s')))).toBe('3s3h');
    expect(comboToString(comboIndex(parseCard('Kh'), parseCard('As')))).toBe('AsKh');
    expect(comboToString(comboIndex(parseCard('9d'), parseCard('Tc')))).toBe('Tc9d');
    expect(comboToString(0)).toBe('2d2c');
    expect(comboToString(1325)).toBe('AsAh');
  });

  it('parses a combo in any order and case, refusing a repeated card', () => {
    expect(parseCombo('khas')).toBe(comboIndex(parseCard('As'), parseCard('Kh')));
    expect(() => parseCombo('AsAs')).toThrow(CardError);
    expect(() => parseCombo('As')).toThrow(/exactly two cards/);
  });

  it('knows which cards a combo holds and which combos collide', () => {
    const asKh = parseCombo('AsKh');
    expect(comboHasCard(asKh, parseCard('As'))).toBe(true);
    expect(comboHasCard(asKh, parseCard('Kd'))).toBe(false);
    expect(combosShareCard(asKh, parseCombo('KhQd'))).toBe(true);
    expect(combosShareCard(asKh, parseCombo('AdKd'))).toBe(false);
    for (let card = 0; card < 52; card++) expect(COMBOS_WITH_CARD[card]).toHaveLength(51);
  });
});

describe('hand classes', () => {
  it('has 169 classes holding 6, 4 or 12 combos each, 1326 in all', () => {
    let total = 0;
    for (let cls = 0; cls < HAND_CLASS_COUNT; cls++) {
      const n = HAND_CLASS_COMBOS[cls]!.length;
      expect([4, 6, 12]).toContain(n);
      if (isPairClass(cls)) expect(n).toBe(6);
      else if (isSuitedClass(cls)) expect(n).toBe(4);
      else expect(n).toBe(12);
      total += n;
    }
    expect(total).toBe(COMBO_COUNT);
  });

  it('places the ace top-left, pairs on the diagonal, suited above it', () => {
    expect(handClassOf(parseCombo('AsAh'))).toBe(0);
    expect(handClassName(0)).toBe('AA');
    expect(handClassName(handClassOf(parseCombo('AsKs')))).toBe('AKs');
    expect(handClassName(handClassOf(parseCombo('AsKh')))).toBe('AKo');
    expect(handClassName(handClassOf(parseCombo('2c2d')))).toBe('22');
    expect(handClassOf(parseCombo('2c2d'))).toBe(168);
    expect(handClassOf(parseCombo('AsKs'))).toBe(1);
    expect(handClassOf(parseCombo('AsKh'))).toBe(13);
  });

  it('round-trips class names', () => {
    for (let cls = 0; cls < HAND_CLASS_COUNT; cls++) {
      expect(handClassOfName(handClassName(cls))).toBe(cls);
    }
    expect(handClassOfName('kqs')).toBe(handClassOfName('KQs'));
    expect(handClassOfName('KQs')).toBe(handClassOfName('QKs'));
    expect(() => handClassOfName('AK')).toThrow(/needs a suffix/);
    expect(() => handClassOfName('AAs')).toThrow(/pair has no/);
    expect(() => handClassOfName('AX')).toThrow(CardError);
  });
});
