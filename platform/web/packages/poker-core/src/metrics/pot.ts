/**
 * Pot odds and sizing arithmetic (spec §8), each a pure function of the amounts in the pot.
 * Amounts are in one unit (big blinds or chips) and must be consistent within a call.
 *
 *   MDF            = pot / (pot + bet)             the share of a range that must continue
 *   alpha          = bet / (pot + bet)             how often a bluff must work; MDF + alpha = 1
 *   requiredEquity = call / (pot + bet + call)     to break even on a call
 *                  = bet / (pot + 2·bet)           when the call equals the bet
 *   bluffs : value = bet / (pot + bet)             the balanced ratio for a bet size (see below)
 *
 * On the last line: villain breaks even calling with equity bet/(pot+2·bet), so hero's bluffs
 * must be that fraction of hero's betting range — bluffs/(value+bluffs) = bet/(pot+2·bet),
 * i.e. bluffs/value = bet/(pot+bet) = alpha. A pot-size bet gives 1 : 2, as the spec's §15.8
 * says; the spec's other form, alpha/(1−alpha), would give 1 : 1 there, so this file follows
 * the derivation and the example.
 *
 * Rake: `RakeConfig` is a percentage of the pot with a cap; the adjusted figures assume the
 * rake comes out of the pot the winner takes, whichever way the hand ends.
 */

export interface RakeConfig {
  /** 0.05 for 5%. */
  readonly rakePct: number;
  /** Maximum rake in the same unit as the pot; `null` for no cap. */
  readonly rakeCapBB: number | null;
}

export const NO_RAKE: RakeConfig = { rakePct: 0, rakeCapBB: null };

function positive(name: string, value: number): void {
  if (!(value > 0)) throw new RangeError(`${name} must be positive, got ${value}`);
}

function nonNegative(name: string, value: number): void {
  if (!(value >= 0)) throw new RangeError(`${name} must be zero or more, got ${value}`);
}

/** The rake taken from a pot of this size. */
export function rakeTaken(pot: number, rake: RakeConfig): number {
  nonNegative('pot', pot);
  const uncapped = pot * rake.rakePct;
  return rake.rakeCapBB === null ? uncapped : Math.min(uncapped, rake.rakeCapBB);
}

/** The pot after rake. */
export function effectivePot(pot: number, rake: RakeConfig): number {
  return pot - rakeTaken(pot, rake);
}

export function mdf(pot: number, bet: number): number {
  positive('pot', pot);
  nonNegative('bet', bet);
  return pot / (pot + bet);
}

export function alpha(pot: number, bet: number): number {
  positive('pot', pot);
  nonNegative('bet', bet);
  return bet / (pot + bet);
}

/** Equity needed to call `call` when the pot holds `pot` plus the bet just made. */
export function requiredEquity(call: number, pot: number, bet: number): number {
  positive('pot', pot);
  nonNegative('bet', bet);
  nonNegative('call', call);
  return call === 0 ? 0 : call / (pot + bet + call);
}

/** Equity needed to call a bet of `bet` into `pot`. */
export function requiredEquityFacingBet(pot: number, bet: number): number {
  return requiredEquity(bet, pot, bet);
}

/** How often a bluff of `bet` into `pot` must succeed. */
export function bluffBreakeven(pot: number, bet: number): number {
  return alpha(pot, bet);
}

/** Bluff combos per value combo that make villain indifferent to calling `bet` into `pot`. */
export function balancedBluffRatio(pot: number, bet: number): number {
  return alpha(pot, bet);
}

export interface OddsRatio {
  /** `(pot + bet) / bet`: the "3.2" in "3.2 : 1". Infinity when there is no bet. */
  readonly toOne: number;
  readonly text: string;
}

export function oddsRatio(pot: number, bet: number): OddsRatio {
  positive('pot', pot);
  nonNegative('bet', bet);
  if (bet === 0) return { toOne: Number.POSITIVE_INFINITY, text: 'free' };
  const toOne = (pot + bet) / bet;
  return { toOne, text: `${formatRatio(toOne)} : 1` };
}

function formatRatio(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Required equity when hero expects to win `impliedExtra` more on later streets after hitting.
 * An estimate: `impliedExtra` is the caller's guess, and the UI must say so.
 */
export function impliedOddsEquity(call: number, pot: number, bet: number, impliedExtra: number): number {
  nonNegative('impliedExtra', impliedExtra);
  positive('pot', pot);
  nonNegative('bet', bet);
  nonNegative('call', call);
  return call === 0 ? 0 : call / (pot + bet + call + impliedExtra);
}

export interface PotOddsFigures {
  readonly pot: number;
  readonly bet: number;
  readonly call: number;
  readonly mdf: number;
  readonly alpha: number;
  readonly requiredEquity: number;
  readonly bluffBreakeven: number;
  readonly bluffsPerValue: number;
  readonly odds: OddsRatio;
}

function figures(pot: number, bet: number, call: number, rake: RakeConfig): PotOddsFigures {
  // The bettor wins `pot` (raked) if hero folds; a caller wins pot + bet (raked) net of the call.
  const potIfFold = effectivePot(pot, rake);
  const potIfCall = effectivePot(pot + bet + call, rake) - call;
  return {
    pot,
    bet,
    call,
    mdf: potIfFold / (potIfFold + bet),
    alpha: bet / (potIfFold + bet),
    requiredEquity: call === 0 ? 0 : call / (potIfCall + call),
    bluffBreakeven: bet / (potIfFold + bet),
    bluffsPerValue: bet / (potIfFold + bet),
    odds: call === 0 ? { toOne: Number.POSITIVE_INFINITY, text: 'free' } : { toOne: potIfCall / call, text: `${formatRatio(potIfCall / call)} : 1` },
  };
}

/** Every pot-odds figure, raw and rake-adjusted side by side (spec §8: always show both). */
export function potOdds(pot: number, bet: number, call: number = bet, rake: RakeConfig = NO_RAKE): { raw: PotOddsFigures; rakeAdjusted: PotOddsFigures } {
  positive('pot', pot);
  nonNegative('bet', bet);
  nonNegative('call', call);
  return { raw: figures(pot, bet, call, NO_RAKE), rakeAdjusted: figures(pot, bet, call, rake) };
}
