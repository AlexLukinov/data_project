import { describe, expect, it } from 'vitest';

import { LIBRARY_UNREADABLE, analyzeProblem, offlineRangeNote, oddsPanelsNote, poolProblem, realizationProblem } from './study';

/** What a failed `$fetch` looks like once it has an answer to carry: status plus the API's detail. */
function answered(status: number, detail: string | null): unknown {
  return Object.assign(new Error('FetchError'), { name: 'FetchError', status, data: detail === null ? {} : { detail } });
}

/** What it looks like when nothing answered at all: no status anywhere. */
function silent(): unknown {
  return Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });
}

describe('poolProblem', () => {
  it('says the database refused under load, not that the field never played the spot (plan H.0)', () => {
    // ClickHouse's "Too many simultaneous queries" (code 202) reaches the browser as `stats/tenancy.py`'s 429.
    const said = poolProblem(answered(429, 'The account is already running as many queries at once as it may; ask again in a moment.'));
    expect(said).toContain('The pool could not be asked what the field does here.');
    expect(said).toContain('only a few of them are answered at a time');
    expect(said).toContain('Stepping to this spot again asks afresh.');
    expect(said).not.toContain('ask again in a moment');
  });

  it('no longer calls a sanitized 500 "under load": since H.0 that is a fault, and it says where the reason is', () => {
    const said = poolProblem(answered(500, 'Internal server error'));
    expect(said).toContain('The pool could not be asked what the field does here.');
    expect(said).toContain('the reason is in the terminal running `make api`');
    expect(said).not.toContain('only a few of them are answered at a time');
    expect(said).not.toContain('Internal server error');
  });

  it('keeps a 429 that is not that refusal — the hour’s quota — in the server’s own words', () => {
    const said = poolProblem(answered(429, "The account's hourly query budget is spent; try again later."));
    expect(said).toContain("The account's hourly query budget is spent; try again later.");
    expect(said).not.toContain('only a few of them are answered at a time');
  });

  it('says the API is stopped when nothing answered, and how to start it', () => {
    expect(poolProblem(silent())).toContain('The API did not answer; start it with `make api` in platform/.');
  });

  it('keeps a refusal the API did describe, because it says what this sentence cannot', () => {
    const said = poolProblem(answered(504, "This query took longer than the account's budget allows."));
    expect(said).toContain("This query took longer than the account's budget allows.");
    expect(said).not.toContain('only a few of them are answered at a time');
  });

  it('closes a server detail that has no full stop before the retry clause follows it', () => {
    // A described refusal with no terminal punctuation.
    const said = poolProblem(answered(400, 'That query setting is fixed for this account'));
    expect(said).toContain('fixed for this account. Stepping to this spot again asks afresh.');
  });
});

describe('realizationProblem and analyzeProblem', () => {
  it('names what was being asked, so two failures on one screen are told apart', () => {
    expect(realizationProblem(silent())).toContain('What the field won from this situation could not be asked.');
    expect(analyzeProblem(silent())).toContain('This situation could not be taken into the analyzer.');
  });

  it('offers the button as the retry where stepping is not the way to ask again', () => {
    const said = analyzeProblem(answered(500, 'Internal server error'));
    expect(said).toContain('Press Analyze this node again to try once more.');
    expect(said).not.toContain('Stepping to this spot');
  });
});

describe('the range library’s two silences', () => {
  it('reads as unreadable, never as nothing stored, when both copies failed', () => {
    expect(LIBRARY_UNREADABLE).toContain('neither the API nor this browser’s offline copy answered');
  });

  it('says whose answer the empty one was, with the library’s own reason in front of it', () => {
    expect(offlineRangeNote('The API did not answer; showing the cached copy.')).toBe(
      'The API did not answer; showing the cached copy. This browser’s offline copy has no chart of yours for this situation.',
    );
    expect(offlineRangeNote(null)).toBe('This browser’s offline copy has no chart of yours for this situation.');
  });
});

describe('oddsPanelsNote', () => {
  it('holds both panels back while the blinds are still going in, and says why once', () => {
    // The big blind's post: 0.5 to call with nothing behind it, where both panels used to print
    // "There is no pot to work from…" of their own accord.
    expect(oddsPanelsNote(0, 0.5)).toContain('nothing in the pot behind this bet yet');
  });

  it('keeps the older sentence when nothing is faced at all', () => {
    expect(oddsPanelsNote(9, 0)).toBe('Nothing to call at this step — pot odds and MDF appear when there is a bet in front.');
  });

  it('is silent — the panels are mounted — once there is a pot and a bet', () => {
    expect(oddsPanelsNote(9, 4)).toBe('');
  });
});
