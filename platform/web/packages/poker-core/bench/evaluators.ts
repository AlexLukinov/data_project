/**
 * How fast is rank7 through each evaluator? Run with `npm run bench:evaluators`.
 * The equity engine needs ~2.2M evaluations for an exact flop, so ns per call is the number.
 */

import { fastEvaluator } from '../src/evaluator/fast';
import { tsEvaluator } from '../src/evaluator/ts';
import type { HandEvaluator } from '../src/evaluator/types';
import { wasmEvaluator } from '../src/evaluator/wasm';
import { mulberry32 } from '../src/random';

const HANDS = 300_000;

function deal(random: () => number): Int32Array {
  const deck = new Int32Array(HANDS * 7);
  const hand: number[] = [];
  for (let i = 0; i < HANDS; i++) {
    hand.length = 0;
    while (hand.length < 7) {
      const card = Math.floor(random() * 52);
      if (!hand.includes(card)) hand.push(card);
    }
    deck.set(hand, i * 7);
  }
  return deck;
}

async function time(evaluator: HandEvaluator, deck: Int32Array): Promise<void> {
  await evaluator.ready();
  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < HANDS; i++) {
    const o = i * 7;
    checksum += evaluator.rank7(deck[o]!, deck[o + 1]!, deck[o + 2]!, deck[o + 3]!, deck[o + 4]!, deck[o + 5]!, deck[o + 6]!);
  }
  const ms = performance.now() - start;
  console.log(`${evaluator.name.padEnd(20)} ${((ms * 1e6) / HANDS).toFixed(0).padStart(6)} ns/call   (${HANDS.toLocaleString()} hands, checksum ${checksum})`);
}

const deck = deal(mulberry32(7));
for (const evaluator of [fastEvaluator, wasmEvaluator, tsEvaluator]) {
  await time(evaluator, deck);
  await time(evaluator, deck); // second pass, warmed up
}
