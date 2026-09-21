/**
 * The analyzer's three failures are sentences that cannot be mistaken for "no data" (ADR-057
 * decision 8's rule, ADR-061): each says what could not be asked, why, and how to ask again.
 *
 * The case worth pinning is the refusal under load — ClickHouse turning down a query because the
 * account is already running as many as its budget allows (plan E.3) reaches the browser as a 500
 * the API has sanitized to "Internal server error", and it used to read as "the field has never
 * played this".
 */
import { describe, expect, it } from 'vitest';

import { poolGap } from './context';
import { NO_SITUATION, analyzeFacingProblem, analyzePoolProblem, libraryLookupProblem } from './problems';

/** A failed `$fetch`, as ofetch rejects: a status and the body the API sent. */
function refusal(status: number, detail: string | null) {
  return { status, data: detail === null ? {} : { detail } };
}

const ALL = [analyzePoolProblem, analyzeFacingProblem, libraryLookupProblem];

describe('the analyzer’s failure sentences', () => {
  it('name what could not be asked, never leaving it as "nothing here"', () => {
    expect(analyzePoolProblem(refusal(500, null))).toContain('What the field does in this situation could not be asked');
    expect(analyzeFacingProblem(refusal(500, null))).toContain('How often the field folds to this bet could not be asked');
    expect(libraryLookupProblem(refusal(500, null))).toContain('Your range library could not be read');
  });

  it('read a sanitized 5xx as the refusal under load it usually is, not as a broken page', () => {
    for (const problem of ALL) {
      const text = problem(refusal(500, 'Internal server error'));
      expect(text).toContain('several questions were asked at once');
      expect(text).not.toContain('Internal server error');
    }
  });

  it('keep a 5xx that does say something, because it says what this sentence cannot', () => {
    const budget = refusal(504, "This query took longer than the account's budget allows.");
    expect(analyzePoolProblem(budget)).toContain("longer than the account's budget allows");
  });

  it('name the terminal when nothing answered at all', () => {
    for (const problem of ALL) expect(problem(new TypeError('Failed to fetch'))).toContain('make api');
  });

  it('cover the case where nothing was ever asked: an analysis with no situation on it', () => {
    // No node means no request, so no catch can fire and no answer can arrive — the gate would
    // otherwise wait on "Working out…" for ever, which is the bug this round set out to end.
    expect(NO_SITUATION).toContain('no situation yet');
    expect(poolGap(null, NO_SITUATION)).toBe(NO_SITUATION);
    expect(poolGap(null)).toBe('');
  });

  it('end with the way to try again, which differs per screen', () => {
    expect(analyzePoolProblem(refusal(500, null))).toMatch(/Moving to another step asks again\.$/);
    expect(analyzeFacingProblem(refusal(500, null))).toMatch(/Moving to another step asks again\.$/);
    expect(libraryLookupProblem(refusal(500, null))).toMatch(/Press the button again to try once more\.$/);
  });
});
