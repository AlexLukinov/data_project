/**
 * The spec's §5.3 targets, measured: flop exact ≤ 1.5 s, turn ≤ 100 ms, river ≤ 20 ms,
 * preflop Monte Carlo (100k) ≤ 500 ms. Run with `npm run bench`; record the numbers in the
 * plan's §6 when they change materially.
 */

import { parseCards } from '../src/cards';
import { computeEquity } from '../src/equity/index';
import type { EquityRequest } from '../src/equity/types';
import { fastEvaluator } from '../src/evaluator/fast';
import { parseRange } from '../src/formats/index';
import { fullRange, totalCombos } from '../src/range';

const HERO = '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,65s,A8o+,KTo+,QTo+,JTo';
const VILLAIN = '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,74s+,64s+,53s+,A2o+,K7o+,Q8o+,J8o+,T8o+,98o';

interface Case {
  readonly label: string;
  readonly request: EquityRequest;
  readonly targetMs: number;
  readonly iterations?: number;
}

const hero = parseRange(HERO).range;
const villain = parseRange(VILLAIN).range;
const cases: Case[] = [
  { label: `flop exact, ${totalCombos(hero)} vs ${totalCombos(villain)} combos`, request: { ranges: [hero, villain], board: parseCards('Kh 7d 2c') }, targetMs: 1500 },
  { label: 'flop exact, full vs full (worst case)', request: { ranges: [fullRange(), fullRange()], board: parseCards('Kh 7d 2c') }, targetMs: 1500 },
  { label: 'turn exact', request: { ranges: [hero, villain], board: parseCards('Kh 7d 2c 9s') }, targetMs: 100 },
  { label: 'river exact', request: { ranges: [hero, villain], board: parseCards('Kh 7d 2c 9s 3h') }, targetMs: 20 },
  { label: 'preflop Monte Carlo 100k', request: { ranges: [hero, villain], board: [] }, targetMs: 500, iterations: 100_000 },
  { label: 'flop Monte Carlo 50k (the fast first pass)', request: { ranges: [hero, villain], board: parseCards('Kh 7d 2c') }, targetMs: 500, iterations: 50_000 },
];

await fastEvaluator.ready();
for (const c of cases) {
  const options = c.iterations === undefined ? {} : { mode: 'monte-carlo' as const, iterations: c.iterations, seed: 1 };
  await computeEquity(c.request, options); // warm-up
  const start = performance.now();
  const result = await computeEquity(c.request, options);
  const ms = performance.now() - start;
  const verdict = ms <= c.targetMs ? 'ok' : 'MISSED';
  console.log(`${c.label.padEnd(52)} ${ms.toFixed(0).padStart(6)} ms  (target ${c.targetMs}) ${verdict}   hero ${(100 * result.heroEquity).toFixed(2)}%${result.confidence95 === undefined ? '' : ` ±${result.confidence95.toFixed(2)}`}`);
}
