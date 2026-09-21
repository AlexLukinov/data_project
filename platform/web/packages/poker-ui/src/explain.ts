/**
 * "Explain the number" (spec §13): a plain-language sentence next to a key output, generated
 * from the computed values so the words and the numbers can never disagree.
 */

import type { DefendingSet, EquityResult, NutAdvantage, PotOddsFigures, RangeAdvantage } from '@poker/core';

import type { RealizationRow } from './estimate';
import { num, percent } from './format';

/** Below this gap in mean equity neither range has a real advantage. */
export const EVEN_RANGE_MARGIN = 0.03;
/** A side "holds the nuts" from this share of the nut weight. */
export const NUT_EDGE = 0.6;
/**
 * Within this of 1 an EQR reads as realizing its equity in full, and two EQRs this close read as
 * the same: a pool EQR is a mean over a sample, so a few points either way is noise, not a leak.
 */
export const EVEN_EQR_MARGIN = 0.05;
/** Below this gap in top-pair-or-better share a board hits two ranges about as hard: a handful of combos in a typical range. */
export const EVEN_HIT_MARGIN = 0.03;

const PERCENT = 100;
const HEADS_UP = 2;
/** Counts are written the same on every machine: the founder's is ru-RU, whose default would print `1 176`. */
const COUNT_LOCALE = 'en-US';

/** The parts of an equity result its sentence reads; an `EquityResult` is one as it stands. */
export type EquityFigures = Pick<EquityResult, 'equities' | 'exact' | 'iterations' | 'confidence95' | 'work'>;

function count(value: number): string {
  return value.toLocaleString(COUNT_LOCALE);
}

/** A gap between two shares as unsigned percentage points, `6.5`. */
function gapInPoints(gap: number): string {
  return Math.abs(PERCENT * gap).toFixed(1);
}

export function explainPotOdds(f: PotOddsFigures): string {
  if (f.bet === 0) return `Nobody has bet: checking keeps the ${num(f.pot)} pot in play for free, so any hand may continue.`;
  return `Calling ${num(f.call)} to win ${num(f.pot + f.bet)} is ${f.odds.text}: the call breaks even with ${percent(f.requiredEquity)} equity. Facing this bet, defend ${percent(f.mdf)} of your range so a bluff has to work ${percent(f.alpha)} of the time to break even.`;
}

export function explainMdf(f: PotOddsFigures, defend: DefendingSet | null): string {
  if (f.bet === 0) return `Nobody has bet, so there is nothing to defend against.`;
  const base = `Facing ${num(f.bet)} into ${num(f.pot)}, continue with ${percent(f.mdf)} of the range or a bluff with any two cards profits; the bluff needs folds ${percent(f.alpha)} of the time.`;
  if (defend === null || defend.combos.length === 0) return base;
  return `${base} By equity that is the ${defend.combos.length} combos (${num(defend.weight)} weighted) with at least ${percent(defend.cutoffEquity)} equity against the betting range.`;
}

/**
 * `source` names where the EV came from, as the sentence reads it: "entered" for a solver number
 * the user typed. The pool's measured EQR has no EV behind it and its own sentence, `explainPoolEqr`.
 */
export function explainEqr(equity: number, pot: number, ev: number | null, source: string): string {
  const fullValue = equity * pot;
  if (ev === null) return `With ${percent(equity)} equity in a pot of ${num(pot)}, realizing it fully is worth ${num(fullValue)}; enter an EV to see how much of that the hand keeps.`;
  const eqr = ev / fullValue;
  const verdict =
    eqr > 1
      ? 'over-realizes: position, initiative or an uncapped range let it win more than its share'
      : eqr < 1
        ? 'under-realizes: it folds or is bluffed off part of its share, as out-of-position and capped hands are'
        : 'realizes exactly its share';
  return `The ${source} EV of ${num(ev)} is ${percent(eqr, 0)} of the ${num(fullValue)} its ${percent(equity)} equity is worth: the hand ${verdict}.`;
}

export function explainRangeAdvantage(adv: RangeAdvantage, hero: string, villain: string): string {
  if (!Number.isFinite(adv.difference)) return 'Run the equity calculation to compare the two ranges.';
  const points = Math.abs(100 * adv.difference).toFixed(1);
  if (Math.abs(adv.difference) < EVEN_RANGE_MARGIN) {
    return `${hero} averages ${percent(adv.heroMean)} equity and ${villain} ${percent(adv.villainMean)}, within ${points} points: no real range advantage either way.`;
  }
  const heroAhead = adv.difference > 0;
  const [ahead, behind] = heroAhead ? [hero, villain] : [villain, hero];
  const [aheadMean, behindMean] = heroAhead ? [adv.heroMean, adv.villainMean] : [adv.villainMean, adv.heroMean];
  return `${ahead} has the range advantage: ${percent(aheadMean)} average equity against ${percent(behindMean)} for ${behind}, ${points} points more.`;
}

