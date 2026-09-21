/**
 * The sentences that stand next to a key number (spec §13, audit §2.3). Each template is a pure
 * function of the computed values, so the tests pin the words to the numbers: every verdict both
 * ways, the margins either side of their boundary, and counts written the same on a ru-RU machine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RealizationRow } from '../src/estimate';
import type { EquityFigures } from '../src/explain';
import { explainEquity, explainHitShares, explainOddsFailure, explainOddsInputs, explainPoolEqr, explainRealization } from '../src/explain';

const NAMES = ['Hero', 'Villain'];
const DEFINITION = 'Equity is the share of the pot each would win if every hand went to showdown.';

/** Makes every locale-less `toLocaleString` answer as the founder's ru-RU machine would: `1 176`. */
function onRussianMachine(): void {
  const toLocaleString = Number.prototype.toLocaleString;
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (this: number, locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
    return toLocaleString.call(this, locales ?? 'ru-RU', options);
  });
}

function exact(equities: number[], work = 1176): EquityFigures {
  return { equities, exact: true, work };
}

function sampled(equities: number[], over: Partial<EquityFigures> = {}): EquityFigures {
  return { equities, exact: false, iterations: 50_000, confidence95: 0.4379, work: 50_000, ...over };
}

afterEach(() => vi.restoreAllMocks());

describe('explainEquity', () => {
  it('names who is ahead of an even split, and says every runout was counted', () => {
    expect(explainEquity(exact([0.6, 0.4]), NAMES)).toBe(
      `Hero is ahead: 60.0% against 40.0% for Villain, 10.0 points above an even split. ${DEFINITION} Every one of the 1,176 runouts was counted, so there is no sampling error.`,
    );
    expect(explainEquity(exact([0.35, 0.65]), NAMES)).toContain('Villain is ahead: 65.0% against 35.0% for Hero, 15.0 points above an even split.');
  });

  it('calls a near-even split a coin flip and gives a sample its margin of error', () => {
    expect(explainEquity(sampled([0.52, 0.48]), NAMES)).toBe(
      `Hero has 52.0% and Villain 48.0%: close to a coin flip, within 2.0 points of an even split. ${DEFINITION} These are estimated from 50,000 sampled runouts, accurate to ±0.44 points 19 times out of 20.`,
    );
  });

  it('draws the coin-flip line at the even-range margin', () => {
    expect(explainEquity(exact([0.529, 0.471]), NAMES)).toContain('close to a coin flip, within 2.9 points');
    expect(explainEquity(exact([0.531, 0.469]), NAMES)).toContain('Hero is ahead: 53.1% against 46.9% for Villain, 3.1 points above');
  });

  it('counts the samples when there is no iteration count or interval, and claims no accuracy', () => {
    const text = explainEquity(sampled([0.7, 0.3], { iterations: undefined, confidence95: undefined, work: 2000 }), NAMES);
    expect(text).toContain('These are estimated from 2,000 sampled runouts.');
    expect(text).not.toContain('±');
  });

  it('compares three players with an even share each, naming an unnamed seat by its number', () => {
    expect(explainEquity(exact([0.45, 0.32, 0.23]), NAMES)).toContain(
      'With 3 players an even share is 33.3%: Hero 45.0% (11.7 points above), Villain 32.0% (about even) and Player 3 23.0% (10.3 points below).',
    );
  });

  // The engine works the interval out for player 0 only. Two shares move together, so it reads as the
  // figures' accuracy; three do not, and claiming it for all three would be a number nobody computed.
  it('claims the sampling interval for both shares heads-up, and for the first player alone multiway', () => {
    expect(explainEquity(sampled([0.52, 0.48]), NAMES)).toContain('sampled runouts, accurate to ±0.44 points 19 times out of 20.');
    const multiway = explainEquity(sampled([0.45, 0.32, 0.23]), NAMES);
    expect(multiway).toContain("sampled runouts; Hero's share is accurate to ±0.44 points 19 times out of 20.");
    expect(multiway).not.toContain('These are estimated from 50,000 sampled runouts, accurate to');
  });

  it('writes a count of a thousand or more with a comma on a ru-RU machine', () => {
    onRussianMachine();
    expect(explainEquity(exact([0.6, 0.4]), NAMES)).toContain('the 1,176 runouts');
    expect(explainEquity(sampled([0.6, 0.4]), NAMES)).toContain('from 50,000 sampled runouts');
  });
});

