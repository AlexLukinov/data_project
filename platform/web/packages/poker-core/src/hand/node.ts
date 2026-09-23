/**
 * The situation a hand is in at a given step (spec §9.3) — the bridge from a replayed hand to
 * everything keyed by `NodeKey`: the stored ranges (F.6) and the pool's frequencies (F.8).
 *
 * The key follows the same convention as everywhere else: **the sequence ends with hero's own
 * action**, so `nodeKeyAt(hand, i)` describes the decision that has just been made, and looking
 * it up answers "which combos take this line". Stepping forward therefore walks the node tree.
 *
 * The sequence is this street's decisions; the earlier streets ride along as `line_so_far`,
 * hero's own actions street by street (ADR-078). `pot_type` says how the pot was built preflop
 * and `size_bucket` names the registry bucket of the bet hero is facing — the latter only when
 * the caller hands over the registry's buckets, since no boundary is written here (ADR-028).
 *
 * A hand the parser could not give positions to yields `null` rather than a key with a made-up
 * seat: an invented situation would quietly match the wrong stored range.
 */

import type { ActionStep, BucketRanges, NodeAction, NodeKey, PotType, Position, SizeBucket, Street } from '../node';
import { DEFAULT_STACK_BB, LINE_STREET_SEP, POSITIONS, STREETS, nodeKey, ownLine, sizeBucketOf } from '../node';
import { textureTags } from '../texture';
import { STREET_CARDS, replayStates } from './replay';
import type { ActionStreet, HandState, ReplayAction, ReplayHand } from './types';
import { DECISIONS } from './types';

export interface NodeKeyOptions {
  /**
   * The registry's `facing_size_pct` buckets (`Dimension.buckets` from `/v1/definitions`).
   * Without them `size_bucket` stays null: the boundaries are the registry's alone (ADR-028).
   */
  readonly sizeBuckets?: BucketRanges;
}

const AGGRESSIVE: ReadonlySet<NodeAction> = new Set<NodeAction>(['bet', 'raise', 'allin']);
const MAX_STAKE_CHARS = 16;
/** `pot_type` by the number of preflop raises, as dbt's `hand_arrays.sql` names it; any more is `5bet_plus`. */
const POT_TYPE_BY_RAISES: readonly PotType[] = ['limped', 'srp', '3bet', '4bet'];

/** The betting round of an action; showdown is not one, and shows the river's situation. */
function bettingStreet(street: ActionStreet): Street {
  return street === 'showdown' ? 'river' : street;
}

function asPosition(value: string): Position | null {
  return (POSITIONS as readonly string[]).includes(value) ? (value as Position) : null;
}

function positionsBySeat(hand: ReplayHand): Map<number, Position> {
  const seats = new Map<number, Position>();
  for (const seat of hand.seats) {
    const position = asPosition(seat.position);
    if (position !== null) seats.set(seat.seat, position);
  }
  return seats;
}

/** A preflop call is a limp only while nobody has raised — the distinction the vocabulary keeps. */
function nodeAction(action: ReplayAction, raisesBefore: number): NodeAction {
  if (action.kind === 'allin') return 'allin';
  if (action.kind === 'call') return action.street === 'preflop' && raisesBefore === 0 ? 'limp' : 'call';
  if (action.kind === 'bet' || action.kind === 'raise') return action.isAllIn ? 'allin' : action.kind;
  return action.kind === 'fold' ? 'fold' : 'check';
}

/** A postflop bet or raise as the exact share of the pot before it — what the fact stores; null preflop, when passive, or with no pot yet. */
function potShare(action: ReplayAction, verb: NodeAction): number | null {
  if (!AGGRESSIVE.has(verb) || bettingStreet(action.street) === 'preflop' || action.potBefore <= 0) return null;
  return action.amount / action.potBefore;
}

