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
 * **It opens all nine steps** (ADR-061, amending ADR-050 decision 4). Five are answered by
 * poker-core arithmetic (3, 4, 5, 7, 8); the other four are scored against what the reader's pool
 * does, and an example has no pool — so their gates say that in a sentence instead of waiting for
 * a number that is never coming. Their inputs are still filled in here, so a reader who works
 * straight through never faces an empty board or an unpriced bet: step 1's two ranges and step 6's
 * size are set up, and step 2's split and step 9's pot are theirs to work.
 *
 * **Every spot is the button against the big blind in a single-raised pot**, because `btn_rfi`
 * against `bb_call_vs_btn` is the only pair of reference charts in which the caller's chart is the
 * range that actually reaches the flop (`HONEST_PAIRS`). That binds the seats and the preflop
 * line; it does not bind how many spots there are (ADR-072). The four flops are chosen so the same
 * two ranges tell four different stories — between them they reach all four of `roleOf`'s answers,
 * and the fourth is the one where the board belongs to the seat that called.
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

/**
 * The steps an example opens, in order: all nine (ADR-061). The four that read the pool are
 * mounted with `poolMissing` set, so each says why it has no field number rather than waiting.
 */
export const EXAMPLE_STEPS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * The step an example arrives on — 3, not 1, and deliberately so.
 *
 * Steps 1 and 2 are the set-up: an example's two ranges are already assigned and there is nothing
 * to subtract, so landing there would open on the one screen where a reader can neither work
 * anything out nor be shown an answer. Step 3 is the first with a board, a count and a reveal, and
 * it is where `help/tour.ts` points its two analyzer stops. The other eight are one click away on
 * the rail, and *previous* is live from the moment the page opens.
 */
export const EXAMPLE_OPENS_AT = 3;

/**
 * The chart pairs in which both seats' charts really are the ranges that reach the flop
 * (ADR-050 fact 4). `train/charts.ts` has one continuing range — `bb_call_vs_btn` — and seven
 * ranges somebody opened or raised with, so there is exactly one pair. `examples.test.ts` checks
 * every example against this list: the seat guard alone would pass `utg_rfi` against
 * `bb_call_vs_btn`, which is a range the big blind never calls an under-the-gun open with.
 */
export const HONEST_PAIRS: readonly (readonly [string, string])[] = [['btn_rfi', 'bb_call_vs_btn']];

const SEED_STACK_BB = 108;
const SEED_BET = 0.462;
const TWO_THIRDS = 0.66;
const HALF = 0.5;
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
  {
    id: 'their-board-second-pair',
    title: 'A board that belongs to the caller',
    teaches:
      'A flop can hit the range that called harder than the range that raised; and a hand that is neither the top of your range nor a draw is betting to protect itself, not for value.',
    story: 'The button opens to 3bb, the big blind calls. On 8♠ 6♦ 5♣ the big blind checks and the button weighs a half-pot bet with Q♥ 6♥.',
    source: 'A spot made up for this example.',
    node: buttonBets(HALF),
    heroChart: 'btn_rfi',
    villainChart: 'bb_call_vs_btn',
    board: '8s 6d 5c',
    heroCards: 'Qh6h',
    sizePct: HALF,
  },
];

const BY_ID = new Map<string, Example>(EXAMPLES.map((example) => [example.id, example]));

/** The example with this id, or `null` — the page says which ids exist rather than guessing. */
export function exampleById(id: string): Example | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The analysis an example opens with, in the analyzer's own shape: step 1's two ranges, step 3's
 * board, step 5's hand and step 6's size filled in, and every other step left empty for the
 * reader. Step 1's and step 6's inputs are set up even though both steps are now mounted, because
 * they are what the later steps read — an example whose ranges depended on the reader painting
 * them would have nothing to count at step 3.
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
