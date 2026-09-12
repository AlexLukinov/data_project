import { describe, expect, it } from 'vitest';

import type { Session, SessionsResult } from './api';
import { THIN_HANDS, duration, sessionRow, sessionRows, sessionTotals, when } from './sessions';

function session(over: Partial<Session> = {}): Session {
  return {
    started_at: '2026-08-18T16:46:10',
    ended_at: '2026-08-18T17:47:54',
    minutes: 62,
    hands: 240,
    net_bb: 41.5,
    ev_bb: 38.25,
    bb_per_100: 17.29,
    sites: ['ggpoker'],
    stakes: ['NL10'],
    ...over,
  };
}

describe('duration', () => {
  it('reads minutes under an hour and hours above it', () => {
    expect(duration(1)).toBe('1m');
    expect(duration(59)).toBe('59m');
    expect(duration(60)).toBe('1h');
    expect(duration(84)).toBe('1h 24m');
    expect(duration(240)).toBe('4h');
  });
});

describe('when', () => {
  it('shows the clock the hand history recorded', () => {
    expect(when('2026-08-18T16:46:10')).toBe('18 Aug, 16:46');
  });

  it('does not shift a late-night session onto the next day', () => {
    // ClickHouse sends these zone-less. Handing the string to `new Date` would apply the
    // reader's own offset and move 23:50 in Moscow to the 19th for a reader in London.
    expect(when('2026-08-18T23:50:00')).toBe('18 Aug, 23:50');
  });

  it('says what it was given rather than inventing a date', () => {
    expect(when('rubbish')).toBe('rubbish');
  });
});

describe('sessionRow', () => {
  it('signs the money with a real minus sign, as the rest of the UI does', () => {
    expect(sessionRow(session({ net_bb: -14.5 })).netText).toBe('−14.50');
    expect(sessionRow(session({ net_bb: 41.5 })).netText).toBe('+41.50');
    expect(sessionRow(session({ net_bb: 0 })).netText).toBe('0.00');
  });

  it('withholds the rate of a sitting too short to have one', () => {
    // The real first session in the founder's history: eleven hands, −14.5 bb, and an
    // arithmetically correct −131.82 bb/100 that means nothing at all.
    const row = sessionRow(session({ hands: 11, minutes: 1, net_bb: -14.5, bb_per_100: -131.82 }));
    expect(row.thin).toBe(true);
    expect(row.rateText).toBe('');
    expect(row.note).toContain('too few');
  });

  it('keeps the exact numbers of a short sitting, because a count is not an estimate', () => {
    const row = sessionRow(session({ hands: 11, net_bb: -14.5 }));
    expect(row.handsText).toBe('11');
    expect(row.netText).toBe('−14.50');
  });

  it('prints the rate once the sample reaches the floor the engine uses', () => {
    expect(sessionRow(session({ hands: THIN_HANDS, bb_per_100: -12.5 })).rateText).toBe('−12.50');
    expect(sessionRow(session({ hands: THIN_HANDS - 1 })).rateText).toBe('');
  });

  it('colours only from the exact number, never from the withheld rate', () => {
    expect(sessionRow(session({ net_bb: 41.5 })).sense).toBe('good');
    expect(sessionRow(session({ net_bb: -14.5 })).sense).toBe('bad');
    expect(sessionRow(session({ net_bb: 0 })).sense).toBe('');
  });

  it('names where it was played, and both where a sitting spanned two', () => {
    expect(sessionRow(session()).where).toBe('ggpoker · NL10');
    expect(sessionRow(session({ stakes: ['NL10', 'NL25'] })).where).toBe('ggpoker · NL10, NL25');
    expect(sessionRow(session({ sites: [], stakes: [] })).where).toBe('—');
  });

  it('keys on the start, since a session is derived and has no id', () => {
    expect(sessionRow(session()).key).toBe('2026-08-18T16:46:10');
  });
});

describe('sessionRows', () => {
  it('puts the newest sitting first', () => {
    const rows = sessionRows([
      session({ started_at: '2026-08-18T16:46:10' }),
      session({ started_at: '2026-09-04T11:02:00' }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['2026-09-04T11:02:00', '2026-08-18T16:46:10']);
  });

  it('does not reorder the array it was given', () => {
    const input = [session({ started_at: 'a' }), session({ started_at: 'b' })];
    sessionRows(input);
    expect(input[0]!.started_at).toBe('a');
  });
});

describe('sessionTotals', () => {
  const result: SessionsResult = {
    gap_minutes: 30,
    hands: 19_802,
    net_bb: -272,
    sessions: [
      session({ hands: 240, net_bb: 41.5 }),
      session({ hands: 11, net_bb: -14.5 }),
      session({ hands: 500, net_bb: -299 }),
    ],
  };

  it('reports the totals the server sent rather than a sum of the rows', () => {
    // If the two ever disagree, the disagreement is worth seeing.
    expect(sessionTotals(result).handsText).toBe('19,802');
    expect(sessionTotals(result).netText).toBe('−272.00');
  });

  it('counts the winning sittings and says out of how many', () => {
    expect(sessionTotals(result).winningText).toBe('1 of 3 (33%)');
  });

  it('says what a session even is, because the gap decides it', () => {
    expect(sessionTotals(result).gapText).toContain('30m');
  });

  it('has no share to report when nothing was played', () => {
    expect(sessionTotals({ ...result, sessions: [] }).winningText).toBe('—');
  });
});
