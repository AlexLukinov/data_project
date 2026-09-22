/**
 * The pool's sentences, read as text (plan F.12c).
 *
 * Failure paths first: every one of these exists because a screen said nothing, or said something
 * that was false, when a load failed or a rule matched nobody.
 */
import { describe, expect, it } from 'vitest';

import type { StatMeta } from '../stats/api';
import {
  LIST_NOT_REREAD,
  NO_STATS_FOR_RULES,
  PLAYER_NO_ROWS,
  cohortsEmptyView,
  emptyMembersView,
  gridHeading,
  matchedWords,
  noPlayerWords,
  playerIntroWords,
  savedCohortsErrorWords,
  scopeErrorWords,
  shippedCohortsErrorWords,
  unknownCohortWords,
} from './words';

/** A stat as a *result* carries it: the lookup sends these back with every answer. */
const shown = (code: string, label: string): StatMeta => ({ code, label }) as StatMeta;

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
  it('names the stats the lookup answered with, in the labels it sent', () => {
    expect(playerIntroWords([shown('vpip', 'VPIP'), shown('bb_per_100', 'bb/100')])).toContain('VPIP and bb/100');
  });

  /* The order asserted as one string, not label by label: the answer arrives ranked by the route
     and `toContain` per label passes just as happily on a list read backwards. */
  it('names every one of them, in the order the answer lists them', () => {
    const seven = ['Hands', 'VPIP', 'PFR', '3-bet', 'WTSD', 'WWSF', 'bb/100'];
    const words = playerIntroWords(seven.map((label) => shown(label.toLowerCase(), label)));
    expect(words).toContain('You get Hands, VPIP, PFR, 3-bet, WTSD, WWSF and bb/100.');
  });

  /*
   * Before a search there is no answer, so there is no list — and the page says less rather than
   * promising seven stats it has not been told about. ADR-062 is about a screen asserting what it
   * had not asked; a hard-coded list here would be the same shape of claim, just a quieter one.
   */
  it('claims no stats before the route has named any', () => {
    const words = playerIntroWords([]);
    expect(words).toContain('by screen name');
    expect(words).not.toContain('You get');
  });
});

describe('matchedWords', () => {
  /* The common case: a name somebody typed matches a handful, and all of them are on screen. */
  it('says nothing when every match is already listed', () => {
    expect(matchedWords('mango', 4, 4, false)).toBe('');
  });

  it('says how many matched, and how many of them are shown', () => {
    const words = matchedWords('man', 1966, 50, false);
    expect(words).toBe('1,966 names matched “man”. The 50 with the most hands are below, the name typed in full first — type more of it to narrow them.');
  });

  /*
   * Past the engine's ceiling the route stops counting, so `matched` is a floor. "10,000 names
   * matched" would be a precise-looking number that is not one (ADR-062 decision 4).
   */
  it('says “at least” when the count is a floor rather than a count', () => {
    expect(matchedWords('a', 10000, 50, true)).toContain('At least 10,000 names matched');
    expect(matchedWords('man', 1966, 50, false)).not.toContain('At least');
  });

  /* The route caps its own query at the ceiling, so a capped answer counted *exactly* the ceiling
     and the truth is "the ceiling or more". "More than 10,000" is false when 10,000 matched. */
  it('does not turn that floor into a strict inequality', () => {
    expect(matchedWords('a', 10000, 50, true)).not.toContain('More than');
  });

  /* `shown` is an answer's row count and the route's default makes it 50, but this is an exported
     function taking a number, and "The 1 with the most hands are below" is not a sentence. */
  it('reads as English when only one name is shown', () => {
    expect(matchedWords('man', 1966, 1, false)).toContain('The busiest one is below');
  });

  it('still says so when the cap is reached and the list is not short', () => {
    expect(matchedWords('a', 200, 200, true)).toContain('At least 200 names matched');
  });
});

describe('noPlayerWords', () => {
  it('quotes the search that ran, not the box', () => {
    expect(noPlayerWords('mang')).toContain('“mang”');
  });

  it('says where the names come from, so an empty answer is not read as a broken search', () => {
    expect(noPlayerWords('mang')).toContain('Pool hands');
  });

  /* The one way a search fails that nobody guesses: every key is `<site>:<name>` and only the
     name half is matched, so the site a reader can *see* in every result is not what is searched
     (ADR-062). Measured on the real pool: "ggpoker" matches 27 players who have it in their own
     name, not the 94,276 who play there. */
  it('says the site is not part of what is searched', () => {
    expect(noPlayerWords('ggpoker')).toContain('the site a key starts with is not part of the name');
  });

  /* "Matched", not "contains": the route lower-cases what was typed and splits a pasted key, so
     the quoted text is what was asked and is not in general a substring of anything. */
  it('does not claim the text it quotes is inside any name', () => {
    expect(noPlayerWords('MAN')).not.toContain('contains');
    expect(noPlayerWords('MAN')).toContain('Nothing in the pool matched “MAN”');
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