/** Preflop sizes are raise-to in blinds, postflop ones a share of the pot (spec §10.1), rounded for the wire. */
function sizes(action: ReplayAction, verb: NodeAction, bigBlind: number, share: number | null): Pick<ActionStep, 'size_bb' | 'size_pct'> {
  const none = { size_bb: null, size_pct: null };
  if (!AGGRESSIVE.has(verb)) return none;
  if (bettingStreet(action.street) === 'preflop') {
    const to = action.amountTo > 0 ? action.amountTo : action.amount;
    return bigBlind > 0 ? { ...none, size_bb: round(to / bigBlind, 2) } : none;
  }
  return share === null ? none : { ...none, size_pct: round(share, 3) };
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

interface Taken {
  readonly step: ActionStep;
  readonly on: Street;
  /** Where the action sits in `hand.actions`; state `at` is the table before it. */
  readonly at: number;
  readonly seat: number;
  /**
   * The exact share of the pot a postflop bet or raise was, for bucketing. The step's `size_pct`
   * is this rounded to three places, and a rounded 0.370 sits in a bucket a raw 0.3696 does not.
   */
  readonly ratio: number | null;
}

interface Line {
  /** Every decision of the hand so far with its street: the opponent and the line are read across all of it. */
  readonly taken: readonly Taken[];
  /** The decisions on the node's own street — what the key's sequence carries. */
  readonly steps: readonly ActionStep[];
  readonly street: Street;
}

/**
 * The decisions taken before state `index`, as steps, and the street they ended on.
 *
 * Only the **last street's** decisions go into the sequence: a `NodeKey` has one `street` and
 * a flat sequence, so a turn node whose sequence still carried the preflop and flop actions
 * would describe a line no seat ever took, and the pool would answer "never seen" (ADR-028).
 * The earlier streets are what `line_so_far` is for.
 */
function lineBefore(hand: ReplayHand, index: number, seats: Map<number, Position>): Line | null {
  const taken: Taken[] = [];
  let raises = 0;
  let street: Street = 'preflop';
  for (const [at, action] of hand.actions.slice(0, index).entries()) {
    if (!DECISIONS.has(action.kind)) continue;
    const on = bettingStreet(action.street);
    if (on !== street) {
      street = on;
      raises = 0;
    }
    const position = seats.get(action.seat);
    if (position === undefined) return null;
    const verb = nodeAction(action, raises);
    if (AGGRESSIVE.has(verb)) raises += 1;
    const ratio = potShare(action, verb);
    taken.push({ step: { position, action: verb, ...sizes(action, verb, hand.bigBlind, ratio) }, on, at, seat: action.seat, ratio });
  }
  const last = taken.at(-1);
  if (last === undefined) return null;
  return {
    taken,
    steps: taken.filter((t) => t.on === last.on).map((t) => t.step),
    street: last.on,
  };
}

/**
 * Who hero is up against: the last other seat to bet or raise, else the last one still in the
 * hand. A seat that folded is nobody's villain — an open that everyone folded to faces no one.
 */
function villainOf(steps: readonly ActionStep[], hero: Position): Position | null {
  const others = steps.slice(0, -1).filter((s) => s.position !== hero && s.action !== 'fold');
  for (let i = others.length - 1; i >= 0; i--) {
    const step = others[i]!;
    if (AGGRESSIVE.has(step.action)) return step.position;
  }
  return others.at(-1)?.position ?? null;
}

/**
 * Hero's own line up to, not including, the decision being keyed — one segment per street from
 * preflop to this one, so `'r/x-c/'` is "opened, checked-called the flop, deciding on the turn".
 * Null preflop: there the sequence is the whole line, and a second spelling of one situation
 * (`''` beside the `null` every stored key carries) would match no chart on lookup (ADR-031).
 */
function lineSoFar(taken: readonly Taken[], hero: Position, street: Street): string | null {
  if (street === 'preflop') return null;
  const before = taken.slice(0, -1);
  return STREETS.slice(0, STREETS.indexOf(street) + 1)
    .map((on) => ownLine(before.filter((t) => t.on === on).map((t) => t.step), hero))
    .join(LINE_STREET_SEP);
}

/** How the pot was built preflop, counted as dbt's `pot_type` counts it; nothing while it is still being built. */
function potTypeOf(taken: readonly Taken[], street: Street): PotType | null {
  if (street === 'preflop') return null;
  const raises = taken.filter((t) => t.on === 'preflop' && (t.step.action === 'raise' || t.step.action === 'allin')).length;
  return POT_TYPE_BY_RAISES.at(raises) ?? '5bet_plus';
}

/**
 * The bucket of the bet hero is answering: the last bet or raise by another seat on this street
 * before hero's own step, bucketed on its exact share of the pot — the fact's `facing_size_pct`
 * is unrounded, and the step's rounded `size_pct` can land one bucket over. Null when nobody
 * bet, when the pot gave the bet no size, on preflop, and without the registry's buckets.
 */
function sizeBucketFaced(taken: readonly Taken[], hero: Position, street: Street, buckets: BucketRanges | undefined): SizeBucket | null {
  if (street === 'preflop' || buckets === undefined) return null;
  const faced = taken.slice(0, -1).filter((t) => t.on === street && t.step.position !== hero && AGGRESSIVE.has(t.step.action)).at(-1);
  return faced === undefined || faced.ratio === null ? null : sizeBucketOf(faced.ratio, buckets);
}

/**
 * The stack the decision is played for, in big blinds: hero's chips behind against the most a
 * live opponent has behind, both before this action — the fact's `eff_stack_bb`
 * (`decision_state.sql`), not the stacks at the deal. Hero's own when nobody else is live.
 */
function effectiveStackBb(hand: ReplayHand, before: HandState | undefined, heroSeat: number): number {
  const hero = before?.seats.find((s) => s.seat === heroSeat);
  if (hand.bigBlind <= 0 || before === undefined || hero === undefined) return DEFAULT_STACK_BB;
  const live = before.seats.filter((s) => s.seat !== heroSeat && !s.folded).map((s) => s.stack);
  const opponent = live.length === 0 ? hero.stack : Math.max(...live);
  return Math.max(1, Math.round(Math.min(hero.stack, opponent) / hand.bigBlind));
}

/**
 * The situation after the decisions in `hand.actions.slice(0, index)`, or `null` when there is
 * none yet (the deal) or the hand has no derived positions.
 *
 * `board_texture` is the board face up at this step — never the whole one, or a flop node would
 * carry the river's tags. A malformed board throws: that is a parser bug, not a situation.
 */
export function nodeKeyAt(hand: ReplayHand, index: number, options: NodeKeyOptions = {}): NodeKey | null {
  const seats = positionsBySeat(hand);
  const line = lineBefore(hand, index, seats);
  const last = line?.taken.at(-1);
  if (line === null || last === undefined) return null;
  const hero = last.step.position;
  // The opponent is looked for across the whole hand, not only this street: on the turn the
  // seat hero is playing against may last have acted preflop, and it is still that seat.
  const villain = villainOf(line.taken.map((t) => t.step), hero);
  return nodeKey(hero, {
    stake: hand.stake.slice(0, MAX_STAKE_CHARS),
    table_size: hand.seats.length,
    eff_stack_bb: effectiveStackBb(hand, replayStates(hand)[last.at], last.seat),
    villain_position: villain,
    action_sequence: line.steps,
    street: line.street,
    line_so_far: lineSoFar(line.taken, hero, line.street),
    size_bucket: sizeBucketFaced(line.taken, hero, line.street, options.sizeBuckets),
    pot_type: potTypeOf(line.taken, line.street),
    board_texture: textureTags(hand.board.slice(0, STREET_CARDS[line.street])),
  });
}
