import { describe, expect, it } from 'vitest';

import type { Stat } from '../stats/api';
import { grainNote } from './grain';

function stat(code: string, label: string, grain: Stat['grain']): Stat {
  return { code, label, category: 'preflop', grain, format: 'percent' };
}

const REGISTRY = [
  stat('hands', 'Hands', 'hand'),
  stat('bb_per_100', 'bb/100', 'hand'),
  stat('vpip', 'VPIP', 'hand'),
  stat('wtsd', 'WTSD', 'hand'),
  stat('cbet_flop', 'C-bet flop', 'decision'),
];

describe('grainNote', () => {
  it('says nothing while a per-hand stat still fits the situation', () => {
    expect(grainNote(['decisions', 'player_hands', 'stats_daily'], REGISTRY)).toBeNull();
    expect(grainNote(['player_hands'], REGISTRY)).toBeNull();
  });

  it('names three stats the situation rules out, in the registry’s own labels and order', () => {
    const note = grainNote(['decisions'], REGISTRY);
    expect(note?.lead).toContain('Hands, bb/100 and VPIP');
    expect(note?.lead).toContain('counted once per hand');
    expect(note?.term).toMatchObject({ term: 'grain' });
    expect(note?.tail).toBe('.');
  });

  /** The old sentence said "Decision-grain only: hand-grain stats" — two words of ours, not English. */
  it('drops the word the codebase invented', () => {
    expect(grainNote(['decisions'], REGISTRY)?.lead).not.toContain('grain stats');
  });

  /**
   * A registry that has not loaded, or a server that serves only decision stats: the note is still
   * a sentence, never one with a dangling dash where the examples should have been.
   */
  it('still reads when the registry names no per-hand stat', () => {
    const note = grainNote(['decisions'], [stat('cbet_flop', 'C-bet flop', 'decision')]);
    expect(note?.lead).toContain('so a stat counted once per hand cannot be measured here');
    expect(note?.lead).not.toContain('—');
  });

  /**
   * The Player column is held on `stats_daily` alone (dimensions.yaml). The old note then claimed
   * the columns were "recorded on a decision" and that only per-hand stats were ruled out; neither
   * is true there, so this situation gets its own sentence rather than the decision one.
   */
  it('does not call the daily statistics a decision, nor rule out only the per-hand stats', () => {
    const note = grainNote(['stats_daily'], REGISTRY);
    expect(note?.lead).toBe('This situation is answered on the daily statistics, where no stat is counted, so nothing can be measured here.');
    expect(note?.lead).not.toContain('recorded on a decision');
    expect(note?.term).toBeNull();
  });

  it('says the columns contradict each other when no table holds them all', () => {
    expect(grainNote([], REGISTRY)).toEqual({
      lead: 'No table holds all of these columns at once — this situation cannot be measured.',
      term: null,
      tail: '',
    });
  });
});