describe('explainPoolEqr', () => {
  it('says which way the field leans, over how many decisions', () => {
    expect(explainPoolEqr({ eqr: 0.91, sampleSize: 1200 }, null)).toBe(
      'Over 1,200 decisions the field turns 91% of what its equity is worth into pot share, so it under-realizes: it folds or is bluffed off part of its share, as out-of-position and capped ranges are.',
    );
    expect(explainPoolEqr({ eqr: 1.2, sampleSize: 900 }, null)).toContain('turns 120% of what its equity is worth into pot share, so it over-realizes');
  });

  it('reads an EQR within the margin of 1 as realizing about its worth', () => {
    expect(explainPoolEqr({ eqr: 0.951, sampleSize: 900 }, null)).toContain('so it realizes about what its equity is worth.');
    expect(explainPoolEqr({ eqr: 0.949, sampleSize: 900 }, null)).toContain('so it under-realizes');
  });

  it('puts the field against the entered solution in points, both ways and within the margin', () => {
    expect(explainPoolEqr({ eqr: 0.91, sampleSize: 900 }, 0.84)).toContain('The solver EV you entered keeps 84%, so the field realizes 7.0 points more than that solution.');
    expect(explainPoolEqr({ eqr: 0.91, sampleSize: 900 }, 1)).toContain('keeps 100%, so the field realizes 9.0 points less than that solution.');
    expect(explainPoolEqr({ eqr: 0.91, sampleSize: 900 }, 0.88)).toContain('within 3.0 points of the field: the field realizes about as well as that solution does.');
  });

  it('says nothing about a solution when none was entered', () => {
    expect(explainPoolEqr({ eqr: 0.91, sampleSize: 900 }, null)).not.toContain('solution');
  });

  it('writes the decision count with a comma on a ru-RU machine', () => {
    onRussianMachine();
    expect(explainPoolEqr({ eqr: 0.91, sampleSize: 191_384 }, null)).toContain('Over 191,384 decisions');
  });
});

describe('explainRealization', () => {
  const overall: RealizationRow = { hand_class: '', sample_size: 3000, mean_net_bb: 2.4, mean_pot_bb: 8, realized: 0.3 };

  it('has no share to explain under the sample floor, and says so', () => {
    const thin: RealizationRow = { ...overall, sample_size: 41, mean_net_bb: null, mean_pot_bb: null, realized: null };
    expect(explainRealization('bet', thin, null)).toBe('Only 41 decisions here were a bet, too few to say what the field won afterwards.');
  });

  it('without an equity, names the step that would give an EQR and never prints one', () => {
    const text = explainRealization('bet', overall, null);
    expect(text).toBe(
      "After a bet here the field won 30.0% of the 8 bb pot from that point on: 2.4 bb per decision over 3,000 decisions, with the chips it had already put in counted as the pot's, not as losses. That is not an EQR yet: work out the equity of the range that takes this bet here, and this share divided by that equity is one.",
    );
    expect(text).not.toContain('EQR of');
  });

  it('with an equity, gives the EQR it implies and which way it leans', () => {
    expect(explainRealization('bet', overall, 1.2)).toContain("Divided by that range's equity it is an EQR of 1.2, so the range over-realizes");
    expect(explainRealization('call', overall, 0.8)).toContain('After a call here');
    expect(explainRealization('call', overall, 0.8)).toContain('EQR of 0.8, so the range under-realizes');
  });

  it('says the field lost when what it took away is below zero', () => {
    const losing: RealizationRow = { ...overall, mean_net_bb: -0.8, realized: -0.1 };
    expect(explainRealization('check', losing, null)).toContain('the field lost 10.0% of the 8 bb pot from that point on: -0.8 bb per decision');
  });

  it('writes the decision count with a comma on a ru-RU machine', () => {
    onRussianMachine();
    expect(explainRealization('bet', overall, null)).toContain('over 3,000 decisions');
  });
});

describe('explainHitShares', () => {
  it('names the range the board hits harder, and by how many points', () => {
    expect(explainHitShares(0.235, 0.3, 'your range', 'their range')).toBe(
      'On this board 23.5% of your range is top pair or better, against 30.0% of their range: the board hits their range harder, by 6.5 points, so that side has more strong hands to bet for value.',
    );
    expect(explainHitShares(0.4, 0.25, 'your range', 'their range')).toContain('the board hits your range harder, by 15.0 points');
  });

  it('calls a gap under the margin about as hard, and one over it harder', () => {
    expect(explainHitShares(0.2, 0.229, 'your range', 'their range')).toContain('within 2.9 points, it hits both about as hard');
    expect(explainHitShares(0.2, 0.231, 'your range', 'their range')).toContain('the board hits their range harder, by 3.1 points');
  });
});

describe('explainOddsInputs', () => {
  it('asks for a pot above zero instead of passing on core wording', () => {
    for (const pot of [0, -10, Number.NaN]) {
      const text = explainOddsInputs(pot, 50);
      expect(text).toContain('pot odds and MDF need a pot above zero, so type the pot that was in the middle before the bet');
      expect(text).not.toContain('must be positive');
    }
  });

  it('asks for a bet and a call of zero or more', () => {
    expect(explainOddsInputs(100, -5)).toContain('A bet cannot be less than zero');
    expect(explainOddsInputs(100, 50, -1)).toContain('The amount to call cannot be less than zero');
  });

  it('has nothing to say about amounts core accepts, a check included', () => {
    expect(explainOddsInputs(100, 50)).toBeNull();
    expect(explainOddsInputs(100, 0)).toBeNull();
    expect(explainOddsInputs(100, 50, 30)).toBeNull();
  });
});

describe('explainOddsFailure', () => {
  it('still shows an unforeseen failure, in words first and the detail after', () => {
    expect(explainOddsFailure(new RangeError('rake must be finite'))).toBe(
      'Pot odds and MDF could not be worked out from these amounts; check each one you typed. The calculation said: rake must be finite',
    );
    expect(explainOddsFailure('boom')).toMatch(/^Pot odds and MDF could not be worked out.*boom$/);
  });
});
