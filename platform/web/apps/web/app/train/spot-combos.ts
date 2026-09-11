/**
 * The combo-counting trainer (spec §16): "how many combos of X does this range contain?",
 * including the card-removal variants.
 *
 * Two questions in rotation. The `class` one counts a single hand class — 6 pair combos, 4
 * suited, 12 offsuit, fewer once the board has taken cards away, which is the arithmetic every
 * other number in the app is built on. The `made` one counts a class and everything better on the
 * flop, which is the same skill at the scale you actually need it.
 */
import type { Card, WeightedRange } from '@poker/core';
import {
  HAND_CLASS_COMBOS,
  MADE_HAND_CLASSES,
  classifyCombos,
  combosIn,
  handClassName,
  handClassOf,
  handClassOfName,
  parseCards,
  parseRange,
  removeCards,
} from '@poker/core';

import { CHARTS } from './charts';
import { dp } from './numbers';
import { boardText, dealCards, pickOne, rngFor, spotKey } from './sampler';
import { textureTag } from './texture';
import type { CombosSpot, SpotAnswers } from './types';

const MODE = 'combos';
const FLOP = 3;
const CLASS_TOLERANCE = 0;
const MADE_TOLERANCE = 6;
const BOARD_CHANCE = 0.7;

/** The made-hand classes worth asking "this or better" about on a flop. */
const THRESHOLDS: readonly string[] = ['top_pair', 'two_pair', 'set', 'straight'];

const NAMES: Readonly<Record<string, string>> = {
  top_pair: 'top pair',
  two_pair: 'two pair',
  set: 'a set',
  straight: 'a straight',
};

/** Everything at or above `threshold` in `MADE_HAND_CLASSES`, which runs strongest first. */
function atLeast(threshold: string): ReadonlySet<string> {
  const cut = MADE_HAND_CLASSES.indexOf(threshold as (typeof MADE_HAND_CLASSES)[number]);
  return new Set(MADE_HAND_CLASSES.slice(0, cut + 1));
}

/** Weighted combos of `range` that make `threshold` or better on `board`. */
function madeCombos(range: WeightedRange, board: readonly Card[], threshold: string): number {
  const wanted = atLeast(threshold);
  const classes = classifyCombos(range, board);
  let total = 0;
  for (const combo of combosIn(range)) {
    const found = classes[combo];
    if (found !== undefined && wanted.has(found.made)) total += range.weights[combo]!;
  }
  return total;
}

/** Weighted combos of one hand class left in `range` once `board` has removed what it removes. */
function classCombos(range: WeightedRange, board: readonly Card[], className: string): number {
  const live = removeCards(range, board);
  let total = 0;
  for (const combo of HAND_CLASS_COMBOS[handClassOfName(className)]!) total += live.weights[combo]!;
  return total;
}

function classSpot(seed: number, rng: () => number): CombosSpot {
  const chart = pickOne(rng, CHARTS);
  const range = parseRange(chart.text).range;
  const combo = pickOne(rng, combosIn(range));
  const target = handClassName(handClassOf(combo));
  const board = rng() < BOARD_CHANCE ? dealCards(rng, FLOP) : [];
  const text = boardText(board);
  const where = text === '' ? '' : ' once this flop is out';
  return {
    mode: MODE,
    seed,
    hash: spotKey(MODE, ['class', chart.id, target, text]),
    label: `${chart.label}${text === '' ? '' : ` · flop ${text}`}`,
    questions: [
      {
        key: '',
        question: `How many combos of ${target} does this range hold${where}?`,
        answerType: 'number',
        tolerance: CLASS_TOLERANCE,
        unit: 'combos',
        choices: [],
        hint: 'Six of a pair, four suited, twelve offsuit — then take out every combo the board blocks.',
      },
    ],
    bucket: target,
    ask: 'class',
    target,
    rangeText: chart.text,
    rangeLabel: chart.label,
    boardText: text,
  };
}

function madeSpot(seed: number, rng: () => number): CombosSpot {
  const chart = pickOne(rng, CHARTS);
  const threshold = pickOne(rng, THRESHOLDS);
  const board = dealCards(rng, FLOP);
  const text = boardText(board);
  return {
    mode: MODE,
    seed,
    hash: spotKey(MODE, ['made', chart.id, threshold, text]),
    label: `${chart.label} · flop ${text}`,
    questions: [
      {
        key: '',
        question: `How many combos of this range make ${NAMES[threshold]} or better on this flop?`,
        answerType: 'number',
        tolerance: MADE_TOLERANCE,
        unit: 'combos',
        choices: [],
        hint: 'Most ranges miss most flops. Count the classes rather than guessing at a feeling.',
      },
    ],
    bucket: textureTag(board),
    ask: 'made',
    target: threshold,
    rangeText: chart.text,
    rangeLabel: chart.label,
    boardText: text,
  };
}

/** Build the spot a seed names. */
export function generate(seed: number): CombosSpot {
  const rng = rngFor(seed);
  return rng() < 0.5 ? classSpot(seed, rng) : madeSpot(seed, rng);
}

/** The exact count. */
export function answers(spot: CombosSpot): SpotAnswers {
  const range = parseRange(spot.rangeText).range;
  const board = spot.boardText === '' ? [] : parseCards(spot.boardText);
  const total =
    spot.ask === 'class'
      ? classCombos(range, board, spot.target)
      : madeCombos(range, board, spot.target);
  return { '': dp(total) };
}
