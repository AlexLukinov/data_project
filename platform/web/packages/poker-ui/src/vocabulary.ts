/**
 * The category words (ADR-056): the words that name a SET — a hand class, a draw, a strategic
 * category, a grouping axis, a seat, a piece of the situation shorthand — as opposed to the
 * glossary's words, which name how a number was obtained.
 *
 * Every table is keyed by `@poker/core`'s own type (`Record<MadeHandClass, …>` and so on), so a
 * class core adds without a row here fails to typecheck, and `formula` carries the rule that
 * places something in the set. The rules are written from what the code does, not from poker
 * folklore: the hand classes from `classify.ts` (relative to the board), the seats from
 * `core/positions.py` (named from the button backwards by how many players are dealt in), the
 * shorthand from `node.ts`'s `nodeKeyLabel`. A test pins every hand term to core's `labelFor`.
 */

import type { Axis, DrawClass, MadeHandClass, NodeAction, Position, StrategicCategory } from '@poker/core';
import { DEFAULT_EQUITY_EDGES, DEFAULT_NUT_CUTOFF, DEFAULT_NUT_TOP_PERCENT, DEFAULT_THRESHOLDS, DRAW_CLASSES, MADE_HAND_CLASSES, POSITIONS, STRATEGIC_CATEGORIES, isRealDraw } from '@poker/core';

import type { TermEntry } from './glossary';

const PERCENT = 100;

function pct(share: number): string {
  return `${Math.round(share * PERCENT)}%`;
}

const VALUE_LINE = pct(DEFAULT_THRESHOLDS.value);
const CATCHER_LINE = pct(DEFAULT_THRESHOLDS.bluffCatcher);
const EQUITY_BANDS = `${DEFAULT_EQUITY_EDGES.map((edge) => Math.round(edge * PERCENT)).join('–')}%`;

/** How seats get their names at all: the caption a table of `POSITION_WORDS` wants above it. */
export const POSITION_NAMING =
  'The names follow how many players were dealt in, not how many chairs the table has: the button, the small blind and the big blind first, and the seats in front of them take the list for that many players — six-handed UTG, HJ, CO; seven-handed UTG, MP, HJ, CO; nine-handed UTG, UTG1, MP, MP1, HJ, CO; ten-handed UTG2 joins after UTG1. Heads-up only two names exist: the button, which posts the small blind, and the big blind.';

export const POSITION_WORDS: Readonly<Record<Position, TermEntry>> = {
  UTG: { term: 'UTG', definition: 'Under the gun: the first seat to act before the flop, directly to the left of the big blind.', formula: 'named when six or more players are dealt in; with four or five that first seat is CO or HJ' },
  UTG1: { term: 'UTG1', definition: 'The second seat to act before the flop, directly after UTG.', formula: 'named only when eight or more players are dealt in' },
  UTG2: { term: 'UTG2', definition: 'The third seat to act before the flop, directly after UTG1.', formula: 'named only when ten players are dealt in' },
  MP: { term: 'MP', definition: 'Middle position: the first seat after the UTG seats.', formula: 'named only when seven or more players are dealt in' },
  MP1: { term: 'MP1', definition: 'The second middle-position seat, directly after MP.', formula: 'named only when nine or more players are dealt in' },
  HJ: { term: 'HJ', definition: 'Hijack: the seat two to the right of the button, just before the cutoff.', formula: 'named when five or more players are dealt in' },
  CO: { term: 'CO', definition: 'Cutoff: the seat directly to the right of the button and the last to act before it.', formula: 'named when four or more players are dealt in' },
  BTN: { term: 'BTN', definition: 'Button: the dealer seat, which acts last on every street after the flop.', formula: 'named at every table; heads-up the button also posts the small blind and acts first before the flop' },
  SB: { term: 'SB', definition: 'Small blind: the seat directly to the left of the button, which posts the smaller forced bet and acts first after the flop.', formula: 'named when three or more players are dealt in; heads-up there is no SB seat and the button posts it' },
  BB: { term: 'BB', definition: 'Big blind: the seat after the small blind, which posts the full forced bet and is the last to act before the flop.', formula: 'named at every table of two or more players' },
};

