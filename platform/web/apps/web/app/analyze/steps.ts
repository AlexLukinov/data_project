/**
 * The nine steps (spec §15), as data: what each one is for, and the question it makes you answer
 * before it shows you anything.
 *
 * Keeping the questions here rather than inside nine components means the wording, the tolerance
 * and the units are in one readable list — and the training modes of F.11 can reuse them.
 */
import type { Card } from '@poker/core';
import { suitOf } from '@poker/core';
import type { AnswerType, StepLabel } from '@poker/ui';

export interface StepDef {
  readonly step: number;
  readonly title: string;
  /** One line under the title: what this step is for. */
  readonly purpose: string;
  readonly question: string;
  readonly answerType: AnswerType;
  /** In the answer's own unit — percentage points, combos, a ratio. */
  readonly tolerance: number;
  readonly choices: readonly string[];
  readonly unit: string;
  /** What to think about while answering. Never a hint at the answer itself. */
  readonly hint: string;
}

const NO_CHOICES: readonly string[] = [];

export const STEPS: readonly StepDef[] = [
  {
    step: 1,
    title: 'Assign preflop ranges',
    purpose: 'Give every seat still in the hand a range, from your library or by hand.',
    question: 'What percentage of the time does the field take this action from this seat?',
    answerType: 'percent',
    tolerance: 5,
    choices: NO_CHOICES,
    unit: '',
    hint: 'At an unopened preflop node this is the opening frequency; at any other, how often the field plays it this way.',
  },
  {
    step: 2,
    title: 'Subtract',
    purpose: 'Split the range that faced an action into fold, call and raise — what is left is what arrives on the flop.',
    question: 'What percentage of that range continues against this action?',
    answerType: 'percent',
    tolerance: 5,
    choices: NO_CHOICES,
    unit: '',
    hint: 'A call removes from the top as well as the bottom: the best hands raise.',
  },
  {
    step: 3,
    title: 'Bucket both ranges on the board',
    purpose: 'Count what each range actually hit — by made-hand class, side by side.',
    question: "What percentage of villain's range is top pair or better?",
    answerType: 'percent',
    tolerance: 5,
    choices: NO_CHOICES,
    unit: '',
    hint: 'Count the classes, not the feeling. Most ranges miss most flops.',
  },
  {
    step: 4,
    title: 'Count the nut combos',
    purpose: 'Whose range holds the hands that never fold — and by how much.',
    question: 'What share of the nutted combos here is yours?',
    answerType: 'percent',
    tolerance: 10,
    choices: NO_CHOICES,
    unit: '',
    hint: 'Nut advantage is what buys a large size; range advantage only buys frequency.',
  },
  {
    step: 5,
    title: 'Card removal and blockers',
    purpose: 'See exactly which of their combos your own two cards make impossible.',
    question: "How many combos does your hand remove from villain's range?",
    answerType: 'number',
    tolerance: 4,
    choices: NO_CHOICES,
    unit: 'combos',
    hint: 'Each card you hold kills every combo containing it — count the classes it hits hardest.',
  },
  {
    step: 6,
    title: 'Frequency from range advantage, size from nut advantage',
    purpose: 'Decide, then see what the field does here.',
    question: 'Bet or check?',
    answerType: 'choice',
    tolerance: 0,
    choices: ['bet', 'check'],
    unit: '',
    hint: 'Range advantage sets how often; nut advantage sets how big. Commit to a size too.',
  },
  {
    step: 7,
    title: 'Place your hand inside your own range',
    purpose: 'The same hand is a bet, a check or a give-up depending on what is around it.',
    question: 'Is your hand value, protection, a semi-bluff or a give-up?',
    answerType: 'choice',
    tolerance: 0,
    choices: ['value', 'protection', 'semi-bluff', 'give-up'],
    unit: '',
    hint: 'Where does it sit by equity inside your own range — not in the abstract?',
  },
  {
    step: 8,
    title: 'Count your own value and your own bluffs',
    purpose: 'Mark the two halves of your range and see the ratio you are actually playing.',
    question: 'How many bluff combos do you have for every value combo?',
    answerType: 'number',
    tolerance: 0.2,
    choices: NO_CHOICES,
    unit: 'bluffs per value combo',
    hint: 'A pot-sized bet balances at one bluff for every two value hands.',
  },
  {
    step: 9,
    title: 'MDF anchor, then pool deviation',
    purpose: 'What theory says you must defend, then what your pool actually does — and the gap between them.',
    question: 'What percentage of the time does your pool fold to this bet?',
    answerType: 'percent',
    tolerance: 5,
    choices: NO_CHOICES,
    unit: '',
    hint: 'MDF is the baseline against a balanced opponent. Your pool is not one.',
  },
];

export const FIRST_STEP = 1;
export const LAST_STEP = STEPS.length;

export function stepDef(step: number): StepDef {
  return STEPS[Math.min(Math.max(step, FIRST_STEP), LAST_STEP) - 1]!;
}

/** The rail's labels. */
export const STEP_LABELS: readonly StepLabel[] = STEPS.map((s) => ({ step: s.step, title: s.title }));

export type StepQuestion = Pick<StepDef, 'question' | 'tolerance' | 'unit'>;

const SUITED_FOR_A_DRAW = 2;
const FLUSH_DRAW_TOLERANCE = 3;

/** How many of the board's cards share its most common suit. */
function longestSuit(board: readonly Card[]): number {
  const bySuit = new Map<number, number>();
  for (const card of board) bySuit.set(suitOf(card), (bySuit.get(suitOf(card)) ?? 0) + 1);
  return Math.max(0, ...bySuit.values());
}

/**
 * Step 5's question, which the board decides.
 *
 * The spec asks "how many flush draws can villain have?" — a question with no answer on a
 * rainbow board, where the useful one is how much your own cards removed instead.
 */
export function blockerQuestion(board: readonly Card[]): StepQuestion {
  if (longestSuit(board) < SUITED_FOR_A_DRAW) return stepDef(5);
  return {
    question: 'How many flush draws can villain still have?',
    tolerance: FLUSH_DRAW_TOLERANCE,
    unit: 'combos',
  };
}
