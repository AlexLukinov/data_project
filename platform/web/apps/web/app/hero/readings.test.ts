/**
 * The hero readings, asserted as text.
 *
 * Every case here is a rule the sentence must not break rather than a sample of its wording: a
 * band that contains the field must not read as a difference, a stat with no better end must not
 * read as a fault, and a figure with nothing behind it must produce no sentence at all. The
 * wording itself is free to change; these assertions are about what it may claim.
 */

import { describe, expect, it } from 'vitest';

import type { Cell, Interval, ReportResult, Stat } from '../stats/api';
import type { Leak, Session, SessionsResult } from './api';
import { kpiTiles } from './kpis';
import { leakReading, sessionsReading, tileReading } from './readings';

const VPIP: Stat = {
  code: 'vpip',
  label: 'VPIP',
  category: 'preflop',
  grain: 'hand',
  format: 'percent',
  higher_is_better: null,
  description: 'Voluntarily put money in the pot preflop.',
};
const RATE: Stat = { ...VPIP, code: 'bb_per_100', label: 'bb/100', category: 'money', format: 'per100', higher_is_better: true };
const HANDS: Stat = { ...VPIP, code: 'hands', label: 'Hands', category: 'money', format: 'count', higher_is_better: null };

const STATS: Stat[] = [VPIP, RATE, HANDS];

/** A 95% Wilson band, the shape `stats/router.py` sends and `reports/cell.ts` keeps or drops. */
function band(low: number, high: number, n = 19_802): Interval {
  return { low, high, n, level: 95, method: 'wilson' };
}

function tileFor(code: string, cell: Partial<Cell>, hands = 19_802) {
  const result: ReportResult = {
    hands,
    group_by: [],
    stats: [],
    rows: [
      {
        group: {},
        hands,
        cells: { [code]: { value: 0, n: hands, baseline: null, baseline_n: null, delta: null, interval: null, ...cell } },
      },
    ],
    cached: false,
  };
  return kpiTiles(result, STATS, [code])[0]!;
}

describe('tileReading', () => {
  it('reads the field against the band rather than against the point estimate', () => {
    const tile = tileFor('vpip', {
      value: 22.6,
      baseline: 24.6,
      delta: -2.0,
      interval: band(22.0, 23.2),
    });
    expect(tileReading(tile)).toContain('outside your 95% band');
    expect(tileReading(tile)).toContain("24.6%");
  });

  it('refuses to call a gap a gap when the band contains the field', () => {
    const tile = tileFor('vpip', {
      value: 22.6,
      baseline: 24.6,
      delta: -2.0,
      interval: band(20.1, 25.4),
    });
    const words = tileReading(tile);
    expect(words).toContain('inside your 95% band');
    expect(words).toContain('cannot tell the two apart');
    expect(words).not.toContain('wider than');
  });

  it('calls a stat with no better end a difference, never a fault', () => {
    const tile = tileFor('vpip', { value: 22.6, baseline: 24.6, delta: -2.0, interval: band(22.0, 23.2) });
    expect(tileReading(tile)).toContain('a difference to explain rather than a fault to fix');
  });

  it('says which side of the field you are on where the registry commits to one', () => {
    const better = tileFor('bb_per_100', { value: 4.2, baseline: 1.1, delta: 3.1, interval: band(3.0, 5.4) });
    const worse = tileFor('bb_per_100', { value: -1.4, baseline: 1.1, delta: -2.5, interval: band(-2.4, -0.4) });
    expect(tileReading(better)).toContain('you are on it');
    expect(tileReading(worse)).toContain('the wrong side of the field');
  });

  it('withdraws the side it cannot claim when the band contains the field', () => {
    // The founder's own bb/100 on 2026-09-21: -1.37 with a band of +/-9.52 around it, against a
    // field of -7.54. The sentence used to say the two could not be told apart and then, in the
    // same breath, that he was on the better end of the stat.
    const tile = tileFor('bb_per_100', { value: -1.37, baseline: -7.54, delta: 6.16, interval: band(-10.89, 8.15) });
    const words = tileReading(tile);
    expect(words).toContain('cannot tell the two apart');
    expect(words).toContain('not settled by this many hands');
    expect(words).not.toContain('you are on it');
    expect(words).not.toContain('wrong side');
  });

  it('still says a stat has no better end even when nothing is settled', () => {
    const tile = tileFor('vpip', { value: 22.6, baseline: 22.8, delta: -0.2, interval: band(20.1, 25.4) });
    expect(tileReading(tile)).toContain('a difference to explain rather than a fault to fix');
  });

  it('claims nothing at all over a thin sample', () => {
    const tile = tileFor('vpip', { value: 6.67, n: 15, baseline: 35.18, delta: -28.5 }, 15);
    const words = tileReading(tile);
    expect(words).toContain('Too few measurements');
    expect(words).not.toContain('28.5');
    expect(words).not.toContain('wrong side');
  });

  it('says how much of the gap is unknown when no interval came back', () => {
    const tile = tileFor('vpip', { value: 22.6, baseline: 24.6, delta: -2.0 });
    const words = tileReading(tile);
    expect(words).toContain('−2.0 pts');
    expect(words).toContain('no confidence band behind it');
  });

  it('says nothing about a count, whose delta the grid withholds as arithmetic', () => {
    expect(tileReading(tileFor('hands', { value: 19_802, baseline: 9_036_302, delta: -9_016_500 }))).toBe('');
  });

  it('says nothing where nothing was measured', () => {
    expect(tileReading(tileFor('vpip', { value: null, n: 0, baseline: 24.6 }, 0))).toBe('');
  });
});