export const MADE_HAND_WORDS: Readonly<Record<MadeHandClass, TermEntry>> = {
  straight_flush: { term: 'Straight flush', definition: 'Five cards in a row of one suit, made with at least one hole card.', formula: 'the best five of hand and board are a straight flush that beats what the board makes on its own' },
  quads: { term: 'Four of a kind', definition: 'All four cards of one rank, at least one of them in hand.', formula: 'four of a kind the board does not make on its own: a pocket pair with two on the board, or one hole card with three' },
  full_house: { term: 'Full house', definition: 'Three cards of one rank and two of another, made with the hole cards.', formula: 'a full house that beats what the board makes on its own; on a river that is already a full house only a better one counts' },
  flush: { term: 'Flush', definition: 'Five cards of one suit, at least one of them in hand.', formula: 'a flush that beats what the board makes on its own; a five-card board flush the hole cards do not improve is classed by its pairs instead' },
  straight: { term: 'Straight', definition: 'Five ranks in a row, at least one of them from the hole cards.', formula: 'a straight that beats what the board makes on its own; the ace plays high or low (A-2-3-4-5)' },
  set: { term: 'Set', definition: 'Three of a kind from a pocket pair that matches one card on the board.', formula: 'a pocket pair with exactly one board card of its rank' },
  trips: { term: 'Trips', definition: 'Three of a kind from one hole card and a pair on the board.', formula: 'one hole card matches a rank the board shows twice; a pocket pair matching one board card is a set instead' },
  two_pair: { term: 'Two pair', definition: 'Each of two different hole cards pairs a card on the board.', formula: 'both hole cards match a board rank; a pair on the board is not counted, so a pocket pair on a paired board is still an overpair or an underpair' },
  overpair: { term: 'Overpair', definition: 'A pocket pair higher than every card on the board.', formula: 'the pocket pair ranks above the highest board card' },
  top_pair: { term: 'Top pair', definition: 'One hole card pairs the highest card on the board.', formula: 'one hole card matches the highest board rank, and that rank is on the board once' },
  under_pair: { term: 'Underpair', definition: 'A pocket pair below the highest card on the board, even when it is above all the others.', formula: 'the pocket pair ranks below the highest board card and matches none of the board' },
  second_pair: { term: 'Second pair', definition: 'One hole card pairs the second-highest rank on the board.', formula: 'one hole card matches the second of the board’s different ranks counted from the top, and that rank is on the board once' },
  third_pair: { term: 'Third pair', definition: 'One hole card pairs the third-highest rank on the board.', formula: 'one hole card matches the third of the board’s different ranks counted from the top, and that rank is on the board once' },
  weak_pair: { term: 'Weak pair', definition: 'One hole card pairs a board rank below the third-highest, which takes a turn or a river to exist.', formula: 'one hole card matches the fourth or fifth of the board’s different ranks counted from the top' },
  ace_high: { term: 'Ace high', definition: 'No pair of its own and nothing better, with an ace in hand.', formula: 'none of the classes above, and the higher hole card is an ace' },
  king_high: { term: 'King high', definition: 'No pair of its own and nothing better, with a king as the higher hole card.', formula: 'none of the classes above, and the higher hole card is a king' },
  no_pair: { term: 'No pair', definition: 'No pair of its own and nothing better, with neither an ace nor a king in hand.', formula: 'none of the classes above, and the higher hole card is a queen or lower' },
};

export const DRAW_WORDS: Readonly<Record<DrawClass, TermEntry>> = {
  flush_draw: { term: 'Flush draw', definition: 'Four cards of one suit with at least one of them in hand, so one more of that suit makes a flush.', formula: 'flop or turn: a suit holding a hole card reaches four cards; not counted once the hand is a flush' },
  backdoor_flush_draw: { term: 'Backdoor flush draw', definition: 'Three cards of one suit on the flop with at least one of them in hand, so the turn and the river both have to bring that suit.', formula: 'flop only: a suit holding a hole card reaches three cards' },
  open_ended_straight_draw: { term: 'Open-ended straight draw', definition: 'Two or more different ranks would each complete a straight with the hole cards, which includes a double gutshot.', formula: 'flop or turn: of the ranks neither in hand nor on the board, two or more make a straight that needs a hole card; not counted once the hand is a straight' },
  gutshot: { term: 'Gutshot', definition: 'Exactly one rank would complete a straight with the hole cards.', formula: 'flop or turn: the count of ranks that make a straight needing a hole card is one' },
  backdoor_straight_draw: { term: 'Backdoor straight draw', definition: 'On the flop, a turn and a river of the right two ranks would complete a straight with the hole cards.', formula: 'flop only, and only without an open-ended draw or a gutshot: some two new ranks make a straight that needs a hole card' },
  combo_draw: { term: 'Combo draw', definition: 'Two real draws at once, or one real draw on top of a pair or better; the combo is listed under each of its draws as well.', formula: 'from flush draw, open-ended straight draw and gutshot: two of them, or one with any pair or better; backdoor draws do not count' },
  no_draw: { term: 'No draw', definition: 'None of the draws above, which is every hand on the river.', formula: 'no draw class applies; a five-card board has nothing left to draw to' },
};

