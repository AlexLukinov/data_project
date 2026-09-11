/**
 * What a training spot is (spec §16), as data.
 *
 * Every spot is generated from a seed and is therefore reproducible: the same seed always builds
 * the same question with the same answer, which is what makes spaced repetition possible at all —
 * a missed spot is re-served by regenerating it, not by storing a copy of it.
 *
 * Ranges and boards travel as text rather than as `WeightedRange`/`Card[]` so a spot is plain
 * JSON: it goes into IndexedDB and comes back out unchanged, and its hash is stable.
 */
import type { AnswerType } from '@poker/ui';

export type TrainMode = 'equity' | 'combos' | 'drawing' | 'blockers' | 'advantage' | 'potodds';

/**
 * One thing a spot makes you commit to before it shows you anything.
 *
 * Most spots ask one question and leave `key` empty. The nut/range-advantage spot asks two, so
 * each carries its own key and is scored, stored and scheduled as its own row.
 */
export interface TrainQuestion {
  readonly key: string;
  readonly question: string;
  readonly answerType: AnswerType;
  /** In the answer's own unit — percentage points, combos, a ratio. */
  readonly tolerance: number;
  readonly unit: string;
  readonly choices: readonly string[];
  /** What to think about. Never a hint at the answer itself. */
  readonly hint: string;
}

interface SpotBase {
  readonly seed: number;
  /** Stable content hash, `mode/xxxxxxxx`. Two spots that ask the same thing share it. */
  readonly hash: string;
  /** The situation in a few words, shown above the question. */
  readonly label: string;
  readonly questions: readonly TrainQuestion[];
  /** Hand class, board texture or bet size — what `/progress` breaks the mode down by. */
  readonly bucket: string;
}

/** Guess hero's equity: hand-vs-range, then range-vs-range preflop, then on a flop. */
export interface EquitySpot extends SpotBase {
  readonly mode: 'equity';
  readonly tier: 'hand' | 'preflop' | 'flop';
  readonly heroText: string;
  readonly villainText: string;
  readonly heroLabel: string;
  readonly villainLabel: string;
  readonly boardText: string;
}

/** Count the combos of a class, or of a made-hand class and better, left in a range. */
export interface CombosSpot extends SpotBase {
  readonly mode: 'combos';
  readonly ask: 'class' | 'made';
  /** A hand class name (`AKs`) for `class`, a made-hand class for `made`. */
  readonly target: string;
  readonly rangeText: string;
  readonly rangeLabel: string;
  readonly boardText: string;
}

/** Draw a chart from memory; scored on total absolute weight error against the reference. */
export interface DrawingSpot extends SpotBase {
  readonly mode: 'drawing';
  readonly chartId: string;
  readonly chartLabel: string;
  readonly referenceText: string;
  /** Combos of total absolute error still counted as knowing the chart. */
  readonly weightTolerance: number;
}

/** Pick the best bluff from four candidates, scored against `bluffScore`. */
export interface BlockersSpot extends SpotBase {
  readonly mode: 'blockers';
  readonly heroText: string;
  /** Villain's whole range; the continuing half is derived at read time by a stated rule. */
  readonly villainText: string;
  readonly villainLabel: string;
  readonly boardText: string;
  readonly potBB: number;
  readonly betBB: number;
  /** The four combos offered, as text (`Ah5s`). */
  readonly candidates: readonly string[];
}

/** Say who holds the range advantage, then what share of the nutted combos hero has. */
export interface AdvantageSpot extends SpotBase {
  readonly mode: 'advantage';
  readonly heroText: string;
  readonly villainText: string;
  readonly heroLabel: string;
  readonly villainLabel: string;
  readonly boardText: string;
}

/** Quick-fire pot odds: MDF, alpha, required equity or the bluff break-even, raw or after rake. */
export interface PotOddsSpot extends SpotBase {
  readonly mode: 'potodds';
  readonly ask: 'mdf' | 'alpha' | 'requiredEquity' | 'bluffBreakeven';
  readonly potBB: number;
  readonly betBB: number;
  readonly rakePct: number;
  readonly rakeCapBB: number | null;
  /** Whether the question is about the pot after rake. */
  readonly afterRake: boolean;
}

export type TrainSpot =
  | EquitySpot
  | CombosSpot
  | DrawingSpot
  | BlockersSpot
  | AdvantageSpot
  | PotOddsSpot;

/** The truths a spot's questions turn out to have, by question key. */
export type SpotAnswers = Readonly<Record<string, string>>;

/**
 * One answered question (spec §16's scoring store).
 *
 * `correct` is the mode's own verdict rather than the gate's: for every mode but the range
 * drawing they are the same thing, and the drawing mode scores on total absolute weight error
 * while the gate compares how wide the range is. Both are on screen; this is the one the
 * schedule believes.
 */
export interface ScoreRow {
  readonly id: string;
  readonly mode: TrainMode;
  readonly spot_hash: string;
  readonly question_key: string;
  readonly question: string;
  readonly prediction: string;
  readonly actual: string;
  /** Signed miss in the answer's own unit; `null` when the answer was a word. */
  readonly error: number | null;
  readonly correct: boolean;
  /** Combos of total absolute error — the range-drawing mode only. */
  readonly weight_error: number | null;
  readonly bucket: string;
  readonly created_at: string;
}
