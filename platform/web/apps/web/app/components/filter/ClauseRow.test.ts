// @vitest-environment happy-dom
/**
 * What a condition is about, explained where it is read (F.12c, ADR-057). The column's sentence
 * used to be a `title` on a plain `<span>`: a mouse hover, and nothing at all on a keyboard or a
 * phone. These tests pin the affordance, not the styling.
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { Clause } from '~/filter/clause';
import type { Dimension } from '~/stats/api';

import ClauseRow from './ClauseRow.vue';

function dim(over: Partial<Dimension> & Pick<Dimension, 'code' | 'type'>): Dimension {
  return { label: over.code, tables: ['decisions'], description: '', values: [], ops: null, group_by: true, buckets: {}, allowed_ops: [], ...over };
}

const STREET = dim({
  code: 'street',
  type: 'enum',
  label: 'Street',
  description: 'Which street the decision was made on.',
  values: ['flop', 'turn'],
  allowed_ops: ['eq', 'in'],
});

const ON_STREET: Clause = { dim: 'street', op: 'eq', values: ['flop'] };

const row = (clause: Clause, dimension: Dimension | undefined) => mount(ClauseRow, { props: { clause, dim: dimension } });

describe('ClauseRow', () => {
  it('explains the column through a term a keyboard can reach, not a title it cannot', () => {
    const w = row(ON_STREET, STREET);
    const term = w.get('[data-term="street"]');
    expect(term.text()).toBe('Street');
    expect(term.attributes('tabindex')).toBe('0');
    expect(term.attributes('aria-describedby')).toBe(w.get('[role="tooltip"]').attributes('id'));
    expect(w.find('[title]').exists()).toBe(false);
  });

  it('says the registry sentence and where the column is held, in the screen’s words', () => {
    const tip = row(ON_STREET, STREET).get('[role="tooltip"]').text();
    expect(tip).toContain('Which street the decision was made on.');
    expect(tip).toContain('Held on decisions.');
    expect(tip).not.toContain('player_hands');
  });

  it('still reads when the registry no longer declares the column', () => {
    const w = row({ dim: 'gone', op: 'eq', values: ['x'] }, undefined);
    expect(w.get('[data-term="gone"]').text()).toBe('gone');
    expect(w.get('[role="tooltip"]').text()).toContain('not in the registry this server serves');
    expect(w.get('[data-testid="clause-problem"]').text()).toContain('gone is not a dimension this server knows');
  });
});