/** The draw classes core counts as real (`isRealDraw`), named as the table names them. */
const REAL_DRAWS = DRAW_CLASSES.filter(isRealDraw).map((draw) => DRAW_WORDS[draw].term.toLowerCase()).join(', ');

/** "A real draw", the phrase the category rule and the analyzer's rule of thumb both lean on. */
export const REAL_DRAW: TermEntry = {
  term: 'Real draw',
  definition: 'A draw that can complete on the very next card, as opposed to a backdoor draw, which needs two.',
  formula: `any of: ${REAL_DRAWS}`,
};

export const CATEGORY_WORDS: Readonly<Record<StrategicCategory, TermEntry>> = {
  value: { term: 'Value', definition: 'A combo strong enough to bet for value, judged by its equity against the other range.', formula: `equity ≥ ${VALUE_LINE} by default` },
  draw: { term: 'Draw', definition: 'A combo below the value line with a real draw, so what it can become matters more than what it is.', formula: `equity under ${VALUE_LINE} and a real draw (${REAL_DRAWS}); backdoor draws do not count` },
  bluff_catcher: { term: 'Bluff-catcher', definition: 'A combo with no real draw that beats the bluffs in the other range but not its value.', formula: `${CATCHER_LINE} ≤ equity < ${VALUE_LINE} by default, and no real draw` },
  air: { term: 'Air', definition: 'A combo with little equity and no real draw to improve to.', formula: `equity under ${CATCHER_LINE} by default, and no real draw` },
};

export const AXIS_WORDS: Readonly<Record<Axis, TermEntry>> = {
  made: { term: 'Made hand', definition: 'What a combo already is on this board, read relative to the board, so a pair on the board gives nobody a pair.', formula: 'straight or better only when the hole cards improve on the board alone; otherwise how the hole cards pair the board; otherwise ace high, king high or no pair' },
  draw: { term: 'Draw', definition: 'What a combo can still become on the flop or the turn; a combo with two draws is listed under each of them.', formula: 'nothing on the river; backdoor draws on the flop only' },
  strategic: { term: 'Category', definition: 'What a combo is for, from its equity against the other range and whether it has a real draw.', formula: `value at ≥ ${VALUE_LINE}; below that, draw with a real draw; else bluff-catcher at ≥ ${CATCHER_LINE}; else air (default thresholds)` },
  equity: { term: 'Equity bucket', definition: 'The band of equity against the other range that a combo falls in.', formula: `bands at ${EQUITY_BANDS} by default; a band includes its lower edge, and the top band includes 100%` },
  structure: { term: 'Structure', definition: 'Whether a combo is a pocket pair, suited or offsuit, which fixes how many combos each hand class holds.', formula: 'pocket pairs 6 combos per class, suited 4, offsuit 12' },
  nut: { term: 'Nut bucket', definition: 'Whether a combo is at or above the nut threshold, or in the rest of the range.', formula: `equity ≥ the nut threshold: a fixed cutoff (${pct(DEFAULT_NUT_CUTOFF)} by default) or where the top ${DEFAULT_NUT_TOP_PERCENT}% of both ranges together begins` },
};

/** The words of `nodeKeyLabel` that are not a seat or one of core's `NodeAction`s. */
export type NodeWord = 'rfi' | 'iso' | 'threeBet' | 'fourBet' | 'fiveBet' | 'moreBets' | 'toAct' | 'vs' | 'raiseTo' | 'betPct' | 'street' | 'stack' | 'stake';

