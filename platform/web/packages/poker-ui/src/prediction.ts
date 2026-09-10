/**
 * Scoring a committed prediction (spec §15): the arithmetic behind `PredictionGate`, kept out of
 * the component so it can be tested — and reused by the training modes of F.11 — without mounting.
 *
 * The rule the whole analyzer rests on: the answer is committed **before** the actual is known.
 * Nothing here can be called without both, which is why the outcome carries them side by side.
 */

export type AnswerType = 'number' | 'percent' | 'choice' | 'text';

export interface PredictionOutcome {
  readonly answer: string;
  readonly actual: string;
  /** Signed miss (`answer − actual`) on a numeric answer, `null` when the answer is words. */
  readonly error: number | null;
  /** Whether the answer counts as right: inside the tolerance, or the same choice. */
  readonly withinTolerance: boolean;
}

const NUMERIC: ReadonlySet<AnswerType> = new Set<AnswerType>(['number', 'percent']);
const DEFAULT_TOLERANCE = 0;
const PLACES = 1;

/** Whether this kind of answer is scored by distance rather than by matching. */
export function isNumeric(type: AnswerType): boolean {
  return NUMERIC.has(type);
}

function normalise(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Compare what was committed with what turned out to be true.
 *
 * `tolerance` is in the answer's own unit — percentage points for `percent`, combos or combo
 * ratios for `number`. A numeric answer that is not a number scores as wrong rather than
 * throwing: the gate should never lose a user's work over a typo.
 */
export function scorePrediction(
  answer: string,
  actual: string,
  type: AnswerType,
  tolerance = DEFAULT_TOLERANCE,
): PredictionOutcome {
  if (!isNumeric(type)) {
    return { answer, actual, error: null, withinTolerance: normalise(answer) === normalise(actual) };
  }
  const said = Number(answer);
  const was = Number(actual);
  if (!Number.isFinite(said) || !Number.isFinite(was)) {
    return { answer, actual, error: null, withinTolerance: false };
  }
  const error = said - was;
  return { answer, actual, error, withinTolerance: Math.abs(error) <= tolerance };
}

/**
 * The plain sentence shown at the reveal: what was said, what was true, and by how much.
 *
 * A percentage labels itself, so `unit` is only for the answers that need naming ("combos").
 */
export function explainPrediction(outcome: PredictionOutcome, type: AnswerType, unit = ''): string {
  const named = type === 'percent' ? '%' : unit;
  const space = type === 'percent' ? '' : ' ';
  const tail = named === '' ? '' : `${space}${named}`;
  if (outcome.error === null) {
    const verdict = outcome.withinTolerance ? 'that is what happens' : `it is ${outcome.actual}`;
    return `You said ${outcome.answer} — ${verdict}.`;
  }
  const miss = Math.abs(outcome.error).toFixed(PLACES);
  const direction = outcome.error > 0 ? 'too high' : 'too low';
  const points = type === 'percent' ? ' points' : tail;
  const verdict = outcome.withinTolerance ? 'close enough' : `${miss}${points} ${direction}`;
  return `You said ${outcome.answer}${tail}, it is ${outcome.actual}${tail} — ${verdict}.`;
}
