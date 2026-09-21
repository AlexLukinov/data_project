import { describe, expect, it } from 'vitest';

import type { Cell, ReportResult, Stat } from '../stats/api';
import { KPI_CODES, KPI_CONFIDENCE, evGap, kpiFormat, kpiRequest, kpiTiles, thinTerm } from './kpis';

function stat(over: Partial<Stat> & Pick<Stat, 'code'>): Stat {
  return { label: over.code, category: 'preflop', grain: 'hand', format: 'percent', ...over } as Stat;
}

const STATS: Stat[] = [
  stat({ code: 'hands', label: 'Hands', format: 'count' }),
  stat({ code: 'bb_per_100', label: 'bb/100', format: 'per100', higher_is_better: true, typical: [0, 10], description: 'Big blinds won per 100 hands.' }),
  stat({ code: 'ev_bb_per_100', label: 'EV bb/100', format: 'per100', higher_is_better: true }),
  stat({ code: 'vpip', label: 'VPIP', description: 'Voluntarily put money in the pot preflop.' }),
  stat({ code: 'pfr', label: 'PFR' }),
  stat({ code: 'threebet', label: '3-bet %', grain: 'decision' }),
  stat({ code: 'wtsd', label: 'WTSD' }),
  stat({ code: 'wsd', label: 'W$SD', higher_is_better: true }),
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

describe('kpiRequest', () => {
  it('asks for the interval, which is the whole reason E.2 came first', () => {
    expect(kpiRequest().confidence).toBe(KPI_CONFIDENCE);
  });

  it('asks the field the same question, so a tile is a judgement and not just a number', () => {
    const request = kpiRequest();
    expect(request.compare_to).toBe('population');
    // The server validates the pair together: compare_to needs the hero dataset, and the
    // population dataset needs hero_only false. Either alone is a 422.
    expect(request.dataset).toBe('hero');
    expect(request.hero_only).toBe(true);
  });

  it('is ungrouped — a KPI is the whole answer, not a row of one', () => {
    expect(kpiRequest().group_by).toEqual([]);
    expect(kpiRequest().stats).toEqual([...KPI_CODES]);
  });

  it('omits an empty date rather than sending an empty string the server must reject', () => {
    expect(kpiRequest({}).date_from).toBeUndefined();
    expect(kpiRequest({ from: '', to: '' }).date_to).toBeUndefined();
    expect(kpiRequest({ from: '2026-08-01', to: '2026-09-04' })).toMatchObject({
      date_from: '2026-08-01',
      date_to: '2026-09-04',
    });
  });

  it('stays inside the ceiling of forty stats the engine enforces', () => {
    expect(KPI_CODES.length).toBeLessThanOrEqual(40);
  });

  it('leaves out the aggression factor deliberately', () => {
    // `af_total` is the registry's only `ratio` — E.2 gives it no interval by name — and it is
    // `cached: false`, so asking for it would take the whole request off the daily rollup for a
    // tile that could never show a band.
    expect(KPI_CODES).not.toContain('af_total');
  });
});

describe('kpiFormat', () => {
  it('reads each format in its own unit and precision', () => {
    expect(kpiFormat(STATS[3]!)).toEqual({ unit: '%', digits: 1, signed: false });
    expect(kpiFormat(STATS[1]!)).toEqual({ unit: 'bb/100', digits: 2, signed: true });
    expect(kpiFormat(STATS[0]!)).toEqual({ unit: '', digits: 0, signed: false });
  });

  it('signs a winrate and nothing else — "+0.28" says something "+22.9%" does not', () => {
    expect(kpiFormat(STATS[2]!).signed).toBe(true);
    expect(kpiFormat(STATS[4]!).signed).toBe(false);
  });
});

describe('kpiTiles', () => {
  it('hands MetricValue the bounds the server sent, never a band of its own', () => {
    const tiles = kpiTiles(
      result({ vpip: { value: 22.96, n: 19_802, interval: { low: 22.38, high: 23.55, n: 19_802, level: 95, method: 'wilson' } } }),
      STATS,
      ['vpip'],
    );
    expect(tiles[0]).toMatchObject({ value: 22.96, low: 22.38, high: 23.55, level: 95, n: 19_802 });
  });

  it('shows a per-100 value with no band when the server withheld one', () => {
    // Under thirty hands `stats/interval.py` sends `interval: null` on purpose, rather than a
    // normal-quantile band that is six times too narrow.
    const tiles = kpiTiles(result({ bb_per_100: { value: -12.5, n: 11, interval: null } }, 11), STATS, ['bb_per_100']);
    expect(tiles[0]).toMatchObject({ value: -12.5, low: null, high: null, n: 11 });
  });

  it('drops a half-sent interval instead of rendering a tile that looks bandless', () => {
    const tiles = kpiTiles(
      result({ vpip: { value: 22.96, interval: { low: Number.NaN, high: 23.55, n: 10, level: 95, method: 'wilson' } } }),
      STATS,
      ['vpip'],
    );
    expect(tiles[0]!.low).toBeNull();
    expect(tiles[0]!.high).toBeNull();
  });

  it('never compares a count, whatever its sample', () => {
    const tiles = kpiTiles(
      result({ hands: { value: 19_802, n: 19_802, baseline: 54_443_958, baseline_n: 54_443_958, delta: -54_424_156 } }),
      STATS,
      ['hands'],
    );
    // The engine answers the subtraction dutifully; it is arithmetic, not information.
    expect(tiles[0]!.view.deltaText).toBe('');
    expect(tiles[0]!.view.baselineText).toBe('');
  });

  it('withholds a thin comparison but keeps the interval, which is the warning', () => {
    const tiles = kpiTiles(
      result({ threebet: { value: 0, n: 3, baseline: 8.1, baseline_n: 900_000, delta: -8.1, interval: { low: 0, high: 56.15, n: 3, level: 95, method: 'wilson' } } }),
      STATS,
      ['threebet'],
    );
    expect(tiles[0]!.view.thin).toBe(true);
    expect(tiles[0]!.view.deltaText).toBe('');
    expect(tiles[0]!.high).toBe(56.15);
  });

  it('passes n as null when there is no sample, because MetricValue would print "n = 0"', () => {
    const tiles = kpiTiles(result({ wsd: { value: null, n: 0 } }), STATS, ['wsd']);
    expect(tiles[0]!.n).toBeNull();
    expect(tiles[0]!.value).toBeNull();
  });

  it('carries the description from the registry rather than a phrase invented here', () => {
    const tiles = kpiTiles(result({ vpip: { value: 22.96 } }), STATS, ['vpip']);
    expect(tiles[0]!.term.term).toBe('VPIP');
    expect(tiles[0]!.term.definition).toContain('Voluntarily put money in the pot preflop.');
  });

  it('writes the typical band with a space before its unit', () => {
    // The tile used to build this string itself and wrote "Usually 0–10bb/100.", which is the
    // one place on the dashboard a number and its unit ran together.
    const tiles = kpiTiles(result({ bb_per_100: { value: 1.2 } }), STATS, ['bb_per_100']);
    expect(tiles[0]!.term.definition).toContain('Usually 0–10 bb/100.');
  });

  it('costs one tile, not the page, when the registry does not know a code', () => {
    const tiles = kpiTiles(result({}), STATS, ['vpip', 'invented_stat']);
    expect(tiles.map((tile) => tile.code)).toEqual(['vpip']);
  });

  it('renders every tile before the answer arrives, with no numbers in them', () => {
    const tiles = kpiTiles(null, STATS);
    expect(tiles).toHaveLength(KPI_CODES.length);
    expect(tiles.every((tile) => tile.value === null && tile.n === null)).toBe(true);
  });
});

describe('thinTerm', () => {
  it('says what "thin" means and which sample earned the word here', () => {
    const tiles = kpiTiles(
      result({ threebet: { value: 0, n: 3, baseline: 8.1, baseline_n: 900_000, delta: -8.1 } }),
      STATS,
      ['threebet'],
    );
    const term = thinTerm(tiles[0]!.view);
    expect(term.term).toBe('thin');
    expect(term.definition).toContain('too few times to compare');
    // The cell's own reason, which a generic definition cannot carry.
    expect(term.formula).toBe(tiles[0]!.view.note);
    expect(term.formula).not.toBe('');
  });

  it('carries no second line when the cell has no note to give', () => {
    const tiles = kpiTiles(result({ vpip: { value: 22.96 } }), STATS, ['vpip']);
    expect(thinTerm(tiles[0]!.view).formula).toBeUndefined();
  });
});

describe('evGap', () => {
  it('is the number the API does not send and the founder most wants', () => {
    const tiles = kpiTiles(
      result({ bb_per_100: { value: -1.374 }, ev_bb_per_100: { value: 0.281 } }),
      STATS,
      ['bb_per_100', 'ev_bb_per_100'],
    );
    expect(evGap(tiles)).toBeCloseTo(-1.655, 6);
  });

  it('is nothing at all when either half is missing', () => {
    const tiles = kpiTiles(result({ bb_per_100: { value: null, n: 0 } }), STATS, ['bb_per_100', 'ev_bb_per_100']);
    expect(evGap(tiles)).toBeNull();
  });

  it('is withheld on a thin sample, because a sentence is harder to discount than a number', () => {
    // Narrowed to one day of the founder's real history: eleven hands, both winrates −131.82,
    // and a gap of exactly 0.00 — from which the page would otherwise announce that the cards
    // had paid about what they were worth, over eleven hands, under eight dimmed tiles.
    const tiles = kpiTiles(
      result({ bb_per_100: { value: -131.82, n: 11 }, ev_bb_per_100: { value: -131.82, n: 11 } }, 11),
      STATS,
      ['bb_per_100', 'ev_bb_per_100'],
    );
    expect(tiles.every((tile) => tile.view.thin)).toBe(true);
    expect(evGap(tiles)).toBeNull();
  });
});
