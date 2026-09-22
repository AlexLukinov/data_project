// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { Clause, ClauseOp } from '~/filter/clause';
import type { Dimension } from '~/stats/api';

import ClauseValue from './ClauseValue.vue';

function dim(over: Partial<Dimension> & Pick<Dimension, 'code' | 'type'>): Dimension {
  return { label: over.code, tables: ['decisions'], description: '', values: [], value_labels: {}, ops: null, group_by: false, buckets: {}, allowed_ops: [], ...over };
}

const SPR = dim({ code: 'spr', type: 'number', label: 'SPR', allowed_ops: ['between', 'gte', 'lte'] });
const STAKE = dim({ code: 'stake_level', type: 'string', label: 'Stake', allowed_ops: ['eq', 'prefix'] });
const BIG_BLIND = dim({ code: 'big_blind', type: 'number', label: 'Big blind', allowed_ops: ['in', 'not_in', 'eq'] });
const SIZE = dim({ code: 'size_pct', type: 'number', label: 'Bet size (fraction of pot)', buckets: { small: [0, 0.37], mid: [0.37, 0.7] }, allowed_ops: ['gte', 'lte'] });
/* The registry's own `facing`, three of its seven values: it declares no `''` — `none` is its word
   for "nothing in front" — and the loader refuses a label for a value a dimension does not declare. */
const FACING = dim({ code: 'facing', type: 'enum', label: 'Facing', values: ['bet', '5bet_plus', 'none'], value_labels: { bet: 'Bet', '5bet_plus': '5-bet or more', none: 'Nothing' }, allowed_ops: ['eq', 'in'] });

/** The component with its clause kept in step with what it emits, as `ClauseRow` does. */
function render(clause: Clause, dimension: Dimension) {
  const wrapper = mount(ClauseValue, {
    props: {
      clause,
      dim: dimension,
      'onUpdate:values': (values: string[]) => wrapper.setProps({ clause: { ...wrapper.props('clause'), values } }),
    },
  });
  return wrapper;
}

const box = (w: ReturnType<typeof render>, id: string) => w.find(`[data-testid="${id}"]`);

describe('ClauseValue — number boxes', () => {
  it('sends nothing for text that is not a number, and keeps the value that stood', async () => {
    const w = render({ dim: 'spr', op: 'gte', values: ['3'] }, SPR);
    await box(w, 'clause-scalar').setValue('3..5');
    expect(w.emitted('update:values')).toBeUndefined();
    expect(box(w, 'clause-scalar').attributes('aria-invalid')).toBe('true');
    expect(w.props('clause').values).toEqual(['3']);
  });

  it.each<[string, ClauseOp, string[], string[]]>([
    ['clause-low', 'between', ['1', '4'], ['', '4']],
    ['clause-high', 'between', ['1', '4'], ['1', '']],
    ['clause-scalar', 'gte', ['3'], ['']],
  ])('sends an empty value when %s is emptied, so the clause is held back as unfinished', async (id, op, values, sent) => {
    const w = render({ dim: 'spr', op, values }, SPR);
    await box(w, id).setValue('');
    expect(w.emitted('update:values')!.at(-1)).toEqual([sent]);
  });

  it('stores a comma-typed number with a dot, in both bounds and the scalar', async () => {
    const between = render({ dim: 'spr', op: 'between', values: ['0', '0'] }, SPR);
    await box(between, 'clause-low').setValue('3,5');
    await box(between, 'clause-high').setValue('87,5');
    expect(between.props('clause').values).toEqual(['3.5', '87.5']);

    const scalar = render({ dim: 'spr', op: 'gte', values: ['0'] }, SPR);
    await box(scalar, 'clause-scalar').setValue('45,5');
    expect(scalar.emitted('update:values')!.at(-1)).toEqual([['45.5']]);
  });

  it('shows a stored value in a text box with a dot, labelled for the dimension', () => {
    const w = render({ dim: 'spr', op: 'between', values: ['2.5', '10'] }, SPR);
    const low = box(w, 'clause-low');
    expect(low.attributes()).toMatchObject({ type: 'text', inputmode: 'decimal', 'aria-label': 'SPR low' });
    expect((low.element as HTMLInputElement).value).toBe('2.5');
    expect((box(w, 'clause-high').element as HTMLInputElement).value).toBe('10');
  });
});

