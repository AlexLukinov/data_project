/**
 * The Examples (spec §13: "a permanent 'Examples' section with 3–5 pre-loaded analyses to
 * explore"; ADR-050).
 *
 * **An example is a spot that ships with the app, not a hand stored anywhere.** It is data in
 * this file — a situation, the two reference charts for its seats, a flop, hero's two cards and
 * hero's bet — opened at `/examples/<id>` in the analyzer's own step components, in this browser
 * alone. Nothing is written to ClickHouse, Postgres or IndexedDB, so the real-hands rule cannot
 * be broken and a first visit needs no account, no upload and no API.
 *
 * **It opens five of the nine steps**: the ones whose answer is poker-core arithmetic (3, 4, 5, 7,
 * 8). Steps 1, 2, 6 and 9 are scored against what the reader's pool does, and an example has no
 * pool; their inputs are filled in here instead (step 1's ranges, step 6's size).
 *
 * **Every spot is the button against the big blind in a single-raised pot**, because `btn_rfi`
 * against `bb_call_vs_btn` is the only pair of reference charts in which the caller's chart is the
 * range that actually reaches the flop. The three flops are chosen so the same two ranges tell
 * three different stories.
 */
import type { NodeKey } from '@poker/core';
import { nodeKey, step } from '@poker/core';

import type { AnalysisStep } from '~/analyze/api';
import { emptyStep } from '~/analyze/api';
import { chartById } from '~/train/charts';

export interface Example {
  /** `/examples/<id>`. */
  readonly id: string;
  /** What the spot is about — never its answer. */
  readonly title: string;
  /** The one thing to look for, without a number the reader is about to be asked for. */
  readonly teaches: string;
  /** The line so far, in positions only. */
  readonly story: string;
  /** Where the spot comes from. */
  readonly source: string;
  /** The decision being analysed: hero's bet, as the replayer names a node (ADR-032). */
  readonly node: NodeKey;
  /** Reference chart ids (`~/train/charts`) for the node's hero and villain seats. */
  readonly heroChart: string;
  readonly villainChart: string;
  /** As step 3 stores a board. */
  readonly board: string;
  /** As step 5 stores hero's hand. */
  readonly heroCards: string;
  /** Hero's bet as a share of the pot, as step 6 stores it; step 8 balances against it. */
  readonly sizePct: number;
}

/** The steps an example opens, in order: the ones answered by poker-core alone. */
export const EXAMPLE_STEPS: readonly number[] = [3, 4, 5, 7, 8];

const SEED_STACK_BB = 108;
const SEED_BET = 0.462;
const TWO_THIRDS = 0.66;
const QUARTER = 0.25;

/** The button bets the flop after the big blind checks: the node every example is about. */
function buttonBets(sizePct: number, extra: Partial<NodeKey> = {}): NodeKey {
  return nodeKey('BTN', {
    villain_position: 'BB',
    action_sequence: [step('BB', 'check'), step('BTN', 'bet', { size_pct: sizePct })],
    street: 'flop',
    ...extra,
  });
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'top-pair-dry-board',
    title: 'Top pair on a dry king-high flop',
    teaches: 'How much of a wide calling range one ace-king removes, and whether top pair, top kicker is the top of a button range.',
    story: 'The button opens to 3bb, the big blind calls. On K♥ 9♦ 4♠ the big blind checks and the button bets a little under half the pot with A♥ K♦.',
    source: 'Hand #245678901235 of the committed PokerStars seed corpus (platform/seeds/hands/pokerstars/cash_6max_nl50.txt).',
    node: buttonBets(SEED_BET, { stake: 'NL50', eff_stack_bb: SEED_STACK_BB }),
    heroChart: 'btn_rfi',
    villainChart: 'bb_call_vs_btn',
    board: 'Kh 9d 4s',
    heroCards: 'AhKd',
    sizePct: SEED_BET,
  },
  {
    id: 'flush-draw-their-board',
    title: 'A nut flush draw on a flop that suits the caller',
    teaches: 'Nut advantage can belong to the player who called, the board decides which blocker question matters, and a real draw below the top of a range is a semi-bluff.',
    story: 'The button opens to 3bb, the big blind calls. On J♥ 8♥ 5♣ the big blind checks and the button weighs a two-thirds-pot bet with A♥ 4♥.',
    source: 'A spot made up for this example.',
    node: buttonBets(TWO_THIRDS),
    heroChart: 'btn_rfi',
    villainChart: 'bb_call_vs_btn',
    board: 'Jh 8h 5c',
    heroCards: 'Ah4h',
    sizePct: TWO_THIRDS,
  },
  {
    id: 'range-ahead-hand-behind',
    title: 'Your range is ahead; your hand is not',
    teaches: 'Range advantage and what one hand is for are separate questions: the same edge in the range says nothing about the hand you hold.',
    story: 'The button opens to 3bb, the big blind calls. On A♦ A♠ 3♥ the big blind checks and the button weighs a quarter-pot bet with 7♣ 6♣.',
    source: 'A spot made up for this example.',
    node: buttonBets(QUARTER),
    heroChart: 'btn_rfi',
    villainChart: 'bb_call_vs_btn',
    board: 'Ad As 3h',
    heroCards: '7c6c',
    sizePct: QUARTER,
  },
];

const BY_ID = new Map<string, Example>(EXAMPLES.map((example) => [example.id, example]));

/** The example with this id, or `null` — the page says which ids exist rather than guessing. */
export function exampleById(id: string): Example | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The analysis an example opens with, in the analyzer's own shape: step 1's two ranges, step 3's
 * board, step 5's hand and step 6's size filled in, and every step the reader works left empty.
 *
 * The ranges carry no label: the analyzer's seat panel calls a labelled range "your chart", and a
 * reference chart is not the reader's — the example page names the charts and their provenance.
 */
export function exampleSteps(example: Example): AnalysisStep[] {
  const villain = example.node.villain_position ?? '';
  const one = emptyStep(1);
  const three = emptyStep(3);
  const five = emptyStep(5);
  const six = emptyStep(6);
  one.work.ranges = [
    { position: example.node.hero_position, weights: chartById(example.heroChart).text, label: '' },
    { position: villain, weights: chartById(example.villainChart).text, label: '' },
  ];
  three.work.board = example.board;
  five.work.hero_cards = example.heroCards;
  six.work.size_pct = example.sizePct;
  const filled = [one, three, five, six];
  const rest = EXAMPLE_STEPS.filter((n) => !filled.some((s) => s.step === n)).map(emptyStep);
  return [...filled, ...rest].sort((a, b) => a.step - b.step);
}
