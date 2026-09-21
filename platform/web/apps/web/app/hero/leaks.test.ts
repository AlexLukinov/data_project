/**
 * The leak → situation translation, against the registry's real entries.
 *
 * Every stat and dimension below is copied verbatim from `stats/registry/stats/*.yaml` and
 * `stats/registry/dimensions.yaml`, because the whole point of ADR-040 is that this module reads
 * the registry rather than restating it — a fixture invented here would test the wrong thing.
 * The round trip is asserted end to end: clauses out, URL, clauses back.
 */

import { describe, expect, it } from 'vitest';

import { clausesToNode } from '../filter/clause';
import { fromQuery } from '../filter/url';
import type { Dimension, Stat } from '../stats/api';
import type { Leak } from './api';
import { handsQuery, isDrillable, leakDrill, leakRows, ranked } from './leaks';

function dim(code: string, label: string, type: Dimension['type'], tables: Dimension['tables'], values: string[] = []): Dimension {
  return { code, label, type, tables, description: '', values, ops: null, group_by: true, buckets: {}, allowed_ops: type === 'bool' ? ['eq', 'ne'] : ['eq', 'in', 'ne', 'not_in'] };
}

const DIMS: ReadonlyMap<string, Dimension> = new Map([
  ['street', dim('street', 'Street', 'enum', ['decisions'], ['preflop', 'flop', 'turn', 'river'])],
  ['facing', dim('facing', 'Facing', 'enum', ['decisions'], ['none', 'bet', 'raise', 'limp'])],
  ['facing_is_cbet', dim('facing_is_cbet', 'Facing a c-bet', 'bool', ['decisions'])],
  ['position', dim('position', 'Position', 'enum', ['decisions', 'player_hands', 'stats_daily'], ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'UNKNOWN'])],
  ['action', dim('action', 'Action', 'enum', ['decisions'], ['fold', 'check', 'call', 'bet', 'raise'])],
  ['saw_flop', dim('saw_flop', 'Saw the flop', 'bool', ['player_hands'])],
  ['did_vpip', dim('did_vpip', 'Voluntarily put money in', 'bool', ['player_hands'])],
  ['won_hand', dim('won_hand', 'Won the hand', 'bool', ['decisions', 'player_hands'])],
]);

function stat(code: string, label: string, grain: Stat['grain'], situation: Stat['situation'], action: Stat['action']): Stat {
  return { code, label, category: 'postflop', grain, format: 'percent', situation, action };
}

/** `fold_to_cbet_flop` — the ordinary case: a flat AND of three leaves, all on `decisions`. */
const FOLD_TO_CBET = stat('fold_to_cbet_flop', 'Fold to c-bet flop', 'decision', {
  all: [
    { dim: 'street', op: 'eq', value: 'flop' },
    { dim: 'facing', op: 'eq', value: 'bet' },
    { dim: 'facing_is_cbet', op: 'eq', value: 1 },
  ],
}, { dim: 'action', op: 'eq', value: 'fold' });

/** `steal` — the same shape with a list value, which the URL has to survive. */
const STEAL = stat('steal', 'Steal %', 'decision', {
  all: [
    { dim: 'street', op: 'eq', value: 'preflop' },
    { dim: 'facing', op: 'eq', value: 'none' },
    { dim: 'position', op: 'in', value: ['CO', 'BTN', 'SB'] },
  ],
}, { dim: 'action', op: 'eq', value: 'raise' });

/** `vpip` — every hand dealt in, so there is no spot. */
const VPIP = stat('vpip', 'VPIP', 'hand', { all: [] }, { dim: 'did_vpip', op: 'eq', value: 1 });

/** `wwsf` — a bare leaf (not wrapped in `all`), and on a hand-grain dimension. */
const WWSF = stat('wwsf', 'WWSF', 'hand', { dim: 'saw_flop', op: 'eq', value: 1 }, { dim: 'won_hand', op: 'eq', value: 1 });

function leak(code: string, label: string, extra: Partial<Leak> = {}): Leak {
  return { code, label, category: 'postflop', value: 62, n: 1940, baseline: 48, baseline_n: 900000, delta: 14, score: 616.7, direction: 'above', ...extra };
}

