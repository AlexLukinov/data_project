/**
 * The blocker trainer (spec §16): "given hero's range, villain's calling range and a size, pick
 * the best bluff candidate; scored against `bluffScore` ranking".
 *
 * Villain's range is split into the part that continues and the part that folds by **made-hand
 * class on the board**, not by equity. That keeps the whole mode offline (spec §17) — no equity
 * run, no Worker, no backend — and it is also how a player actually reads a flop: top pair and
 * better calls, the rest gives up. The screen says which rule was used, because a continuing
 * range is an assumption and every number downstream of it inherits that.
 */
import type { Card, ComboIndex, WeightedRange } from '@poker/core';
import {
  MADE_HAND_CLASSES,
  blockerTable,
  classifyCombos,
  comboToString,
  combosIn,
  filterByPredicate,
  isRealDraw,
  parseCards,
  parseCombo,
  parseRange,
  removeCards,
} from '@poker/core';

import { chartById } from './charts';
import { boardText, dealCards, pickOne, rngFor, spotKey } from './sampler';
import { textureTag } from './texture';
import type { BlockersSpot, SpotAnswers } from './types';

const MODE = 'blockers';
const FLOP = 3;
const CANDIDATES = 4;
const POTS_BB = [6, 9, 12, 16, 22];
const SIZES = [0.33, 0.5, 0.66, 1];
const PLACES = 1;

/** The rule the split uses, printed on screen so the assumption is never invisible. */
export const CONTINUE_RULE =
  'Villain continues with top pair or better and with any real draw, and folds the rest — a rule of thumb, not a solve.';

const CONTINUING = new Set(MADE_HAND_CLASSES.slice(0, MADE_HAND_CLASSES.indexOf('top_pair') + 1));

/** Whether a combo continues against a bet on this board, by the rule above. */
function continues(classes: ReturnType<typeof classifyCombos>, combo: ComboIndex): boolean {
  const found = classes[combo];
  if (found === undefined) return false;
  return CONTINUING.has(found.made) || found.draws.some(isRealDraw);
}

/** Villain's range split in two: what calls, and what folds. */
export function split(villain: WeightedRange, board: readonly Card[]): {
  call: WeightedRange;
  fold: WeightedRange;
} {
  const live = removeCards(villain, board);
  const classes = classifyCombos(live, board);
  return {
    call: filterByPredicate(live, (combo) => continues(classes, combo)),
    fold: filterByPredicate(live, (combo) => !continues(classes, combo)),
  };
}

/** Hero's combos that are not value bets — the pool a bluff is chosen from. */
function bluffPool(hero: WeightedRange, board: readonly Card[]): ComboIndex[] {
  const live = removeCards(hero, board);
  const classes = classifyCombos(live, board);
  return combosIn(live).filter((combo) => {
    const found = classes[combo];
    return found !== undefined && !CONTINUING.has(found.made);
  });
}

/** Four candidates, spread across the pool so the answer is not the only plausible one. */
function candidatesFrom(pool: readonly ComboIndex[], rng: () => number): ComboIndex[] {
  if (pool.length <= CANDIDATES) return [...pool];
  const picked = new Set<ComboIndex>();
  while (picked.size < CANDIDATES) picked.add(pickOne(rng, pool));
  return [...picked].sort((a, b) => a - b);
}

/** Build the spot a seed names; retries the board until hero has four non-value combos on it. */
export function generate(seed: number): BlockersSpot {
  const rng = rngFor(seed);
  const heroChart = pickOne(rng, [chartById('co_rfi'), chartById('btn_rfi'), chartById('hj_rfi')]);
  // Always the big blind's defending range: hero opened, the blind called, and this is the flop.
  const villainChart = chartById('bb_call_vs_btn');
  const hero = parseRange(heroChart.text).range;
  const board = dealCards(rng, FLOP);
  const potBB = pickOne(rng, POTS_BB);
  const betBB = Number((potBB * pickOne(rng, SIZES)).toFixed(PLACES));
  const text = boardText(board);
  const candidates = candidatesFrom(bluffPool(hero, board), rng).map(comboToString);
  return {
    mode: MODE,
    seed,
    hash: spotKey(MODE, [heroChart.id, villainChart.id, text, String(betBB), ...candidates]),
    label: `${heroChart.position} bets ${betBB}bb into ${potBB} on ${text}`,
    questions: [
      {
        key: '',
        question: 'Which of these is the best bluff?',
        answerType: 'choice',
        tolerance: 0,
        unit: '',
        choices: candidates,
        hint: 'A good bluff blocks the hands that call and leaves the hands that fold untouched.',
      },
    ],
    bucket: textureTag(board),
    heroText: heroChart.text,
    villainText: villainChart.text,
    villainLabel: villainChart.label,
    boardText: text,
    potBB,
    betBB,
    candidates,
  };
}

/** The blocker table for this spot — the reveal panel and the answer read the same one. */
export function tableFor(spot: BlockersSpot): ReturnType<typeof blockerTable> {
  const board = parseCards(spot.boardText);
  const parts = split(parseRange(spot.villainText).range, board);
  return blockerTable(parseRange(spot.heroText).range, parts.call, parts.fold, board);
}

/** The candidate with the highest `bluffScore` — `@poker/core`'s own ranking, not a restatement. */
export function answers(spot: BlockersSpot): SpotAnswers {
  const table = tableFor(spot);
  let best = spot.candidates[0] ?? '';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const text of spot.candidates) {
    const row = table.byCombo.get(parseCombo(text));
    if (row !== undefined && row.bluffScore > bestScore) {
      bestScore = row.bluffScore;
      best = text;
    }
  }
  return { '': best };
}
