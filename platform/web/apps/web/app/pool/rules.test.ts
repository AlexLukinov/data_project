import { describe, expect, it } from 'vitest';

import { validationMessages } from '../auth/api';
import type { CohortSpec, Stat } from '../stats/api';
import { MAX_RULES, NAME_MAX, OPS, describeCohortError, draftProblems, draftsOf, emptyRule, splitByCached, toSpec } from './rules';

function stat(code: string, cached: boolean | undefined): Stat {
  return { code, label: code.toUpperCase(), category: 'preflop', grain: 'hand', format: 'percent', cached };
}

const VPIP = stat('vpip', true);
const HANDS = stat('hands', true);
const AF_FLOP = stat('af_flop', false);
const UNSAID = stat('unsaid', undefined);

const SPEC: CohortSpec = {
  rules: [
    { stat: 'vpip', op: 'lt', value: 25 },
    { stat: 'hands', op: 'gte', value: 1000 },
  ],
};

describe('splitByCached', () => {
  it('offers only the stats the registry marks cached, and shows the rest as the rest', () => {
    const { cached, uncached } = splitByCached([VPIP, AF_FLOP, HANDS, UNSAID]);
    expect(cached.map((s) => s.code)).toEqual(['vpip', 'hands']);
    expect(uncached.map((s) => s.code)).toEqual(['af_flop', 'unsaid']);
  });

  it('treats a stat that does not say as not cached, because the server would refuse it', () => {
    expect(splitByCached([UNSAID]).cached).toEqual([]);
  });
});

describe('emptyRule', () => {
  it('starts on the first cached stat with no value, so a fresh row is not a rule yet', () => {
    expect(emptyRule([VPIP, HANDS])).toEqual({ stat: 'vpip', op: 'gte', value: '' });
  });

  it('names no stat when there is none to name', () => {
    expect(emptyRule([]).stat).toBe('');
  });
});

describe('the ceilings copied from the server', () => {
  /* Neither value reaches the wire, so a drifted copy would let the form send what the server refuses. */
  it('match MAX_COHORT_RULES in stats/request.py and CohortIn.name in api/schemas_pool.py', () => {
    expect(MAX_RULES).toBe(10);
    expect(NAME_MAX).toBe(120);
  });
});

describe('OPS', () => {
  /* The label is all the person sees and the op is all the server gets: a swapped pair moves every player at the threshold. */
  it('names each of the four comparisons the server knows, in the filter bar’s words and in this order', () => {
    expect(OPS).toEqual([
      { op: 'gte', label: 'is at least' },
      { op: 'gt', label: 'is above' },
      { op: 'lte', label: 'is at most' },
      { op: 'lt', label: 'is below' },
    ]);
  });

  it('is where a fresh row starts, so the default is a choice the select offers', () => {
    expect(emptyRule([VPIP]).op).toBe(OPS[0]?.op);
  });
});

describe('draftsOf and toSpec', () => {
  it('round-trip a saved spec through the form and back as numbers', () => {
    expect(toSpec(draftsOf(SPEC))).toEqual(SPEC);
  });

  it('makes a new document rather than handing back the form’s rows', () => {
    const drafts = draftsOf(SPEC);
    const spec = toSpec(drafts);
    spec.rules[0]!.value = 99;
    expect(drafts[0]!.value).toBe('25');
  });
});

describe('draftProblems', () => {
  const rule = { stat: 'vpip', op: 'lt' as const, value: '25' };

  it('is empty for a name and one well-formed rule', () => {
    expect(draftProblems('Regs', [rule])).toEqual([]);
  });

  it('wants a name, and a name that is not only spaces', () => {
    expect(draftProblems('   ', [rule])).toEqual(['Give the cohort a name.']);
  });

  it('refuses a name longer than the server’s column, and allows one exactly that long', () => {
    expect(draftProblems('x'.repeat(121), [rule])).toEqual(['The name is longer than 120 characters.']);
    expect(draftProblems('x'.repeat(120), [rule])).toEqual([]);
  });

  it('wants at least one rule', () => {
    expect(draftProblems('Regs', [])).toEqual(['A cohort needs at least one rule.']);
  });

  it('refuses an eleventh rule before the server has to, and allows the tenth', () => {
    const eleven = Array.from({ length: 11 }, () => rule);
    expect(draftProblems('Regs', eleven)).toEqual(['At most 10 rules — the server refuses more.']);
    expect(draftProblems('Regs', eleven.slice(0, 10))).toEqual([]);
  });

  it('names the row whose value is not a number, or whose stat is missing', () => {
    /* `Number('   ')` is 0, which is finite: without the trim a blank row would be sent as "at least 0". */
    const rows = [rule, { ...rule, value: '' }, { ...rule, value: 'abc' }, { ...rule, stat: '' }, { ...rule, value: '   ' }];
    expect(draftProblems('Regs', rows)).toEqual([
      'Rule 2 needs a number.',
      'Rule 3 needs a number.',
      'Rule 4 names no stat.',
      'Rule 5 needs a number.',
    ]);
  });

  it('does not judge whether a stat is cached — that sentence is the server’s', () => {
    expect(draftProblems('Regs', [{ ...rule, stat: 'af_flop' }])).toEqual([]);
  });
});

describe('describeCohortError', () => {
  it('shows a duplicate name in the server’s own 409 sentence', () => {
    const error = { status: 409, data: { detail: "a cohort named 'regs' already exists" } };
    expect(describeCohortError(error)).toBe("a cohort named 'regs' already exists");
  });

  it('shows a rule on an uncached stat in the server’s own 400 sentence', () => {
    const error = { status: 400, data: { detail: "cohort rule on 'af_flop': only cached stats can define a cohort" } };
    expect(describeCohortError(error)).toBe("cohort rule on 'af_flop': only cached stats can define a cohort");
  });

  it('reads a 422’s list, which is how the server refuses an eleventh rule', () => {
    const error = {
      status: 422,
      data: {
        detail: [
          { loc: ['body', 'criteria', 'rules'], msg: 'List should have at most 10 items after validation, not 11', type: 'too_long' },
        ],
      },
    };
    expect(describeCohortError(error)).toBe('criteria.rules: List should have at most 10 items after validation, not 11');
  });

  it('joins several validation messages and survives a malformed item', () => {
    const error = { status: 422, data: { detail: [{ loc: ['body', 'name'], msg: 'too short' }, 'garbage', { msg: 'no loc' }] } };
    expect(describeCohortError(error)).toBe('name: too short · invalid · no loc');
  });

  it('falls back to the plain description for anything else', () => {
    expect(describeCohortError({ status: 404, data: { detail: 'Not found' } })).toBe('Not found');
    expect(describeCohortError({ status: 500 })).toContain('the terminal running `make api`');
    expect(describeCohortError(new TypeError('Failed to fetch'))).toMatch(/did not answer/);
  });

  /* The copy that used to live in rules.ts read a 422 exactly as the auth module does — until one of them moved. */
  it('reads the list with the same function every other screen uses', () => {
    const error = { status: 422, data: { detail: [{ loc: ['body', 'criteria', 'rules'], msg: 'List should have at most 10 items' }] } };
    expect(describeCohortError(error)).toBe(validationMessages(error).join(' · '));
  });
});
