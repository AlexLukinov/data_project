/**
 * The table-driven evaluator must reproduce the reference rank for every hand, and the WASM
 * build must agree with both. 200,000 seeded random 7-card hands plus the corners.
 */

import { describe, expect, it } from 'vitest';

import { parseCards } from '../src/cards';
import { fastEvaluator, fastTables } from '../src/evaluator/fast';
import { tsEvaluator } from '../src/evaluator/ts';
import { WORST_RANK } from '../src/evaluator/types';
import { wasmEvaluator } from '../src/evaluator/wasm';
import { mulberry32 } from '../src/random';

const HANDS = 200_000;

function dealSeven(random: () => number, out: number[]): void {
  out.length = 0;
  while (out.length < 7) {
    const card = Math.floor(random() * 52);
    if (!out.includes(card)) out.push(card);
  }
}

describe('table-driven evaluator', () => {
  it('builds tables of the expected shape', async () => {
    await fastEvaluator.ready();
    const t = fastTables();
    expect(t.noFlush).toHaveLength(49_205);
    expect(t.flush).toHaveLength(8192);
    let flushEntries = 0;
    for (const v of t.flush) if (v !== 0) flushEntries++;
    expect(flushEntries).toBe(1287 + 1716 + 1716); // 5-, 6- and 7-card rank sets in one suit
    let min = WORST_RANK;
    let max = 0;
    for (const v of t.noFlush) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBe(11); // AAAA K x x is the best hand without a flush
    // Seven distinct ranks keep their best five, so the worst seven-card hand is 9-8-7-5-4 high.
    const [a, b, c, d, e, f, g] = parseCards('9c 8d 7h 5s 4c 3d 2c');
    expect(max).toBe(tsEvaluator.rank7(a!, b!, c!, d!, e!, f!, g!));
    expect(max).toBeLessThan(WORST_RANK);
  });

  it('matches the reference on the corners', () => {
    for (const text of ['As Ks Qs Js Ts 2c 3d', '7c 5d 4h 3s 2c 8d 9h', 'Ac Ad Ah As Kc 2d 3h', '5h 4h 3h 2h Ah Kc Kd', 'Ah Kh Qh Jh 2h 2c 2d', 'Ac Ad Kc Kd Qh Qs 2c']) {
      const [a, b, c, d, e, f, g] = parseCards(text);
      expect(fastEvaluator.rank7(a!, b!, c!, d!, e!, f!, g!), text).toBe(tsEvaluator.rank7(a!, b!, c!, d!, e!, f!, g!));
    }
  });

  it(`matches the reference and the WASM build on ${HANDS.toLocaleString()} random hands`, async () => {
    await wasmEvaluator.ready();
    const random = mulberry32(19);
    const hand: number[] = [];
    let mismatches = 0;
    let first = '';
    for (let i = 0; i < HANDS; i++) {
      dealSeven(random, hand);
      const [a, b, c, d, e, f, g] = hand;
      const fast = fastEvaluator.rank7(a!, b!, c!, d!, e!, f!, g!);
      const reference = tsEvaluator.rank7(a!, b!, c!, d!, e!, f!, g!);
      const wasm = wasmEvaluator.rank7(a!, b!, c!, d!, e!, f!, g!);
      if (fast !== reference || fast !== wasm) {
        mismatches++;
        if (first === '') first = `cards ${hand.join(' ')}: fast ${fast}, reference ${reference}, wasm ${wasm}`;
      }
    }
    expect(mismatches, first).toBe(0);
  });
});
