/**
 * "Explain the number" (spec §13): a plain-language sentence next to a key output, generated
 * from the computed values so the words and the numbers can never disagree.
 */

import type { DefendingSet, NutAdvantage, PotOddsFigures, RangeAdvantage } from '@poker/core';

import { num, percent } from './format';

/** Below this gap in mean equity neither range has a real advantage. */
export const EVEN_RANGE_MARGIN = 0.03;
/** A side "holds the nuts" from this share of the nut weight. */
export const NUT_EDGE = 0.6;

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

/** `source` names where the EV came from: "entered" (a solver number the user typed) or "pool". */
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