describe('leakDrill', () => {
  it('opens the spot and the action for an ordinary decision-grain leak', () => {
    const drill = leakDrill(leak('fold_to_cbet_flop', 'Fold to c-bet flop'), FOLD_TO_CBET, DIMS);
    expect(drill.blocked).toBe('');
    expect(drill.spot).toEqual([
      { dim: 'street', op: 'eq', values: ['flop'] },
      { dim: 'facing', op: 'eq', values: ['bet'] },
      { dim: 'facing_is_cbet', op: 'eq', values: ['1'] },
    ]);
    // `taken` is the spot plus the action — the hands where the leak actually happened.
    expect(drill.taken).toEqual([...drill.spot!, { dim: 'action', op: 'eq', values: ['fold'] }]);
    expect(isDrillable(drill)).toBe(true);
  });

  it('keeps a list value whole', () => {
    const drill = leakDrill(leak('steal', 'Steal %'), STEAL, DIMS);
    expect(drill.spot).toContainEqual({ dim: 'position', op: 'in', values: ['CO', 'BTN', 'SB'] });
  });

  it('compiles back to the tree the stat was defined with', () => {
    // The strongest assertion here: the clauses are not merely plausible, they recompile to the
    // registry's own `situation`, so the list answers the question the leak was scored on.
    const drill = leakDrill(leak('fold_to_cbet_flop', 'Fold to c-bet flop'), FOLD_TO_CBET, DIMS);
    expect(clausesToNode(drill.spot!, DIMS)).toEqual(FOLD_TO_CBET.situation);
    expect(clausesToNode(drill.taken!, DIMS)).toEqual({ all: [...(FOLD_TO_CBET.situation as { all: unknown[] }).all, FOLD_TO_CBET.action] });
  });

  it('refuses a stat measured over every hand, rather than linking to everything', () => {
    // A link with no conditions would silently inherit whatever situation the store held — the
    // one failure mode worse than no link at all.
    const drill = leakDrill(leak('vpip', 'VPIP'), VPIP, DIMS);
    expect(drill.spot).toBeNull();
    expect(drill.taken).toBeNull();
    expect(drill.blocked).toContain('measured over every hand dealt in');
    expect(isDrillable(drill)).toBe(false);
  });

  it('refuses a hand-grain dimension, naming it, because a hand search compiles on decisions', () => {
    const drill = leakDrill(leak('wwsf', 'WWSF'), WWSF, DIMS);
    expect(drill.spot).toBeNull();
    expect(drill.blocked).toContain('counted per hand rather than per decision');
    expect(drill.blocked).toContain('Saw the flop');
  });

  it('still opens the spot when only the action is out of reach', () => {
    // `went_to_showdown` is on both marts and `did_vpip` is not, so the spot survives and the
    // narrower link does not. A weaker answer, never a wrong one.
    const showdown = stat('wsd_like', 'Won at showdown', 'hand', { dim: 'won_hand', op: 'eq', value: 1 }, { dim: 'did_vpip', op: 'eq', value: 1 });
    const drill = leakDrill(leak('wsd_like', 'Won at showdown'), showdown, DIMS);
    expect(drill.spot).toEqual([{ dim: 'won_hand', op: 'eq', values: ['1'] }]);
    expect(drill.taken).toBeNull();
    expect(drill.blocked).toBe('');
  });

  it('refuses an `any`, which a flat clause list cannot hold', () => {
    const either = stat('either', 'Either', 'decision', { any: [{ dim: 'street', op: 'eq', value: 'flop' }, { dim: 'street', op: 'eq', value: 'turn' }] }, { dim: 'action', op: 'eq', value: 'bet' });
    expect(leakDrill(leak('either', 'Either'), either, DIMS).blocked).toContain('not a plain list of conditions');
  });

  it('says so when the registry this session loaded has no such stat', () => {
    expect(leakDrill(leak('ghost', 'Ghost'), undefined, DIMS).blocked).toContain('not in the registry');
  });
});

