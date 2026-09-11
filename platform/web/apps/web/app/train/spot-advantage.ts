/**
 * The range and nut advantage trainer (spec §16): "predict which side has each and the nut share
 * split".
 *
 * Two questions on one spot, so each is committed, scored and scheduled on its own — being right
 * about who is ahead on average while being wrong about who holds the nutted combos is the exact
 * mistake the mode exists to find. Range advantage buys frequency; nut advantage buys size.
 */
import type { EquityServiceLike } from '@poker/ui';
import type { WeightedEquities } from '@poker/core';
import { nutAdvantage, parseCards, parseRange, rangeAdvantage } from '@poker/core';

import { CHARTS, chartById } from './charts';
import { pct } from './numbers';
import { boardText, dealCards, pickOne, rngFor, spotKey } from './sampler';
import { textureTag } from './texture';
import type { AdvantageSpot, SpotAnswers } from './types';

const MODE = 'advantage';
const FLOP = 3;
const NUT_TOLERANCE_PP = 12;
const ITERATIONS = 120_000;

export const HERO = 'hero';
export const VILLAIN = 'villain';

function questions(): AdvantageSpot['questions'] {
  return [
    {
      key: 'side',
      question: 'Whose range is ahead here, by average equity?',
      answerType: 'choice',
      tolerance: 0,
      unit: '',
      choices: [HERO, VILLAIN],
      hint: 'Which range has more of the board in it — not which one has the single best hand.',
    },
    {
      key: 'nut',
      question: "What share of the nutted combos here is hero's?",
      answerType: 'percent',
      tolerance: NUT_TOLERANCE_PP,
      unit: '',
      choices: [],
      hint: 'The nutted combos are the top of both ranges pooled together, not the top of each.',
    },
  ];
}

/** Build the spot a seed names. */
export function generate(seed: number): AdvantageSpot {
  const rng = rngFor(seed);
  const hero = pickOne(rng, CHARTS);
  let villainId = pickOne(rng, CHARTS).id;
  while (villainId === hero.id) villainId = pickOne(rng, CHARTS).id;
  const villain = chartById(villainId);
  const board = dealCards(rng, FLOP);
  const text = boardText(board);
  return {
    mode: MODE,
    seed,
    hash: spotKey(MODE, [hero.text, villain.text, text]),
    label: `${hero.label} vs ${villain.label} · flop ${text}`,
    questions: questions(),
    bucket: textureTag(board),
    heroText: hero.text,
    villainText: villain.text,
    heroLabel: hero.label,
    villainLabel: villain.label,
    boardText: text,
  };
}

/** Both sides' per-combo equities — what every advantage figure is computed from. */
export async function sides(
  spot: AdvantageSpot,
  service: EquityServiceLike,
): Promise<{ hero: WeightedEquities; villain: WeightedEquities; exact: boolean }> {
  const hero = parseRange(spot.heroText).range;
  const villain = parseRange(spot.villainText).range;
  const result = await service.compute(
    { ranges: [hero, villain], board: parseCards(spot.boardText) },
    { seed: spot.seed, iterations: ITERATIONS },
    spot.hash,
  );
  return {
    hero: { equities: result.perComboEquity, weights: hero.weights },
    villain: { equities: result.perComboEquityVillain, weights: villain.weights },
    exact: result.exact,
  };
}

/** Who is ahead on average, and how the nutted combos split. */
export async function answers(
  spot: AdvantageSpot,
  service: EquityServiceLike,
): Promise<SpotAnswers> {
  const both = await sides(spot, service);
  const advantage = rangeAdvantage(both.hero, both.villain);
  const nut = nutAdvantage(both.hero, both.villain);
  return {
    side: advantage.difference >= 0 ? HERO : VILLAIN,
    nut: pct(nut.split.hero),
  };
}