export function explainNutAdvantage(nut: NutAdvantage, hero: string, villain: string): string {
  const rule = nut.mode === 'cutoff' ? `equity ≥ ${percent(nut.threshold, 0)}` : `the top of both ranges, equity ≥ ${percent(nut.threshold)}`;
  if (nut.hero.nutWeight + nut.villain.nutWeight === 0) return `Neither range has a nutted combo here (${rule}): nobody can bet big for value.`;
  if (nut.split.hero >= NUT_EDGE) return `${hero} holds ${percent(nut.split.hero, 0)} of the nutted combos (${rule}) — that supports a larger bet size.`;
  if (nut.split.villain >= NUT_EDGE) return `${villain} holds ${percent(nut.split.villain, 0)} of the nutted combos (${rule}): ${hero} should size down or check more.`;
  return `The nutted combos (${rule}) are split ${percent(nut.split.hero, 0)} / ${percent(nut.split.villain, 0)}: neither side can lean on big bets.`;
}

function nameOf(names: readonly string[], player: number): string {
  return names[player] ?? `Player ${player + 1}`;
}

/** `A, B and C`. */
function listed(parts: readonly string[]): string {
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * Where the figures came from: every runout counted, or a sample and how far off it can be.
 *
 * The engine's interval is the one on the FIRST player's share (`confidence95` is computed for
 * player 0), so with two players — whose shares move together — it is written as the figures'
 * accuracy, and with three or more it is named as that player's alone rather than claimed for all.
 */
function equityProvenance(result: EquityFigures, names: readonly string[]): string {
  if (result.exact) return `Every one of the ${count(result.work)} runouts was counted, so there is no sampling error.`;
  const sampled = `These are estimated from ${count(result.iterations ?? result.work)} sampled runouts`;
  if (result.confidence95 === undefined) return `${sampled}.`;
  const margin = `±${result.confidence95.toFixed(2)} points 19 times out of 20`;
  if (result.equities.length === HEADS_UP) return `${sampled}, accurate to ${margin}.`;
  return `${sampled}; ${nameOf(names, 0)}'s share is accurate to ${margin}.`;
}

/** Two players: who is ahead of an even split and by how much, or that it is close to a coin flip. */
function headsUpVerdict(equities: readonly number[], names: readonly string[]): string {
  const [first = Number.NaN, second = Number.NaN] = equities;
  const lead = first - 1 / HEADS_UP;
  if (Math.abs(lead) < EVEN_RANGE_MARGIN) {
    return `${nameOf(names, 0)} has ${percent(first)} and ${nameOf(names, 1)} ${percent(second)}: close to a coin flip, within ${gapInPoints(lead)} points of an even split.`;
  }
  const [ahead, behind] = lead > 0 ? [0, 1] : [1, 0];
  const [aheadEquity, behindEquity] = lead > 0 ? [first, second] : [second, first];
  return `${nameOf(names, ahead)} is ahead: ${percent(aheadEquity)} against ${percent(behindEquity)} for ${nameOf(names, behind)}, ${gapInPoints(lead)} points above an even split.`;
}

/** Three or more players: each against the even share, one pot divided by the number of players. */
function multiwayVerdict(equities: readonly number[], names: readonly string[]): string {
  const even = 1 / equities.length;
  const parts = equities.map((equity, player) => {
    const gap = equity - even;
    const against = Math.abs(gap) < EVEN_RANGE_MARGIN ? 'about even' : `${gapInPoints(gap)} points ${gap > 0 ? 'above' : 'below'}`;
    return `${nameOf(names, player)} ${percent(equity)} (${against})`;
  });
  return `With ${equities.length} players an even share is ${percent(even)}: ${listed(parts)}.`;
}

/**
 * The Lab's headline equity in words: who is ahead against an even split (two players) or against
 * an even share (three or more), what equity is, and whether the numbers were counted or sampled.
 * `names` are the names shown above the numbers, in the same order as `result.equities`.
 */
export function explainEquity(result: EquityFigures, names: readonly string[]): string {
  const verdict = result.equities.length === HEADS_UP ? headsUpVerdict(result.equities, names) : multiwayVerdict(result.equities, names);
  return `${verdict} Equity is the share of the pot each would win if every hand went to showdown. ${equityProvenance(result, names)}`;
}

/** What an EQR says about play: above, below or about the share its equity is worth. */
function realizationVerdict(eqr: number): string {
  if (Math.abs(eqr - 1) < EVEN_EQR_MARGIN) return 'realizes about what its equity is worth';
  return eqr > 1
    ? "over-realizes: position, initiative or an uncapped range let it win more than its equity's share"
    : 'under-realizes: it folds or is bluffed off part of its share, as out-of-position and capped ranges are';
}

/**
 * The field's measured EQR in words, over how many decisions and which way it leans, and — when an
 * EV was entered from a solver — how many points the field keeps above or below that solution.
 * `entered` is the EQR the entered EV gives, or `null` when there is none.
 */
export function explainPoolEqr(pool: { eqr: number; sampleSize: number }, entered: number | null): string {
  const measured = `Over ${count(pool.sampleSize)} decisions the field turns ${percent(pool.eqr, 0)} of what its equity is worth into pot share, so it ${realizationVerdict(pool.eqr)}.`;
  if (entered === null) return measured;
  const gap = pool.eqr - entered;
  const solution = `The solver EV you entered keeps ${percent(entered, 0)}`;
  if (Math.abs(gap) < EVEN_EQR_MARGIN) return `${measured} ${solution}, within ${gapInPoints(gap)} points of the field: the field realizes about as well as that solution does.`;
  return `${measured} ${solution}, so the field realizes ${gapInPoints(gap)} points ${gap > 0 ? 'more' : 'less'} than that solution.`;
}

/**
 * What the field took away after an action, exactly as the pool computes it: the chips won from
 * that point on (the hand's net with the chips already put in added back) as a share of the pot in
 * the middle. With the equity of the acting range that is an EQR; without one, the sentence says
 * what would give one.
 */
export function explainRealization(action: string, overall: RealizationRow, eqr: number | null): string {
  const n = count(overall.sample_size);
  const { realized, mean_net_bb: net, mean_pot_bb: pot } = overall;
  if (realized === null || net === null || pot === null) return `Only ${n} decisions here were a ${action}, too few to say what the field won afterwards.`;
  const share = `${realized < 0 ? 'lost' : 'won'} ${percent(Math.abs(realized))} of the ${num(pot)} bb pot`;
  const measured = `After a ${action} here the field ${share} from that point on: ${num(net)} bb per decision over ${n} decisions, with the chips it had already put in counted as the pot's, not as losses.`;
  if (eqr === null) return `${measured} That is not an EQR yet: work out the equity of the range that takes this ${action} here, and this share divided by that equity is one.`;
  return `${measured} Divided by that range's equity it is an EQR of ${num(eqr)}, so the range ${realizationVerdict(eqr)}.`;
}

/**
 * Step 3's comparison: the top-pair-or-better share of each range on this board and which one the
 * board hits harder. `hero` and `villain` name the ranges as they read mid-sentence ("your range").
 */
export function explainHitShares(heroShare: number, villainShare: number, hero: string, villain: string): string {
  const gap = heroShare - villainShare;
  const shares = `On this board ${percent(heroShare)} of ${hero} is top pair or better, against ${percent(villainShare)} of ${villain}`;
  if (Math.abs(gap) < EVEN_HIT_MARGIN) return `${shares}: within ${gapInPoints(gap)} points, it hits both about as hard, so neither side has more strong hands to lean on.`;
  return `${shares}: the board hits ${gap > 0 ? hero : villain} harder, by ${gapInPoints(gap)} points, so that side has more strong hands to bet for value.`;
}

/**
 * What to type when core would refuse these amounts, or `null` when it will take them. Checked
 * before core is called, so a reader never meets core's own wording ("pot must be positive, got 0"),
 * which is what the replayer's first step printed while only the blinds were in.
 */
export function explainOddsInputs(pot: number, bet: number, call: number = bet): string | null {
  if (!(pot > 0)) return 'There is no pot to work from: pot odds and MDF need a pot above zero, so type the pot that was in the middle before the bet.';
  if (!(bet >= 0)) return 'A bet cannot be less than zero: type the amount that was bet, or 0 if nobody has bet.';
  if (!(call >= 0)) return 'The amount to call cannot be less than zero: type what it costs to call.';
  return null;
}

/** A failure nobody foresaw, still shown (fail loudly) — in words first, core's detail after them. */
export function explainOddsFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Pot odds and MDF could not be worked out from these amounts; check each one you typed. The calculation said: ${detail}`;
}