export const NODE_WORDS: Readonly<Record<NodeWord | NodeAction, TermEntry>> = {
  rfi: { term: 'RFI', definition: 'Raise first in: hero opens the pot with a raise before the flop.', formula: 'a preflop raise with no raise and no limp before it' },
  iso: { term: 'iso', definition: 'Isolation raise: a raise before the flop over one or more limpers.', formula: 'a preflop raise with a limp before it and no raise' },
  threeBet: { term: '3-bet', definition: 'The re-raise of an opening raise before the flop.', formula: 'a preflop raise with one raise or all-in before it' },
  fourBet: { term: '4-bet', definition: 'A raise over a 3-bet before the flop.', formula: 'a preflop raise with two raises or all-ins before it' },
  fiveBet: { term: '5-bet', definition: 'A raise over a 4-bet before the flop.', formula: 'a preflop raise with three raises or all-ins before it' },
  moreBets: { term: '6-bet and up', definition: 'A raise over a 5-bet or more before the flop, numbered the same way.', formula: 'a preflop raise with n raises or all-ins before it is an (n + 2)-bet' },
  limp: { term: 'limp', definition: 'Only calling the big blind before the flop when nobody has raised.', formula: 'the step’s action is limp' },
  call: { term: 'call', definition: 'Matching the bet or raise in front without raising.', formula: 'the step’s action is call' },
  check: { term: 'check', definition: 'Passing the action on without betting when there is nothing to call.', formula: 'the step’s action is check' },
  bet: { term: 'bet', definition: 'The first bet on a street after the flop.', formula: 'the step’s action is bet' },
  raise: { term: 'raise', definition: 'A raise after the flop, over a bet or another raise.', formula: 'a raise on the flop, turn or river; before the flop a raise is named RFI, iso or by its bet number' },
  allin: { term: 'shove', definition: 'Moving all in, on any street.', formula: 'the step’s action is all-in' },
  fold: { term: 'fold', definition: 'Giving up the hand.', formula: 'the step’s action is fold' },
  toAct: { term: 'to act', definition: 'Hero has not acted yet: the sequence is empty or ends with another seat, so the range is what hero arrives here with.', formula: 'the last step is not hero’s' },
  vs: { term: 'vs', definition: 'The seat hero is up against, followed by the size that seat last put in front of hero when it has one.', formula: 'the villain the situation names; if it names none, the last other seat in the sequence that did not fold' },
  raiseTo: { term: 'raise size (2.5bb)', definition: 'Before the flop, the amount the seat hero is up against raised to, in big blinds.', formula: 'that seat’s latest step before hero’s last one, when the step carries a size' },
  betPct: { term: 'bet size (33%)', definition: 'After the flop, what the seat hero is up against bet, as a share of the pot.', formula: 'that seat’s latest step before hero’s last one: its fraction of the pot × 100, rounded' },
  street: { term: 'street (flop, turn, river)', definition: 'The betting round the decision is on; a situation before the flop names no street.', formula: 'printed only for the flop, the turn and the river' },
  stack: { term: 'effective stack (100bb)', definition: 'The smaller of hero’s stack and the largest live opponent’s, in big blinds.', formula: 'a whole number of big blinds; the pool counts every decision in the same band of stack depths, not only this exact one' },
  stake: { term: 'stake (NL10)', definition: 'The game the situation comes from: for cash, the limit type and the big blind in cents, so NL10 is no-limit with a 10-cent big blind.', formula: 'NL, PL or FL plus the big blind in cents; a tournament is T plus the total entry cost, with KO for bounties; printed only when set, and then the pool counts that stake alone' },
};

/** Every reference table by name: what `VocabularyTable` renders and a help page can list. */
export const VOCABULARY = {
  positions: POSITION_WORDS,
  madeHands: MADE_HAND_WORDS,
  draws: DRAW_WORDS,
  categories: CATEGORY_WORDS,
  axes: AXIS_WORDS,
  nodes: NODE_WORDS,
} as const;

export type VocabularyName = keyof typeof VOCABULARY;

/** Whether a string is one of `NodeKey`'s ten seats — the registry also carries `UNKNOWN` and `''`. */
export function isPosition(seat: string): seat is Position {
  return (POSITIONS as readonly string[]).includes(seat);
}

/**
 * The row that explains a distribution group, or `null` for the axes whose groups are numeric
 * bands or self-describing (equity, nut, structure).
 */
export function groupWord(axis: Axis, key: string): TermEntry | null {
  if (axis === 'made') return (MADE_HAND_CLASSES as readonly string[]).includes(key) ? MADE_HAND_WORDS[key as MadeHandClass] : null;
  if (axis === 'draw') return (DRAW_CLASSES as readonly string[]).includes(key) ? DRAW_WORDS[key as DrawClass] : null;
  if (axis === 'strategic') return (STRATEGIC_CATEGORIES as readonly string[]).includes(key) ? CATEGORY_WORDS[key as StrategicCategory] : null;
  return null;
}
