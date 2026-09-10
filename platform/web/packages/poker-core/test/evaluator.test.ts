import { describe, expect, it } from 'vitest';

import { parseCards } from '../src/cards';
import { evaluateCards, tsEvaluator } from '../src/evaluator/ts';
import { CATEGORY_NAMES, Category, RANK_BASE, WORST_RANK, categoryOfRank } from '../src/evaluator/types';

const rank = (text: string): number => evaluateCards(parseCards(text));
const cat = (text: string): string => CATEGORY_NAMES[categoryOfRank(rank(text))]!;

describe('pure-TS evaluator: known ranks', () => {
  it('pins the corners of the Cactus Kev scale', () => {
    expect(rank('As Ks Qs Js Ts')).toBe(1); // royal flush
    expect(rank('5h 4h 3h 2h Ah')).toBe(10); // wheel straight flush
    expect(rank('Ac Ad Ah As Kc')).toBe(11); // best quads
    expect(rank('2c 2d 2h 2s 3c')).toBe(166); // worst quads
    expect(rank('Ac Ad Ah Kc Kd')).toBe(167); // best full house
    expect(rank('2c 2d 2h 3c 3d')).toBe(322); // worst full house
    expect(rank('Ah Kh Qh Jh 9h')).toBe(323); // best flush
    expect(rank('7c 5c 4c 3c 2c')).toBe(1599); // worst flush
    expect(rank('Ac Kd Qh Js Tc')).toBe(1600); // broadway
    expect(rank('5c 4d 3h 2s Ac')).toBe(1609); // wheel
    expect(rank('Ac Ad Ah Kc Qd')).toBe(1610); // best trips
    expect(rank('2c 2d 2h 4c 3d')).toBe(2467); // worst trips
    expect(rank('Ac Ad Kc Kd Qh')).toBe(2468); // best two pair
    expect(rank('3c 3d 2c 2d 4h')).toBe(3325); // worst two pair
    expect(rank('Ac Ad Kc Qd Jh')).toBe(3326); // best pair
    expect(rank('2c 2d 5c 4d 3h')).toBe(6185); // worst pair
    expect(rank('Ac Kd Qh Js 9c')).toBe(6186); // best high card
    expect(rank('7c 5d 4h 3s 2c')).toBe(WORST_RANK);
  });

  it('orders within a category by the defining ranks', () => {
    expect(rank('Kc Kd Kh Ks Ac')).toBeLessThan(rank('Kc Kd Kh Ks Qc'));
    expect(rank('Ac Ad Ah Kc Qd')).toBeLessThan(rank('Ac Ad Ah Kc Jd'));
    expect(rank('Ac Ad Kc Qd Jh')).toBeLessThan(rank('Ac Ad Kc Qd Th'));
    expect(rank('Ac Ad 3c 2d 4h')).toBeLessThan(rank('Kc Kd Qc Jd Th')); // aces beat kings regardless of kickers
    expect(rank('Ah Kh Qh Jh 9h')).toBeLessThan(rank('Ah Kh Qh Th 9h'));
  });

  it('names categories', () => {
    expect(cat('As Ks Qs Js Ts')).toBe('straight flush');
    expect(cat('Ac Ad Ah As Kc')).toBe('four of a kind');
    expect(cat('Ac Ad Ah Kc Kd')).toBe('full house');
    expect(cat('Ah Kh Qh Jh 9h')).toBe('flush');
    expect(cat('Ac Kd Qh Js Tc')).toBe('straight');
    expect(cat('Ac Ad Ah Kc Qd')).toBe('three of a kind');
    expect(cat('Ac Ad Kc Kd Qh')).toBe('two pair');
    expect(cat('Ac Ad Kc Qd Jh')).toBe('pair');
    expect(cat('Ac Kd Qh Js 9c')).toBe('high card');
    expect(categoryOfRank(RANK_BASE.pair)).toBe(Category.Pair);
  });

  it('finds the best five of six or seven cards', () => {
    expect(rank('As Ks Qs Js Ts 2c 3d')).toBe(1);
    expect(rank('Ac Ad Ah Kc Kd 2s 3s')).toBe(rank('Ac Ad Ah Kc Kd'));
    // a full house beats a flush even when both are present
    expect(cat('Ah Kh Qh 2h 2c 2d Kd')).toBe('full house');
    // two trips make a full house with the higher trips
    expect(rank('Ac Ad Ah Kc Kd Kh 2s')).toBe(rank('Ac Ad Ah Kc Kd'));
    // three pairs: the highest two, kicker is the third pair's rank
    expect(rank('Ac Ad Kc Kd Qh Qs 2c')).toBe(rank('Ac Ad Kc Kd Qh'));
    // seven-card straight picks the highest
    expect(rank('9c 8d 7h 6s 5c 4d 3h')).toBe(rank('9c 8d 7h 6s 5c'));
    // a flush inside seven cards picks its five highest
    expect(rank('Ah Kh 9h 7h 2h Qc Jc')).toBe(rank('Ah Kh 9h 7h 2h'));
    expect(rank('Ah Kh 9h 7h 2h 3h 4h')).toBe(rank('Ah Kh 9h 7h 4h'));
  });

  it('refuses the wrong number of cards', () => {
    expect(() => rank('As Ks')).toThrow(/5 to 7 cards/);
  });

  it('is a HandEvaluator', async () => {
    await tsEvaluator.ready();
    const [a, b, c, d, e, f, g] = parseCards('As Ks Qs Js Ts 2c 3d');
    expect(tsEvaluator.rank7(a!, b!, c!, d!, e!, f!, g!)).toBe(1);
    expect(tsEvaluator.name).toBe('typescript');
  });
});

describe('pure-TS evaluator: exhaustive consistency', () => {
  it('assigns each of the 7462 ranks to at least one five-card hand', () => {
    const seen = new Uint8Array(WORST_RANK + 1);
    const cards = [0, 0, 0, 0, 0];
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++) {
              cards[0] = a;
              cards[1] = b;
              cards[2] = c;
              cards[3] = d;
              cards[4] = e;
              seen[evaluateCards(cards)] = 1;
            }
    let distinct = 0;
    for (let r = 1; r <= WORST_RANK; r++) distinct += seen[r]!;
    expect(seen[0]).toBe(0);
    expect(distinct).toBe(WORST_RANK);
  });
});
