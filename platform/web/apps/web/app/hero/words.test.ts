/**
 * My game's prose, asserted as text.
 *
 * The one assertion worth explaining is the last: `ADJUSTED_WORDS` is read back against
 * `stats/registry/stats/money.yaml` itself, the way `families.test.ts` reads the dimension file.
 * The sentence claims to use the registry's own name for `ev_bb_per_100`, and a claim about
 * another file is only worth making if it breaks when that file moves.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Cell, ReportResult, Stat } from '../stats/api';
import { kpiTiles } from './kpis';
import { SERIES } from './winnings';
import { ADJUSTED_WORDS, WINNINGS_EMPTY, heroEmptyView, luckWords, seriesTerm, winningsCaption } from './words';

const STATS: Stat[] = [
  { code: 'hands', label: 'Hands', category: 'money', grain: 'hand', format: 'count', description: 'Hands dealt in.' },
  { code: 'bb_per_100', label: 'bb/100', category: 'money', grain: 'hand', format: 'per100', higher_is_better: true, description: 'Big blinds won per 100 hands.' },
  { code: 'ev_bb_per_100', label: 'EV bb/100', category: 'money', grain: 'hand', format: 'per100', higher_is_better: true, description: 'All-in adjusted big blinds won per 100 hands.' },
];

function result(cells: Record<string, Partial<Cell>>, hands = 19_802): ReportResult {
  return {
    hands,
    group_by: [],
    stats: [],
    rows: [
      {
        group: {},
        hands,
        cells: Object.fromEntries(
          Object.entries(cells).map(([code, over]) => [
            code,
            { value: 0, n: hands, baseline: null, baseline_n: null, delta: null, interval: null, ...over },
          ]),
        ),
      },
    ],
    cached: false,
  };
}

function tilesFor(cells: Record<string, Partial<Cell>>, hands = 19_802) {
  return kpiTiles(result(cells, hands), STATS, ['hands', 'bb_per_100', 'ev_bb_per_100']);
}

describe('luckWords', () => {
  it('says the pots paid less than the hands were worth, in the units on the tiles', () => {
    const words = luckWords(tilesFor({ bb_per_100: { value: -1.374 }, ev_bb_per_100: { value: 0.281 } }));
    expect(words).toContain('1.66 bb/100');
    expect(words).toContain('below');
    expect(words).toContain('paid less');
  });

  it('says the other direction just as plainly', () => {
    const words = luckWords(tilesFor({ bb_per_100: { value: 4.2 }, ev_bb_per_100: { value: 1.1 } }));
    expect(words).toContain('above');
    expect(words).toContain('paid more');
  });

  it('calls a rounding difference what it is rather than a run of luck', () => {
    const words = luckWords(tilesFor({ bb_per_100: { value: 0.4 }, ev_bb_per_100: { value: 0.2 } }));
    expect(words).toContain('about what they were worth');
  });

  it('has one name for the all-in adjusted rate, where the page used to have three', () => {
    // "all-in EV", "EV" and "EV bb/100" were three names for one number on one screen.
    const words = luckWords(tilesFor({ bb_per_100: { value: -1.374 }, ev_bb_per_100: { value: 0.281 } }));
    expect(words).toContain(ADJUSTED_WORDS);
    expect(words).not.toContain('all-in EV');
    expect(words.toLowerCase()).not.toContain('ev bb/100');
  });

  it('says nothing at all when either half is missing', () => {
    expect(luckWords(tilesFor({ bb_per_100: { value: null, n: 0 } }))).toBe('');
    expect(luckWords([])).toBe('');
  });

  it('says nothing over a sample too thin to carry a sentence', () => {
    // Eleven hands: both winrates −131.82, a gap of exactly 0.00, and a confident sentence
    // about nothing. `evGap` withholds it; this only has to not invent one.
    expect(luckWords(tilesFor({ bb_per_100: { value: -131.82, n: 11 }, ev_bb_per_100: { value: -131.82, n: 11 } }, 11))).toBe('');
  });
});

describe('winningsCaption', () => {
  it('names the four lines exactly as the legend names them', () => {
    const caption = winningsCaption();
    for (const series of SERIES) expect(caption).toContain(series.label);
  });

  it('carries no second name for the all-in adjusted line', () => {
    expect(winningsCaption()).toContain(SERIES[1]!.label);
    expect(winningsCaption()).not.toContain('EV is what');
  });

  it('still says what break-even is, since the plot cannot label it', () => {
    expect(winningsCaption()).toContain('break-even');
  });
});

describe('seriesTerm', () => {
  it('is the line’s own name and the sentence saying what it draws', () => {
    expect(seriesTerm(SERIES[0]!)).toEqual({ term: 'Actual', definition: SERIES[0]!.description });
  });
});

describe('WINNINGS_EMPTY', () => {
  it('names a page that exists instead of an action the app has never had', () => {
    expect(WINNINGS_EMPTY).toContain('Upload page');
    expect(WINNINGS_EMPTY).not.toContain('import a session');
  });
});

describe('heroEmptyView', () => {
  const NO_DATES = { from: '', to: '' };

  it('says nothing while there are hands to measure', () => {
    expect(heroEmptyView(19_802, NO_DATES)).toBeNull();
  });

  it('says nothing before the request has answered, which is the pending line’s business', () => {
    expect(heroEmptyView(null, NO_DATES)).toBeNull();
  });

  it('points a first run at the Upload page and nowhere else', () => {
    const view = heroEmptyView(0, NO_DATES)!;
    // Was 'Nothing is stored yet', which is false for the ADR-051 §7 case this branch also fires
    // on: a hero file whose seat did not resolve stores every hand and My game counts none.
    expect(view.lead).toContain('No hand of yours is counted yet');
    expect(view.lead).not.toContain('Nothing is stored');
    expect(view.body).toContain('Upload page');
    expect(view.actions.map((action) => action.to)).toEqual(['/upload']);
  });

  it('carries the seat warning the other two first-run states carry', () => {
    // The same sentence as `hands/emptyState.ts` and `reports/emptyState.ts`: the one reason a
    // count of zero can stand beside a full upload list.
    expect(heroEmptyView(0, NO_DATES)!.body).toContain('the Upload page says when a file had no seat recognised as yours');
  });

  it('blames the dates rather than the account when the dates are what is empty', () => {
    const view = heroEmptyView(0, { from: '2026-01-01', to: '2026-01-31' })!;
    expect(view.lead).toContain('in these dates');
    expect(view.actions.map((action) => action.key)).toEqual(['clear-dates', 'upload']);
  });
});

describe('the registry behind the words', () => {
  it('still calls ev_bb_per_100 what this page calls it', () => {
    const yaml = readFileSync(new URL('../../../../../stats/registry/stats/money.yaml', import.meta.url), 'utf8');
    const description = /- code: ev_bb_per_100[\s\S]*?\n {2}description: (.+)\n/.exec(yaml)?.[1] ?? '';
    expect(description).not.toBe('');
    expect(description.toLowerCase()).toContain(ADJUSTED_WORDS);
  });
});
