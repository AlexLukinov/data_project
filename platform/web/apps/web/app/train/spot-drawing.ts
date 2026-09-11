/**
 * The range-drawing trainer (spec §16): "draw a node's range from memory; scored against a
 * reference with total absolute weight error plus a per-cell mistake heatmap".
 *
 * **Two numbers are on screen and they measure different things.** The prediction gate compares
 * how *wide* the range you drew is against how wide the chart is — a real prediction, committed
 * before you see the answer. The mode's own verdict, and the one the review schedule believes, is
 * the spec's: the total absolute weight error between the two ranges. You can draw a range of
 * exactly the right width out of entirely the wrong hands, and the screen says so rather than
 * calling it a pass.
 */
import type { WeightedRange } from '@poker/core';
import { COMBO_COUNT, diff, parseRange, weightedCombos } from '@poker/core';

import { CHARTS, chartById } from './charts';
import { dp } from './numbers';
import { pickOne, rngFor, spotKey } from './sampler';
import type { DrawingSpot, SpotAnswers } from './types';

const MODE = 'drawing';
/** Combos of width a commit may be out by and still count as a good guess at the size. */
const WIDTH_TOLERANCE = 14;
/** Share of the chart's own weight allowed as total absolute error before it counts as a miss. */
const ERROR_SHARE = 0.15;
const MIN_ERROR_TOLERANCE = 12;

/** Build the spot a seed names. */
export function generate(seed: number): DrawingSpot {
  const rng = rngFor(seed);
  const chart = pickOne(rng, CHARTS);
  const combos = weightedCombos(parseRange(chart.text).range);
  return {
    mode: MODE,
    seed,
    hash: spotKey(MODE, [chart.id]),
    label: chart.label,
    questions: [
      {
        key: '',
        question: `Draw ${chart.label} from memory. How many combos have you drawn?`,
        answerType: 'number',
        tolerance: WIDTH_TOLERANCE,
        unit: 'combos',
        choices: [],
        hint: `All ${COMBO_COUNT} combos would be every hand; a tight open is nearer two hundred.`,
      },
    ],
    bucket: chart.position,
    chartId: chart.id,
    chartLabel: chart.label,
    referenceText: chart.text,
    weightTolerance: Math.max(MIN_ERROR_TOLERANCE, Math.round(combos * ERROR_SHARE)),
  };
}

/** How wide the chart actually is — what the gate compares the committed width against. */
export function answers(spot: DrawingSpot): SpotAnswers {
  return { '': dp(weightedCombos(parseRange(spot.referenceText).range)) };
}

/** The reference range itself, for the diff view and the reveal. */
export function reference(spot: DrawingSpot): WeightedRange {
  return parseRange(chartById(spot.chartId).text).range;
}

/**
 * How far a drawing is from the chart: the spec's total absolute weight error, in combos.
 *
 * A combo drawn at full weight that is not in the chart costs 1, and so does a combo in the chart
 * left out — so drawing the right number of the wrong hands scores twice, which is the point.
 */
export function weightError(drawn: WeightedRange, spot: DrawingSpot): number {
  return diff(drawn, reference(spot)).totalAbsolute;
}
