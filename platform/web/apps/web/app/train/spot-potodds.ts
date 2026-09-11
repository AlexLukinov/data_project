/**
 * The pot odds and MDF trainer (spec §16): "quick-fire pot/bet → MDF, alpha, required equity,
 * bluff breakeven, raw and rake-adjusted".
 *
 * Alpha and the bluff break-even are deliberately both in the rotation even though they are the
 * same number — `bet / (pot + bet)`. Being asked for them in two different sentences is how that
 * stops being a coincidence you re-derive every time, and the reveal says so outright.
 */
import { NO_RAKE, potOdds } from '@poker/core';

import { dp, pct } from './numbers';
import { pickOne, rngFor, spotKey } from './sampler';
import type { PotOddsSpot, SpotAnswers, TrainQuestion } from './types';

const MODE = 'potodds';
const TOLERANCE_PP = 3;
const PLACES = 1;

/** GG's micro-stakes rake, the one the founder actually plays against. */
const RAKE = { rakePct: 0.05, rakeCapBB: 3 };
const RAKE_CHANCE = 0.34;

const POTS_BB = [3, 4.5, 6, 7.5, 9, 12, 15, 18, 22, 30];

/** Bet sizes as a share of the pot, with the name the size goes by. */
const SIZES = [
  { fraction: 0.25, name: 'quarter pot' },
  { fraction: 0.33, name: 'third pot' },
  { fraction: 0.5, name: 'half pot' },
  { fraction: 0.66, name: 'two-thirds pot' },
  { fraction: 0.75, name: 'three-quarter pot' },
  { fraction: 1, name: 'pot' },
  { fraction: 1.5, name: 'overbet' },
];

type Ask = PotOddsSpot['ask'];

const ASKS: readonly { ask: Ask; question: string; hint: string }[] = [
  {
    ask: 'mdf',
    question: 'What is the minimum defence frequency against this bet?',
    hint: 'The share you must continue with so a bluff of this size makes nothing.',
  },
  {
    ask: 'alpha',
    question: 'What is alpha here — the share of the range that is allowed to fold?',
    hint: 'MDF and alpha add up to the whole range.',
  },
  {
    ask: 'requiredEquity',
    question: 'You are facing this bet. What equity does a call need to break even?',
    hint: 'You are paying the bet to win the pot and the bet.',
  },
  {
    ask: 'bluffBreakeven',
    question: 'How often does a bluff of this size need to work to break even?',
    hint: 'You risk the bet to win the pot as it stands.',
  },
];

function questionOf(ask: (typeof ASKS)[number], afterRake: boolean): TrainQuestion {
  const tail = afterRake ? ' (after 5% rake, capped at 3bb)' : '';
  return {
    key: '',
    question: `${ask.question.replace(/\?$/, '')}${tail}?`,
    answerType: 'percent',
    tolerance: TOLERANCE_PP,
    unit: '',
    choices: [],
    hint: ask.hint,
  };
}

/** Build the spot a seed names. Same seed, same question, for ever. */
export function generate(seed: number): PotOddsSpot {
  const rng = rngFor(seed);
  const potBB = pickOne(rng, POTS_BB);
  const size = pickOne(rng, SIZES);
  const ask = pickOne(rng, ASKS);
  const afterRake = rng() < RAKE_CHANCE;
  const betBB = Number((potBB * size.fraction).toFixed(PLACES));
  const rake = afterRake ? RAKE : NO_RAKE;
  return {
    mode: MODE,
    seed,
    hash: spotKey(MODE, [String(potBB), String(betBB), ask.ask, String(afterRake)]),
    label: `${dp(potBB)}bb pot · ${dp(betBB)}bb bet · ${size.name}${afterRake ? ' · after rake' : ''}`,
    questions: [questionOf(ask, afterRake)],
    bucket: size.name,
    ask: ask.ask,
    potBB,
    betBB,
    rakePct: rake.rakePct,
    rakeCapBB: rake.rakeCapBB,
    afterRake,
  };
}

/** The exact answer, from `@poker/core`'s own formulas — nothing is restated here. */
export function answers(spot: PotOddsSpot): SpotAnswers {
  const both = potOdds(spot.potBB, spot.betBB, spot.betBB, {
    rakePct: spot.rakePct,
    rakeCapBB: spot.rakeCapBB,
  });
  const figures = spot.afterRake ? both.rakeAdjusted : both.raw;
  return { '': pct(figures[spot.ask]) };
}
