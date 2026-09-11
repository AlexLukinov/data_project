/**
 * The equity trainer (spec §16), in the three tiers the spec asks for: your hand against a range,
 * two ranges preflop, then two ranges on a flop.
 *
 * Every spot carries a seed and the equity run is given that seed, because preflop and
 * hand-vs-range spots are Monte Carlo — without it the "correct answer" would drift by a tenth of
 * a point between two showings of what is supposed to be the same spot.
 */
import type { EquityServiceLike } from '@poker/ui';
import { comboToString, handClassName, handClassOf, parseCards, parseRange } from '@poker/core';

import { CHARTS, chartById } from './charts';
import { pct } from './numbers';
import { boardText, dealCards, pickCombo, pickOne, rngFor, spotKey } from './sampler';
import { textureTag } from './texture';
import type { EquitySpot, SpotAnswers } from './types';

const MODE = 'equity';
const TOLERANCE_PP = 3;
const FLOP = 3;
const ITERATIONS = 120_000;

const TIERS: readonly EquitySpot['tier'][] = ['hand', 'preflop', 'flop'];

/** Two different charts: a range against itself teaches nothing. */
function twoCharts(rng: () => number): [string, string] {
  const hero = pickOne(rng, CHARTS).id;
  let villain = pickOne(rng, CHARTS).id;
  while (villain === hero) villain = pickOne(rng, CHARTS).id;
  return [hero, villain];
}

function questionFor(heroLabel: string): EquitySpot['questions'] {
  return [
    {
      key: '',
      question: `What is ${heroLabel}'s equity here?`,
      answerType: 'percent',
      tolerance: TOLERANCE_PP,
      unit: '',
      choices: [],
      hint: 'Count how the ranges hit the board, not how your own hand feels.',
    },
  ];
}

/** Hero's hand against a range, preflop — the drill Equilab is bought for. */
function handSpot(seed: number, rng: () => number): EquitySpot {
  const [heroId, villainId] = twoCharts(rng);
  const combo = pickCombo(rng, parseRange(chartById(heroId).text).range);
  const hand = combo === null ? 'AhKd' : comboToString(combo);
  // The bucket is the hand *class*, so `/progress` can say "your suited aces are fine, your
  // offsuit broadways are not" rather than listing 1326 one-sample rows.
  const handClass = combo === null ? 'AKo' : handClassName(handClassOf(combo));
  const villain = chartById(villainId);
  return {
    mode: MODE,
    seed,
    tier: 'hand',
    hash: spotKey(MODE, ['hand', hand, villain.text]),
    label: `${hand} against ${villain.label}`,
    questions: questionFor(hand),
    bucket: handClass,
    heroText: hand,
    villainText: villain.text,
    heroLabel: hand,
    villainLabel: villain.label,
    boardText: '',
  };
}

/** Two ranges, with or without a flop between them. */
function rangeSpot(seed: number, rng: () => number, onFlop: boolean): EquitySpot {
  const [heroId, villainId] = twoCharts(rng);
  const hero = chartById(heroId);
  const villain = chartById(villainId);
  const board = onFlop ? dealCards(rng, FLOP) : [];
  const text = boardText(board);
  return {
    mode: MODE,
    seed,
    tier: onFlop ? 'flop' : 'preflop',
    hash: spotKey(MODE, [onFlop ? 'flop' : 'preflop', hero.text, villain.text, text]),
    label: onFlop ? `${hero.label} vs ${villain.label}` : `${hero.label} vs ${villain.label} · preflop`,
    questions: questionFor(hero.position),
    bucket: textureTag(board),
    heroText: hero.text,
    villainText: villain.text,
    heroLabel: hero.label,
    villainLabel: villain.label,
    boardText: text,
  };
}

/** Build the spot a seed names. */
export function generate(seed: number): EquitySpot {
  const rng = rngFor(seed);
  const tier = pickOne(rng, TIERS);
  if (tier === 'hand') return handSpot(seed, rng);
  return rangeSpot(seed, rng, tier === 'flop');
}

/**
 * Hero's equity, to a tenth of a point.
 *
 * Two ranges on a board are enumerated exactly; everything else is Monte Carlo at the spot's own
 * seed, so the same spot always has the same answer.
 */
export async function answers(spot: EquitySpot, service: EquityServiceLike): Promise<SpotAnswers> {
  const result = await service.compute(
    {
      ranges: [parseRange(spot.heroText).range, parseRange(spot.villainText).range],
      board: spot.boardText === '' ? [] : parseCards(spot.boardText),
    },
    { seed: spot.seed, iterations: ITERATIONS },
    spot.hash,
  );
  return { '': pct(result.heroEquity) };
}
