/**
 * The pool's sentences, read as text (plan F.12c).
 *
 * Failure paths first: every one of these exists because a screen said nothing, or said something
 * that was false, when a load failed or a rule matched nobody.
 */
import { describe, expect, it } from 'vitest';

import type { Stat } from '../stats/api';
import { PLAYER_STATS } from './stats';
import {
  LIST_NOT_REREAD,
  NO_STATS_FOR_RULES,
  PLAYER_NO_ROWS,
  cohortsEmptyView,
  emptyMembersView,
  gridHeading,
  noPlayerWords,
  playerIntroWords,
  savedCohortsErrorWords,
  scopeErrorWords,
  shippedCohortsErrorWords,
  unknownCohortWords,
} from './words';

const stat = (code: string, label: string): Stat => ({ code, label }) as Stat;

describe('gridHeading', () => {
  it('names the cohort the picker chose', () => {
    expect(gridHeading('Regulars', false)).toBe('Regulars');
  });

  it('says the whole field only when the whole field is what ran', () => {
    expect(gridHeading(null, false)).toBe('The whole field');
  });

  /* `regs_by_position` carries a cohort in its own request, and it is sent when the picker names
     none — so this heading used to read "The whole field" over a slice of it. */
  it('does not claim the whole field when the report carries a rule of its own', () => {
    expect(gridHeading(null, true)).not.toContain('whole field');
  });
});

describe('scopeErrorWords', () => {
  it('keeps the reason, and does not read as “there are none”', () => {
    const words = scopeErrorWords('The API did not answer.');
    expect(words).toContain('The API did not answer.');
    expect(words).toContain('could not be loaded');
  });
});

describe('savedCohortsErrorWords', () => {
  it('says the list is short rather than empty, and why', () => {
    const words = savedCohortsErrorWords('The API did not answer.');
    expect(words).toContain('only the shipped ones');
    expect(words).toContain('The API did not answer.');
  });
});

describe('shippedCohortsErrorWords', () => {
  it('names the half that is missing, so the other half is not read as the whole list', () => {
    const words = shippedCohortsErrorWords('The API did not answer.');
    expect(words).toContain('only your own are listed');
    expect(words).toContain('The API did not answer.');
  });
});

describe('LIST_NOT_REREAD', () => {
  /* A refused save and a failed read-back look the same on screen and are opposites underneath. */
  it('says the change was saved, so nobody saves it twice', () => {
    expect(LIST_NOT_REREAD).toContain('was saved');
    expect(LIST_NOT_REREAD).toContain('read back');
  });
});

describe('unknownCohortWords', () => {
  it('names the key the link asked for and says nothing ran', () => {
    const words = unknownCohortWords('a3f1', false);
    expect(words).toContain('“a3f1”');
    expect(words).toContain('Nothing has run');
  });

  /* Either list can be the one that failed: `/pool?cohort=preset:regs` is the link this app writes
     for a *shipped* cohort, and those arrive with the presets — so a failed presets call must not
     be reported as a deletion, which the error above this sentence already contradicts. */
  it('blames the deletion only when both lists loaded, and the load when either did not', () => {
    expect(unknownCohortWords('a3f1', false)).toContain('deleted');
    expect(unknownCohortWords('preset:regs', true)).toContain('could not be loaded');
    expect(unknownCohortWords('preset:regs', true)).not.toContain('deleted');
  });
});

describe('playerIntroWords', () => {
  it('names the stats this page answers, in the registry’s own labels', () => {
    const words = playerIntroWords([stat('vpip', 'VPIP'), stat('bb_per_100', 'bb/100')]);
    expect(words).toContain('VPIP and bb/100');
  });

  it('leaves out a stat this page does not ask for', () => {
    expect(playerIntroWords([stat('vpip', 'VPIP'), stat('cbet_flop', 'C-bet flop')])).not.toContain('C-bet flop');
  });

  /* The registry can fail to load; the page still has to say what it is for. */
  it('still says what the page is for with no registry at all', () => {
    const words = playerIntroWords([]);
    expect(words).toContain('by screen name');
    expect(words).not.toContain('You get');
  });

  it('lists every stat the report actually runs when the registry is whole', () => {
    const whole = PLAYER_STATS.map((code) => stat(code, code.toUpperCase()));
    const words = playerIntroWords(whole);
    for (const code of PLAYER_STATS) expect(words).toContain(code.toUpperCase());
  });
});

describe('noPlayerWords', () => {
  it('quotes the search that ran, not the box', () => {
    expect(noPlayerWords('mang')).toContain('“mang”');
  });

  it('says where the names come from, so an empty answer is not read as a broken search', () => {
    expect(noPlayerWords('mang')).toContain('Pool hands');
  });
});

describe('PLAYER_NO_ROWS', () => {
  it('does not blame a situation, because this page has none', () => {
    expect(PLAYER_NO_ROWS).not.toContain('situation');
  });
});

describe('NO_STATS_FOR_RULES', () => {
  it('blames the registry rather than leaving an empty picker to speak for itself', () => {
    expect(NO_STATS_FOR_RULES).toContain('registry');
    expect(NO_STATS_FOR_RULES).toContain('Reload');
  });
});

describe('cohortsEmptyView', () => {
  it('offers the button by the label the page shows', () => {
    const view = cohortsEmptyView();
    expect(view.actions.map((action) => action.label)).toEqual(['New cohort']);
    expect(view.actions[0]?.key).toBe('new');
  });

  it('teaches what a cohort buys rather than saying “No cohorts.”', () => {
    expect(cohortsEmptyView().body).toContain('scoped');
  });
});

describe('emptyMembersView', () => {
  it('says nobody matches and how to loosen it', () => {
    const view = emptyMembersView();
    expect(view.lead).toContain('No player matches');
    expect(view.body).toContain('Edit');
  });

  /* Membership is counted from the daily statistics, so today's upload is not in it yet. */
  it('warns that membership lags the numbers beside it', () => {
    expect(emptyMembersView().body).toContain('recounted');
  });

  it('links to the pool rather than pretending this page can measure it', () => {
    expect(emptyMembersView().actions.find((action) => action.key === 'field')?.to).toBe('/pool');
  });
});