describe('handsQuery', () => {
  it('is D.3\'s encoding, and survives the round trip exactly', () => {
    const drill = leakDrill(leak('steal', 'Steal %'), STEAL, DIMS);
    const query = handsQuery(drill.taken!);
    expect(query.f).toBe('street:eq:preflop;facing:eq:none;position:in:CO,BTN,SB;action:eq:raise');
    // `hero` is the default dataset, so `toQuery` leaves it implicit — and `fromQuery` restores it.
    expect(query.ds).toBeUndefined();
    const back = fromQuery(query);
    expect(back.dataset).toBe('hero');
    expect(back.clauses).toEqual(drill.taken);
  });

  it('carries the dates the leaks were asked over', () => {
    const drill = leakDrill(leak('steal', 'Steal %'), STEAL, DIMS);
    const query = handsQuery(drill.spot!, { from: '2026-01-01', to: '2026-06-30' });
    expect(query.from).toBe('2026-01-01');
    expect(query.to).toBe('2026-06-30');
    expect(fromQuery(query).dateFrom).toBe('2026-01-01');
  });
});

describe('ranked', () => {
  it('puts the worst leak first without mutating the answer', () => {
    const leaks = [leak('a', 'A', { score: 10 }), leak('b', 'B', { score: 90 }), leak('c', 'C', { score: 50 })];
    expect(ranked(leaks).map((l) => l.code)).toEqual(['b', 'c', 'a']);
    expect(leaks.map((l) => l.code)).toEqual(['a', 'b', 'c']);
  });
});

describe('leakRows', () => {
  const STATS: ReadonlyMap<string, Stat> = new Map([
    ['fold_to_cbet_flop', { ...FOLD_TO_CBET, description: 'Folded facing the preflop aggressor’s flop bet.', typical: [40, 55] } as Stat],
    ['vpip', VPIP],
  ]);

  it('explains a leak in the registry’s own words, which the response does not carry', () => {
    // `/v1/hero/leaks` sends a label and no description at all, so the sentence has to be looked
    // up against the registry this session loaded.
    const rows = leakRows([leak('fold_to_cbet_flop', 'Fold to c-bet flop')], STATS, DIMS);
    expect(rows[0]!.term.term).toBe('Fold to c-bet flop');
    expect(rows[0]!.term.definition).toContain('Folded facing the preflop aggressor');
    expect(rows[0]!.term.definition).toContain('Usually 40–55%.');
  });

  it('still names a stat the registry does not serve, and says it is unknown', () => {
    const rows = leakRows([leak('ghost', 'Ghost %')], STATS, DIMS);
    expect(rows[0]!.term.term).toBe('Ghost %');
    expect(rows[0]!.term.definition).toContain('not in the registry');
    expect(rows[0]!.drill.blocked).not.toBe('');
    expect(rows[0]!.spotQuery).toBeNull();
  });

  it('reads the category rather than printing the code the API sends', () => {
    const rows = leakRows([leak('fold_to_cbet_flop', 'Fold to c-bet flop', { category: 'preflop' })], STATS, DIMS);
    expect(rows[0]!.category).toBe('Preflop');
  });

  it('carries the dates into both doors, so a leak and its hands answer the same question', () => {
    const rows = leakRows([leak('fold_to_cbet_flop', 'Fold to c-bet flop')], STATS, DIMS, { from: '2026-01-01' });
    expect(rows[0]!.spotQuery!.from).toBe('2026-01-01');
    expect(rows[0]!.takenQuery!.from).toBe('2026-01-01');
  });

  it('offers no door where the leak cannot be opened, worst leak first', () => {
    const rows = leakRows(
      [leak('vpip', 'VPIP', { score: 10 }), leak('fold_to_cbet_flop', 'Fold to c-bet flop', { score: 90 })],
      STATS,
      DIMS,
    );
    expect(rows.map((row) => row.leak.code)).toEqual(['fold_to_cbet_flop', 'vpip']);
    expect(rows[1]!.spotQuery).toBeNull();
    expect(rows[1]!.takenQuery).toBeNull();
  });
});
