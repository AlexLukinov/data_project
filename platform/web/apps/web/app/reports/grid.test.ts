import { describe, expect, it } from 'vitest';

import type { StatMeta } from '../stats/api';
import { GRID_TERMS, columnCount, legendView } from './grid';

function meta(code: string): StatMeta {
  return { code, label: code.toUpperCase(), format: 'percent', grain: 'decision' } as StatMeta;
}

const TWO = [meta('vpip'), meta('pfr')];

describe('columnCount', () => {
  /* The ungrouped case is the bug this function exists for: with no group-by the grid still draws
     an "All hands" column, so the empty row used to stop one column short of the table. */
  it('counts the “All hands” column an ungrouped report still draws', () => {
    expect(columnCount([], TWO, false)).toBe(3);
    expect(columnCount([], TWO, true)).toBe(4);
  });

  it('counts one column per grouping once there is a grouping', () => {
    expect(columnCount(['position', 'street'], TWO, true)).toBe(5);
    expect(columnCount(['position'], [], false)).toBe(1);
  });
});

describe('legendView', () => {
  /* "Every cell here clears 100 observations" under a report with no cells is not reassuring, it is
     false — there is no cell that cleared anything. */
  it('claims nothing about cells clearing a threshold when there are no cells', () => {
    const legend = legendView(0, 0, 100);
    expect(legend.thinCount).toBe('');
    expect(legend.note).toBe('');
  });

  it('says how many cells the threshold is holding back, out of how many there are', () => {
    const legend = legendView(4, 24, 100);
    expect(legend.thinCount).toBe('4 of 24 cells are under 100 observations');
    expect(legend.note).toContain('not compared with the field');
  });

  it('reassures only when there are cells and a threshold to clear', () => {
    expect(legendView(0, 24, 100).note).toBe('Every cell here clears 100 observations.');
    expect(legendView(0, 24, 0).note).toBe('');
  });

  it('keeps the sentence the two terms are read inside', () => {
    const legend = legendView(0, 0, 0);
    expect(`${legend.opening} n ${legend.counted}`).toBe('Every cell shows the n it was computed from.');
  });

  it('separates a count of cells, because a wide report has thousands of them', () => {
    expect(legendView(1200, 24000, 100).thinCount).toBe('1,200 of 24,000 cells are under 100 observations');
  });
});

describe('GRID_TERMS', () => {
  it('explains the hands column without the engine words its old title used', () => {
    expect(GRID_TERMS.hands.definition).toContain('not the sample behind any one cell');
    expect(`${GRID_TERMS.hands.definition} ${GRID_TERMS.hands.formula}`).not.toMatch(/grain|sketch/i);
  });
});
