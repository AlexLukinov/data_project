/**
 * The WASM evaluator and the pure-TS evaluator must agree on every rank, not only on the order
 * (spec §5.1). 100,000 random 7-card hands from a seeded generator, so a failure reproduces.
 */

import { describe, expect, it } from 'vitest';

import { parseCards } from '../src/cards';
import { tsEvaluator } from '../src/evaluator/ts';
import { wasmEvaluator } from '../src/evaluator/wasm';

const HANDS = 100_000;

/** Small deterministic PRNG (mulberry32) so the fixture is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dealSeven(random: () => number, out: number[]): void {
  out.length = 0;
  while (out.length < 7) {
    const card = Math.floor(random() * 52);
    if (!out.includes(card)) out.push(card);
  }
}

describe('WASM and TypeScript evaluators agree', () => {
  it('on the corner hands', async () => {
    await wasmEvaluator.ready();
    for (const text of ['As Ks Qs Js Ts 2c 3d', '7c 5d 4h 3s 2c 8d 9h', 'Ac Ad Ah As Kc 2d 3h', '5h 4h 3h 2h Ah Kc Kd']) {
      const [a, b, c, d, e, f, g] = parseCards(text);
      const ts = tsEvaluator.rank7(a!, b!, c!, d!, e!, f!, g!);
      const wasm = wasmEvaluator.rank7(a!, b!, c!, d!, e!, f!, g!);
      expect(wasm, text).toBe(ts);
    }
  });

  it(`on ${HANDS.toLocaleString()} random seven-card hands`, async () => {
    await wasmEvaluator.ready();
    const random = mulberry32(20260910);
    const hand: number[] = [];
    let mismatches = 0;
    let firstMismatch = '';
    for (let i = 0; i < HANDS; i++) {
      dealSeven(random, hand);
      const [a, b, c, d, e, f, g] = hand;
      const ts = tsEvaluator.rank7(a!, b!, c!, d!, e!, f!, g!);
      const wasm = wasmEvaluator.rank7(a!, b!, c!, d!, e!, f!, g!);
      if (ts !== wasm) {
        mismatches++;
        if (firstMismatch === '') firstMismatch = `cards ${hand.join(' ')}: ts ${ts}, wasm ${wasm}`;
      }
    }
    expect(mismatches, firstMismatch).toBe(0);
  });
});
