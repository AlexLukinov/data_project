// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { VNode } from 'vue';
import { h } from 'vue';

import type { Cell, Dimension, ReportResult, ReportRow, Stat } from '~/stats/api';

import StatGrid from './StatGrid.vue';

function stat(code: string, over: Partial<Stat> = {}): Stat {
  return { code, label: code.toUpperCase(), category: 'preflop', grain: 'decision', format: 'percent', description: `what ${code} counts.`, ...over } as Stat;
}

function dim(over: Partial<Dimension> & Pick<Dimension, 'code' | 'type'>): Dimension {
  return { label: over.code, tables: ['decisions'], description: '', values: [], ops: null, group_by: true, buckets: {}, allowed_ops: [], ...over } as Dimension;
}

function cell(over: Partial<Cell> = {}): Cell {
  return { value: 22.5, n: 1200, baseline: null, baseline_n: null, delta: null, ...over };
}

function row(over: Partial<ReportRow> = {}): ReportRow {
  return { group: {}, hands: 2219, cells: { vpip: cell() }, ...over };
}

const VPIP = stat('vpip');
const POSITION = dim({ code: 'position', type: 'enum', label: 'Position', values: ['BTN', '5bet_plus'] });
const SIZE = dim({ code: 'size_pct', type: 'number', label: 'Bet size (fraction of pot)', buckets: { small: [0, 0.37] } });

/*
 * The result's own column metadata carries the description too, and it has to: the header used to
 * bind `${meta.description} — what it counts` to a `title`, and with an empty description here
 * that markup rendered `title=" — what it counts"` — which the assertion below would not have
 * recognised. The fixture now says what the server says, so reverting the header fails.
 */
function result(over: Partial<ReportResult> = {}): ReportResult {
  return {
    hands: 12345,
    group_by: [],
    stats: [{ code: 'vpip', label: 'VPIP', format: 'percent', grain: 'decision', description: VPIP.description! }],
    rows: [row()],
    cached: false,
    ...over,
  };
}

/** The one slot this grid has: what an empty report says in place of the fallback sentence. */
type GridSlots = { empty?: () => VNode };

function grid(over: Partial<ReportResult> = {}, slots: GridSlots = {}) {
  return mount(StatGrid, {
    props: { result: result(over), stats: [VPIP], dimensions: new Map([POSITION, SIZE].map((d) => [d.code, d])), minN: 100 },
    slots,
  });
}

const find = (w: ReturnType<typeof grid>, id: string) => w.find(`[data-testid="${id}"]`);

describe('StatGrid — the counts lane A selects on', () => {
  it('gives the headline hands count and each row’s own count a testid of its own', () => {
    const w = grid();
    expect(find(w, 'grid-hands').text()).toBe('12,345');
    expect(find(w, 'hands-all').text()).toBe('2,219');
  });

  it('keys a grouped row’s hands by the same string as the row itself', () => {
    const w = grid({ group_by: ['position'], rows: [row({ group: { position: 'BTN' } })] });
    expect(find(w, 'grid-row-BTN').exists()).toBe(true);
    expect(find(w, 'hands-BTN').text()).toBe('2,219');
  });
});

describe('StatGrid — a report with no rows', () => {
  /* The colspan was one short with no grouping, because the "All hands" column is drawn then and
     was not counted: the empty row stopped in the middle of the table. */
  it('spans the “All hands” column an ungrouped report draws', () => {
    const w = grid({ rows: [] });
    expect(find(w, 'grid-empty').attributes('colspan')).toBe('3');
  });

  it('keeps its own sentence when the page mounting it has nothing better to say', () => {
    expect(find(grid({ rows: [] }), 'grid-empty').text()).toBe('No rows. Nothing in the database matches this situation.');
  });

  it('lets the page say why it is empty, under the same testid', () => {
    const w = grid({ rows: [] }, { empty: () => h('p', 'None of your hands match this situation.') });
    expect(find(w, 'grid-empty').text()).toBe('None of your hands match this situation.');
  });

  /* "Every cell here clears 100 observations" over a grid with no cells is a false claim, not a
     reassuring one — there is no cell that cleared anything. */
  it('claims nothing about a threshold when there is no cell to claim it about', () => {
    expect(find(grid({ rows: [] }), 'grid-legend').text()).not.toContain('clears');
    expect(find(grid(), 'grid-legend').text()).toContain('Every cell here clears 100 observations.');
  });
});

describe('StatGrid — registry words on the headings', () => {
  it('keeps the column header a button that opens the fuller panel, and describes it too', async () => {
    const w = grid();
    const head = find(w, 'grid-head-vpip');
    expect(head.element.tagName).toBe('BUTTON');
    expect(head.attributes('aria-describedby')).toBeTruthy();
    await head.trigger('click');
    expect(w.emitted('describe')).toEqual([['vpip']]);
  });

  /*
   * The affordance, not the absence: a header that dropped its `title` and offered nothing in its
   * place would pass a "no title" assertion on its own. So the tip is followed from the header's
   * own `aria-describedby`, and only then is the old markup ruled out. The `title` sweep is the
   * header row's alone — a data cell keeps one for how its number was counted.
   */
  it('explains a column through a tooltip the keyboard reaches, not through a title', () => {
    const w = grid();
    const head = find(w, 'grid-head-vpip');
    expect(head.attributes('title')).toBeUndefined();
    const tip = w.find(`[id="${head.attributes('aria-describedby')}"]`);
    expect(tip.attributes('role')).toBe('tooltip');
    expect(tip.text()).toContain('what vpip counts');
    expect(w.find('thead [title]').exists()).toBe(false);
    expect(w.html()).not.toMatch(/title="what vpip counts/);
  });

  it('reads a grouped value through the column it belongs to', () => {
    const enums = grid({ group_by: ['position'], rows: [row({ group: { position: '5bet_plus' } })] });
    expect(find(enums, 'grid-row-5bet_plus').text()).toContain('5bet+');
    const buckets = grid({ group_by: ['size_pct'], rows: [row({ group: { size_pct: 'small' } })] });
    expect(find(buckets, 'grid-row-small').text()).toContain('small (under 0.37 of the pot)');
  });
});