function leak(over: Partial<Leak> = {}): Leak {
  return {
    code: 'fold_to_cbet_flop',
    label: 'Fold to flop c-bet',
    category: 'postflop',
    value: 62,
    n: 1_204,
    baseline: 48,
    baseline_n: 2_104_882,
    delta: 14,
    score: 485.8,
    direction: 'above',
    typical: [40, 55],
    higher_is_better: false,
    ...over,
  };
}

describe('leakReading', () => {
  it('says which way the gap points, in words the row only colours', () => {
    const words = leakReading(leak());
    expect(words).toContain("62.0% against the field's 48.0%");
    expect(words).toContain('14.0 points above');
    expect(words).toContain('the wrong side of the field');
  });

  it('reads a gap the right way round when the registry says higher is better', () => {
    expect(leakReading(leak({ higher_is_better: true }))).toContain('you are on it');
  });

  it('calls a stat with no better end a difference, never a leak to fix', () => {
    const words = leakReading(leak({ higher_is_better: null }));
    expect(words).toContain('a difference to explain rather than a fault to fix');
  });

  it('says when a number is normal and the field is the unusual one', () => {
    // 50% is inside the 40–55% band while the field sits at 30% — a red gap that is not a leak.
    const words = leakReading(leak({ value: 50, baseline: 30, delta: 20 }));
    expect(words).toContain('inside the 40–55% this stat usually falls in');
    expect(words).toContain('the gap is to this field rather than to normal play');
  });

  it('places a number above or below its usual band when it is outside', () => {
    expect(leakReading(leak({ value: 62 }))).toContain('above the 40–55%');
    expect(leakReading(leak({ value: 22, delta: -26 }))).toContain('below the 40–55%');
  });

  it('says nothing about a band the registry does not commit to', () => {
    const words = leakReading(leak({ typical: null }));
    expect(words).not.toContain('usually falls in');
    expect(words).toContain('14.0 points above');
  });

  it('warns when the leak rests on fewer spots than the one floor the app uses', () => {
    expect(leakReading(leak({ n: 62 }))).toContain('a hint rather than a finding');
    expect(leakReading(leak({ n: 1_204 }))).not.toContain('a hint rather than a finding');
  });
});

function session(over: Partial<Session> = {}): Session {
  return {
    started_at: '2026-08-18T16:46:10',
    ended_at: '2026-08-18T18:10:10',
    minutes: 84,
    hands: 412,
    net_bb: 120,
    ev_bb: 96,
    bb_per_100: 29.1,
    sites: ['ggpoker'],
    stakes: ['NL10'],
    ...over,
  };
}

function sessionsResult(sessions: Session[], net: number): SessionsResult {
  return { gap_minutes: 30, hands: sessions.reduce((sum, s) => sum + s.hands, 0), net_bb: net, sessions };
}

describe('sessionsReading', () => {
  it('names the widest sittings either way', () => {
    const words = sessionsReading(sessionsResult([session({ net_bb: 212 }), session({ net_bb: -180.5 })], 31.5));
    expect(words).toContain('The best sitting made 212.00 bb');
    expect(words).toContain('the worst lost 180.50 bb');
  });

  it('says when one sitting swings wider than the whole result', () => {
    const words = sessionsReading(sessionsResult([session({ net_bb: 212 }), session({ net_bb: -180.5 })], 31.5));
    expect(words).toContain('a handful of sittings rather than a trend');
  });

  it('does not say that when the total is the wider number', () => {
    const words = sessionsReading(sessionsResult([session({ net_bb: 50 }), session({ net_bb: 40 })], 412.5));
    expect(words).not.toContain('a handful of sittings');
    expect(words).toContain('The best sitting made 50.00 bb');
  });

  it('counts the sittings too short to carry a rate', () => {
    const words = sessionsReading(sessionsResult([session(), session({ hands: 11, net_bb: -14.5 })], 105.5));
    expect(words).toContain('1 of them is under 30 hands');
    expect(words).toContain('the big blinds beside it are exact');
  });

  it('says every one of them where that is what is true', () => {
    const words = sessionsReading(sessionsResult([session({ hands: 11 }), session({ hands: 8 })], -4));
    expect(words).toContain('Every one of them is under 30 hands');
  });

  it('says nothing when nothing was played', () => {
    expect(sessionsReading(sessionsResult([], 0))).toBe('');
    expect(sessionsReading(sessionsResult([session({ hands: 0, net_bb: 0 })], 0))).toBe('');
  });

  it('calls a sitting that broke even exactly that', () => {
    expect(sessionsReading(sessionsResult([session({ net_bb: 0 })], 0))).toContain('finished level');
  });
});
