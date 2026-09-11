/**
 * The glossary (spec §13): one plain-language sentence and the formula for every metric the
 * components label, kept in one place so a tooltip reads the same everywhere. `MetricLabel`
 * takes a `GlossaryKey`, so a label without an entry does not typecheck.
 */

export interface GlossaryEntry {
  /** The label as it appears in a panel. */
  readonly term: string;
  /** One sentence in plain language. */
  readonly definition: string;
  /** The formula, or how the number is obtained when there is no formula. */
  readonly formula: string;
}

export const GLOSSARY = {
  potOdds: { term: 'Pot odds', definition: 'What the pot offers for the price of a call, as a ratio.', formula: '(pot + bet) : call' },
  requiredEquity: { term: 'Required equity', definition: 'The share of the pot you must win on average for a call to break even.', formula: 'call / (pot + bet + call)' },
  mdf: { term: 'MDF', definition: 'Minimum defence frequency: the share of your range that must continue so a bluff with any two cards cannot profit.', formula: 'pot / (pot + bet)' },
  alpha: { term: 'Alpha', definition: 'How often a bluff must make the opponent fold to break even; MDF and alpha add up to 1.', formula: 'bet / (pot + bet)' },
  bluffBreakeven: { term: 'Bluff break-even', definition: 'The fold rate at which a bluff of this size neither wins nor loses money.', formula: 'bet / (pot + bet)' },
  bluffsPerValue: { term: 'Bluffs per value bet', definition: 'The bluff combos per value combo that leave the opponent indifferent to calling this size.', formula: 'bet / (pot + bet)' },
  impliedOdds: { term: 'Implied odds', definition: 'Required equity when you expect to win more on later streets after hitting; an estimate, only as good as the extra amount you assume.', formula: 'call / (pot + bet + call + extra)' },
  rake: { term: 'Rake', definition: 'The share of the pot the site keeps, up to a cap; rake-adjusted figures take it out of the pot you would win.', formula: 'min(pot × rake %, cap)' },
  equity: { term: 'Equity', definition: 'The share of the pot a hand or a range wins on average when every remaining card is dealt.', formula: '(wins + ties / 2) / runouts' },
  ev: { term: 'EV', definition: 'Expected value: the average amount a line wins or loses over every runout and every answer from the opponent.', formula: 'equity × EQR × pot' },
  eqr: { term: 'EQR', definition: 'Equity realization: how much of its raw equity a hand turns into pot share when it is played out; above 1 it over-realizes, below 1 it under-realizes.', formula: 'EV / (pot × equity)' },
  rangeAdvantage: { term: 'Range advantage', definition: 'How much better one whole range does against the other, as the gap between their average equities.', formula: 'mean equity (hero) − mean equity (villain)' },
  meanEquity: { term: 'Mean equity', definition: 'The average equity of the combos in a range, each counted by its weight.', formula: 'Σ weight × equity / Σ weight' },
  medianEquity: { term: 'Median equity', definition: 'The equity with half of the range weight below it and half above.', formula: 'weighted 50th percentile of equity' },
  equityBuckets: { term: 'Equity buckets', definition: 'The share of each range in each 20-point band of equity, drawn opposed so the two shapes can be compared.', formula: 'weight in [a, b) / total weight' },
  equityDistribution: { term: 'Equity distribution', definition: 'Every combo from the strongest to the weakest, against how much of the range is at least that strong.', formula: 'sort by equity; x = cumulative weight share, y = equity' },
  nutAdvantage: { term: 'Nut advantage', definition: 'Who holds more of the strongest hands; it drives bet sizing more than average equity does.', formula: 'nut weight (hero) / nut weight (both)' },
  nutThreshold: { term: 'Nut threshold', definition: 'The equity from which a combo counts as nutted: a fixed cutoff, or where the top share of both ranges together begins.', formula: 'cutoff (default 80%), or the top N% (default 5%) of the combined distribution' },
  nutShare: { term: 'Nut share', definition: 'The part of one range that is at or above the nut threshold.', formula: 'nut weight / range weight' },
  defendingSet: { term: 'Defending set', definition: 'The strongest combos of a range that add up to its MDF, assuming it defends its best equity first.', formula: 'top combos by equity until weight ≥ MDF × range weight' },
  blockerScore: { term: 'Blocker score', definition: 'How much of the opponent calling range a hand removes minus how much of the folding range, so a high score makes a better bluff.', formula: 'removed calls − removed folds' },
  valueScore: { term: 'Value score', definition: 'How much of the opponent folding range a hand removes minus how much of the calling range, so a high score makes a better thin value bet.', formula: 'removed folds − removed calls' },
  reconstructedRange: { term: 'Reconstructed range', definition: 'A range you supplied, reweighted by what the field does with each class of hand here; the only pool figure that is estimated rather than counted, so it is always shown against what tier 1 observed.', formula: 'P(hand | action) ∝ P(action | hand) × P(hand)' },
  likelihoodRatio: { term: 'How much a hand moves', definition: 'How over-represented a class is among the hands that took this action, against how often it appears here at all; 1 means it does exactly what the node does on average.', formula: 'share of the action’s shown hands / share of all shown hands' },
  poolRealization: { term: 'Realized (pool)', definition: 'What the field actually took away from this point on, as a share of the pot it was playing for; measured rather than solved, and divided by equity it gives EQR.', formula: '(net won + already invested) / pot' },
  exact: { term: 'Exact', definition: 'Every remaining runout was enumerated, so the number has no sampling error.', formula: 'all runouts of the cards to come' },
  monteCarlo: { term: 'Monte Carlo', definition: 'Random runouts were sampled; the ± figure is the 95% confidence interval of the estimate.', formula: 'n samples; ± 1.96 × standard error' },
  confidenceInterval: { term: 'Confidence interval', definition: 'The range the true figure would fall in for this share of samples this size, so a number over few hands is shown as the wide claim it is.', formula: 'a rate: Wilson score; a per-100 amount: ± 1.96 × sd / √n' },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export const GLOSSARY_KEYS = Object.keys(GLOSSARY) as GlossaryKey[];

/** The terms spec §13 names outright; a test asserts each has an entry. */
export const REQUIRED_TERMS: readonly GlossaryKey[] = ['mdf', 'alpha', 'eqr', 'nutAdvantage', 'blockerScore', 'rangeAdvantage'];
