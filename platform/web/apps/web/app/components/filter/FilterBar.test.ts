// @vitest-environment happy-dom
/**
 * The two places the bar spoke in codes (F.12c): a chip that named a column without saying what
 * it means, with a remove button that read `opener_position` out loud, and a warning written in
 * words only this repo uses. Both stores are mocked, because neither Pinia nor a server is part
 * of what is being checked.
 */
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Clause } from '~/filter/clause';
import type { Dimension, Stat } from '~/stats/api';

import FilterBar from './FilterBar.vue';

const mocks = vi.hoisted(() => ({
  definitions: { byCode: new Map<string, Dimension>(), stats: [] as Stat[] },
  filter: {
    dataset: 'hero',
    dateFrom: '',
    dateTo: '',
    clauses: [] as Clause[],
    sentence: 'every hand',
    problems: [] as string[],
    tables: [] as string[],
    clear: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('~/stores/definitions', () => ({ useDefinitionsStore: () => mocks.definitions }));
vi.mock('~/stores/filter', () => ({ useFilterStore: () => mocks.filter }));

function dim(over: Partial<Dimension> & Pick<Dimension, 'code' | 'type' | 'label'>): Dimension {
  return { tables: ['decisions'], description: '', values: [], value_labels: {}, ops: null, group_by: true, buckets: {}, allowed_ops: [], ...over };
}

/* The registry's own shape for this dimension, `''` included: the loader refuses an enum that
   declares a value it does not label (`stats/definitions.py`), so `values` without `value_labels`
   is a dimension no server can serve — and a fixture in that shape exercises `valueWords`'
   fallback rather than its label lookup, which is the branch this surface depends on. */
const OPENER = dim({
  code: 'opener_position',
  type: 'enum',
  label: "Opener's position",
  description: 'The seat that raised first in.',
  values: ['', 'BTN', 'CO'],
  value_labels: { '': 'Nobody has raised yet', BTN: 'BTN', CO: 'CO' },
});

function stat(code: string, label: string, grain: Stat['grain']): Stat {
  return { code, label, category: 'preflop', grain, format: 'percent' };
}

beforeEach(() => {
  mocks.definitions.byCode = new Map([[OPENER.code, OPENER]]);
  mocks.definitions.stats = [stat('vpip', 'VPIP', 'hand'), stat('pfr', 'PFR', 'hand'), stat('wtsd', 'WTSD', 'hand'), stat('cbet_flop', 'C-bet flop', 'decision')];
  mocks.filter.clauses = [];
  mocks.filter.tables = ['decisions', 'player_hands', 'stats_daily'];
});

describe('FilterBar — the chips', () => {
  it('carries the column’s own sentence and names the column in the remove button', () => {
    mocks.filter.clauses = [{ dim: 'opener_position', op: 'eq', values: ['BTN'] }];
    const chip = mount(FilterBar).get('[data-testid="chip-opener_position"]');
    expect(chip.text()).toContain("Opener's position is BTN");
    expect(chip.get('[role="tooltip"]').text()).toContain('The seat that raised first in.');
    expect(chip.get('[data-testid="chip-remove-opener_position"]').attributes('aria-label')).toBe("remove Opener's position");
  });

  /* The one value whose word is not its code: `BTN` reads the same whether the label was found or
     the raw value fell through, so the chip's vocabulary is only actually asserted here. */
  it('reads a blank in the words of the column it is a value of', () => {
    mocks.filter.clauses = [{ dim: 'opener_position', op: 'eq', values: [''] }];
    const chip = mount(FilterBar).get('[data-testid="chip-opener_position"]');
    expect(chip.text()).toContain("Opener's position is Nobody has raised yet");
  });

  it('removes the clause it sits on, by index', async () => {
    mocks.filter.clauses = [{ dim: 'opener_position', op: 'eq', values: ['BTN'] }, { dim: 'opener_position', op: 'eq', values: ['CO'] }];
    const chips = mount(FilterBar).findAll('[data-testid="chip-remove-opener_position"]');
    await chips[1]!.trigger('click');
    expect(mocks.filter.remove).toHaveBeenCalledWith(1);
  });
});

describe('FilterBar — the note that rules a stat out', () => {
  it('names the stats the registry serves, and explains the word it has to use', () => {
    mocks.filter.tables = ['decisions'];
    const note = mount(FilterBar).get('[data-testid="filter-grain"]');
    expect(note.text()).toContain('VPIP, PFR and WTSD');
    expect(note.text()).toContain('counted once per hand');
    expect(note.text()).not.toContain('Decision-grain');
    expect(note.get('[data-term="grain"]').text()).toBe('grain');
  });

  it('stays quiet while a per-hand stat still fits', () => {
    expect(mount(FilterBar).find('[data-testid="filter-grain"]').exists()).toBe(false);
  });

  it('says so when the columns contradict each other', () => {
    mocks.filter.tables = [];
    expect(mount(FilterBar).get('[data-testid="filter-grain"]').text()).toContain('No table holds all of these columns at once');
  });
});