describe('ClauseValue — a list of numbers', () => {
  it('sends nothing when an item is not a number, such as a list split on commas, and marks the box', async () => {
    const w = render({ dim: 'big_blind', op: 'in', values: ['0.25'] }, BIG_BLIND);
    await box(w, 'clause-number-list').setValue('0,05, 0,1');
    expect(w.emitted('update:values')).toBeUndefined();
    expect(box(w, 'clause-number-list').attributes('aria-invalid')).toBe('true');
    expect(w.props('clause').values).toEqual(['0.25']);
  });

  it('reads items separated by ; or spaces, with a comma or a dot, and sends them with a dot', async () => {
    const w = render({ dim: 'big_blind', op: 'in', values: [] }, BIG_BLIND);
    await box(w, 'clause-number-list').setValue('0,05; 0.1  0,25');
    expect(w.props('clause').values).toEqual(['0.05', '0.1', '0.25']);
    expect(box(w, 'clause-number-list').attributes('aria-invalid')).toBeUndefined();
    expect((box(w, 'clause-number-list').element as HTMLInputElement).value).toBe('0.05; 0.1; 0.25');
  });
});

/**
 * The registry's words on screen, the registry's codes on the wire (ADR-053, ADR-057). A reader
 * choosing "small (under 0.37 of the pot)" must still send `small`, or the situation they built
 * is not the situation the server measures.
 */
describe('ClauseValue — what a choice shows against what it sends', () => {
  it('puts the numbers behind a bucket name in the option, and sends the name', async () => {
    const w = render({ dim: 'size_pct', op: 'bucket', values: ['small'] }, SIZE);
    const options = box(w, 'clause-bucket').findAll('option');
    expect(options.map((o) => o.text())).toEqual(['small (under 0.37 of the pot)', 'mid (0.37–0.7 of the pot)']);
    await box(w, 'clause-bucket').setValue('mid');
    expect(w.emitted('update:values')!.at(-1)).toEqual([['mid']]);
  });

  it('writes an enum value as a player writes it, and sends the registry code', async () => {
    const w = render({ dim: 'facing', op: 'eq', values: ['bet'] }, FACING);
    const options = box(w, 'clause-enum').findAll('option');
    expect(options.map((o) => o.text())).toEqual(['Bet', '5-bet or more', 'Nothing']);
    await box(w, 'clause-enum').setValue('5bet_plus');
    expect(w.emitted('update:values')!.at(-1)).toEqual([['5bet_plus']]);
  });

  /*
   * The last client-side rewrite, and the one that hid from the earlier sweep: `opener_position`
   * and `last_raiser_position` both list BTN and SB, so they route to `PositionPicker`, which had
   * its own `'' → "Not applicable — nobody in that role"` — the exact phrase ADR-062 deleted from
   * `valueWords`, and wrong on at least one of the two dimensions whatever it said. The chip keeps
   * its short text (a 2.6rem button in a ring); the meaning on the hover is the registry's.
   */
  it('gives the seat picker the registry’s own word for a blank, not a phrase of its own', () => {
    const OPENER = dim({
      code: 'opener_position',
      type: 'enum',
      label: "Opener's position",
      values: ['', 'BTN', 'SB'],
      value_labels: { '': 'Nobody has raised yet', BTN: 'BTN', SB: 'SB' },
      allowed_ops: ['eq', 'in'],
    });
    const w = render({ dim: 'opener_position', op: 'eq', values: [''] }, OPENER);
    const none = w.get('[data-testid="seat-none"]');
    expect(none.attributes('title')).toBe('Nobody has raised yet');
    expect(none.attributes('title')).not.toContain('Not applicable');
  });

  it('writes the same words on the many-value buttons', () => {
    const w = render({ dim: 'facing', op: 'in', values: [] }, FACING);
    expect(box(w, 'clause-enum-many').findAll('button').map((b) => b.text())).toEqual(['Bet', '5-bet or more', 'Nothing']);
  });
});

describe('ClauseValue — a text dimension', () => {
  it('stays a plain text box that sends exactly what was typed', async () => {
    const w = render({ dim: 'stake_level', op: 'prefix', values: [''] }, STAKE);
    const scalar = box(w, 'clause-scalar');
    expect(scalar.attributes('inputmode')).toBeUndefined();
    await scalar.setValue('NL1,0');
    expect(w.emitted('update:values')!.at(-1)).toEqual([['NL1,0']]);
  });
});
