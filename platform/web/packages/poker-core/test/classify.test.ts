import { describe, expect, it } from 'vitest';

import { parseCards } from '../src/cards';
import { classifyDraws, classifyHand, classifyMadeHand } from '../src/classify';

const made = (hole: string, board: string): string => {
  const [a, b] = parseCards(hole);
  return classifyMadeHand([a!, b!], parseCards(board));
};
const draws = (hole: string, board: string): readonly string[] => {
  const [a, b] = parseCards(hole);
  return classifyHand([a!, b!], parseCards(board)).draws;
};

describe('made-hand classes are relative to the board', () => {
  it('names the big categories when the hole cards make them', () => {
    expect(made('Ah Kh', 'Qh Jh Th')).toBe('straight_flush');
    expect(made('Ac Ad', 'Ah As 2c')).toBe('quads');
    expect(made('Ac Ad', 'Ah Kc Kd')).toBe('full_house');
    expect(made('Kc Kd', 'Kh 2c 2d')).toBe('full_house');
    expect(made('Ah 2h', 'Kh 9h 4h')).toBe('flush');
    expect(made('9c 8d', '7h 6s 5c')).toBe('straight');
    expect(made('Ac 5d', '4h 3s 2c')).toBe('straight');
  });

  it('separates sets from trips and two pair from board pairs', () => {
    expect(made('7c 7d', '7h Kc 2d')).toBe('set');
    expect(made('Kh 7d', '7h 7c 2d')).toBe('trips');
    expect(made('Kh 7d', 'Kc 7h 2d')).toBe('two_pair');
    expect(made('Ah Qd', 'Kc Kh 2d')).toBe('ace_high'); // the board's pair is not ours
    expect(made('Ah Qd', 'Kc Kh Qc')).toBe('second_pair'); // our queen pairs the second card
  });

  it('places pairs by which board card they hit', () => {
    expect(made('Ah Kd', 'Kc 9h 2d')).toBe('top_pair');
    expect(made('Ah 9d', 'Kc 9h 2d')).toBe('second_pair');
    expect(made('Ah 2d', 'Kc 9h 2d')).toBe('third_pair');
    expect(made('Ah 2d', 'Kc 9h 5d 2c')).toBe('weak_pair');
    expect(made('Ah Ad', 'Kc 9h 2d')).toBe('overpair');
    expect(made('Qh Qd', 'Kc 9h 2d')).toBe('under_pair');
    expect(made('3h 3d', 'Kc 9h 2d')).toBe('under_pair');
    expect(made('Ah Ad', 'Kc Kh 2d')).toBe('overpair'); // pocket pair over a paired board
    expect(made('Qh Qd', 'Kc Kh 2d')).toBe('under_pair');
  });

  it('falls back to ace-high, king-high, nothing', () => {
    expect(made('Ah Qd', 'Kc 9h 2d')).toBe('ace_high');
    expect(made('Kh Qd', 'Jc 9h 2d')).toBe('king_high');
    expect(made('Qh Jd', 'Kc 9h 2d')).toBe('no_pair');
    expect(made('Qh Jd', 'Kc Kh 9h 9d 2s')).toBe('no_pair'); // playing the board's two pair
  });

  it('counts a board straight or flush only when the hole cards improve it', () => {
    expect(made('2c 3d', '9h 8s 7c 6d 5c')).toBe('no_pair'); // board straight, we play the board
    expect(made('Tc 3d', '9h 8s 7c 6d 5c')).toBe('straight'); // our ten makes a higher straight
    expect(made('2c 3d', 'Ah Kh 9h 7h 4h')).toBe('no_pair'); // board flush
    expect(made('Qh 3d', 'Ah Kh 9h 7h 4h')).toBe('flush'); // our queen improves the flush
  });

  it('rejects a board that is not 3 to 5 cards', () => {
    expect(() => made('Ah Kd', 'Kc 9h')).toThrow(/3 to 5 cards/);
  });
});

describe('draw classes', () => {
  it('sees flush draws and backdoor flush draws only with a hole card involved', () => {
    expect(draws('Ah 2h', 'Kh 9h 4c')).toContain('flush_draw');
    expect(draws('Ah 2c', 'Kh 9h 4c')).toContain('backdoor_flush_draw');
    expect(draws('Ac 2c', 'Kh 9h 4h')).not.toContain('flush_draw'); // three hearts are the board's
    expect(draws('Ah 2c', 'Kh 9h 4h')).toContain('flush_draw');
    expect(draws('Ah 2c', 'Kh 9h 4c 3d')).not.toContain('backdoor_flush_draw'); // no backdoors on the turn
  });

  it('sees open-ended draws, gutshots and backdoor straight draws', () => {
    expect(draws('9c 8d', '7h 6s 2c')).toContain('open_ended_straight_draw');
    expect(draws('9c 8d', '7h 5s 2c')).toContain('gutshot');
    expect(draws('9c 8d', '6h 2s 2c')).toContain('backdoor_straight_draw');
    expect(draws('Jc Td', '9h 7s 2c')).toContain('gutshot');
    expect(draws('Tc 9d', 'Qh 8h 6c')).toContain('open_ended_straight_draw'); // double gutter (J or 7) counts as open-ended: 8 outs
    expect(draws('Jc 8d', 'Qh Th 6c')).toContain('gutshot'); // only a 9 fills it
    expect(draws('Ac Kd', '9h 5s 2c')).toEqual(['backdoor_straight_draw']); // the ace, 5 and 2 want a 3 and a 4
    expect(draws('Kc 8d', '3h 5s 2c')).toEqual(['no_draw']); // the board's own wheel draw is not ours
  });

  it('does not credit a draw the board makes by itself', () => {
    expect(draws('Ac 2d', '9h 8s 7c 6d')).not.toContain('open_ended_straight_draw');
  });

  it('combines a pair with a draw, or two draws, into a combo draw', () => {
    expect(draws('9h 8h', '9c 7h 2h')).toEqual(expect.arrayContaining(['flush_draw', 'combo_draw']));
    expect(draws('9h 8h', '7h 6c 2h')).toEqual(expect.arrayContaining(['flush_draw', 'open_ended_straight_draw', 'combo_draw']));
    expect(draws('Ah 2h', 'Kh 9h 4c')).not.toContain('combo_draw');
  });

  it('has no draws on the river and none once the hand is a flush', () => {
    expect(draws('9c 8d', '7h 6s 2c 3d Ks')).toEqual(['no_draw']);
    const [a, b] = parseCards('Ah 2h');
    expect(classifyDraws([a!, b!], parseCards('Kh 9h 4h'), 'flush')).not.toContain('flush_draw');
  });
});
