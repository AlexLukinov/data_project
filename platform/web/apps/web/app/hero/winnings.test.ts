import { describe, expect, it } from 'vitest';

import type { WinningsPoint } from './api';
import type { SeriesKey } from './winnings';
import { BOX, LABEL_GAP, SERIES, dayLabel, domain, epochDay, geometry, nearestPoint, niceStep, spread, xTickIndices } from './winnings';

function point(day: string, over: Partial<WinningsPoint> = {}): WinningsPoint {
  return { day, hands: 100, net: 0, ev: 0, showdown: 0, nonShowdown: 0, ...over };
}

const ALL: SeriesKey[] = ['net', 'ev', 'showdown', 'nonShowdown'];

describe('epochDay', () => {
  it('counts whole days and never drifts across a month or a year', () => {
    expect(epochDay('2026-09-04') - epochDay('2026-08-18')).toBe(17);
    expect(epochDay('2027-01-01') - epochDay('2026-12-31')).toBe(1);
  });

  it('is parsed as UTC, so a reader west of Greenwich does not lose a day', () => {
    // The trap: `new Date('2026-08-18')` is UTC midnight but `new Date('2026-08-18T00:00:00')`
    // is local, and mixing the two shifts dates by one in half the world.
    expect(epochDay('1970-01-01')).toBe(0);
    expect(epochDay('1970-01-02')).toBe(1);
  });

  it('says so rather than guessing when the text is not a date', () => {
    expect(epochDay('not-a-date')).toBeNaN();
  });
});

describe('dayLabel', () => {
  it('reads the same in every locale', () => {
    expect(dayLabel('2026-08-18')).toBe('18 Aug');
    expect(dayLabel('2026-01-01')).toBe('1 Jan');
  });
});

describe('niceStep', () => {
  it('only ever returns 1, 2 or 5 times a power of ten', () => {
    for (const span of [0.3, 7, 43, 137.4, 2200, 19_000]) {
      const step = niceStep(span, 5);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
    }
  });

  it('lands near the target number of ticks', () => {
    const step = niceStep(4000, 5);
    expect(4000 / step).toBeGreaterThanOrEqual(3);
    expect(4000 / step).toBeLessThanOrEqual(8);
  });

  it('survives a flat series rather than dividing by zero', () => {
    expect(niceStep(0, 5)).toBe(1);
  });
});

describe('domain', () => {
  it('always contains zero, so a losing line cannot be drawn as though it crossed break-even', () => {
    const points = [point('2026-08-18', { net: -50 }), point('2026-08-19', { net: -300 })];
    const { min, max } = domain(points, ['net']);
    expect(min).toBeLessThan(-300);
    expect(max).toBeGreaterThanOrEqual(0);
  });

  it('narrows to the visible series — which is what makes hiding a pair useful', () => {
    const points = [point('2026-08-18', { net: -272, ev: 56, showdown: 1819, nonShowdown: -2091 })];
    const all = domain(points, ALL);
    const totals = domain(points, ['net', 'ev']);
    expect(all.max - all.min).toBeGreaterThan(3000);
    expect(totals.max - totals.min).toBeLessThan(400);
  });

  it('gives a flat-at-zero series a domain with height', () => {
    const { min, max } = domain([point('2026-08-18')], ALL);
    expect(max).toBeGreaterThan(min);
  });
});

describe('xTickIndices', () => {
  it('labels every point when there are few', () => {
    expect(xTickIndices(4, 6)).toEqual([0, 1, 2, 3]);
  });

  it('always labels the first and the last', () => {
    const ticks = xTickIndices(18, 6);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(17);
  });

  it('never repeats an index', () => {
    const ticks = xTickIndices(7, 6);
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});

describe('geometry', () => {
  it('has nothing to draw with no points, so the page can show why', () => {
    expect(geometry([], ALL)).toBeNull();
  });

  it('spaces the x axis by calendar day, not by point index', () => {
    // Three points: two consecutive days, then a gap of a fortnight. Index spacing would put
    // the middle point halfway across; calendar spacing puts it near the left, which is the
    // whole difference between a truthful slope and a flattering one.
    const points = [point('2026-08-01'), point('2026-08-02'), point('2026-08-16')];
    const geo = geometry(points, ['net'])!;
    const [a, b, c] = geo.points;
    const first = b!.x - a!.x;
    const second = c!.x - b!.x;
    expect(second / first).toBeCloseTo(14, 5);
  });

  it('puts a single day at the left edge instead of dividing by a zero span', () => {
    const geo = geometry([point('2026-08-18', { net: 10 })], ['net'])!;
    expect(geo.points[0]!.x).toBe(BOX.left);
    expect(Number.isFinite(geo.points[0]!.y.net)).toBe(true);
  });

  it('draws one path per visible series and none for a hidden one', () => {
    const points = [point('2026-08-18', { net: 1 }), point('2026-08-19', { net: 2 })];
    const geo = geometry(points, ['net', 'ev'])!;
    expect(geo.paths.map((path) => path.key)).toEqual(['net', 'ev']);
    expect(geo.paths[0]!.d.startsWith('M ')).toBe(true);
  });

  it('keeps the series in their fixed order, so hiding one never repaints another', () => {
    const points = [point('2026-08-18', { net: 1, showdown: 3 })];
    const geo = geometry(points, ['showdown', 'net'])!;
    expect(geo.paths.map((path) => path.key)).toEqual(['net', 'showdown']);
  });

  it('places break-even inside the box', () => {
    const points = [point('2026-08-18', { net: -300 }), point('2026-08-19', { net: -272 })];
    const geo = geometry(points, ['net'])!;
    expect(geo.zeroY).toBeGreaterThanOrEqual(BOX.top);
    expect(geo.zeroY).toBeLessThanOrEqual(BOX.height - BOX.bottom);
  });

  it('grows y downwards, so a bigger number sits higher on the screen', () => {
    const points = [point('2026-08-18', { net: -100 }), point('2026-08-19', { net: 100 })];
    const geo = geometry(points, ['net'])!;
    expect(geo.points[1]!.y.net).toBeLessThan(geo.points[0]!.y.net);
  });

  it('labels the last value of every visible line, so identity is never colour alone', () => {
    const points = [point('2026-08-18'), point('2026-09-04', { net: -272, ev: 55.64 })];
    const geo = geometry(points, ['net', 'ev'])!;
    // Keyed, not positional: `spread` orders the labels top to bottom on screen, while colour
    // is bound by `key`, so the fixed series order survives regardless of where a line ends.
    expect(Object.fromEntries(geo.ends.map((end) => [end.key, end.label]))).toEqual({ net: '−272', ev: '56' });
  });

  it('pushes end labels apart when two lines finish on top of each other', () => {
    // The founder's own history ends at −272 and +56, a few viewBox units apart: one smudge.
    const points = [point('2026-08-18'), point('2026-09-04', { net: -272, ev: 55.64 })];
    const geo = geometry(points, ['net', 'ev'])!;
    const [above, below] = [...geo.ends].sort((a, b) => a.y - b.y);
    expect(below!.y - above!.y).toBeGreaterThanOrEqual(LABEL_GAP);
  });

  it('moves the label but never the line it names', () => {
    const points = [point('2026-08-18'), point('2026-09-04', { net: -272, ev: 55.64 })];
    const geo = geometry(points, ['net', 'ev'])!;
    const last = geo.points[geo.points.length - 1]!;
    // The dot and the path still sit on the true value; only the text was nudged.
    expect(last.y.net).not.toBe(last.y.ev);
    expect(geo.paths.find((path) => path.key === 'net')!.d).toContain(last.y.net.toFixed(1));
  });

  it('never prints a negative zero on the axis', () => {
    const points = [point('2026-08-18', { net: -5 }), point('2026-08-19', { net: 5 })];
    const geo = geometry(points, ['net'])!;
    expect(geo.yTicks.map((tick) => tick.label)).not.toContain('-0');
  });

  it('keeps every gridline inside the drawn domain', () => {
    const points = [point('2026-08-18', { net: -2091 }), point('2026-08-19', { net: 1819 })];
    const geo = geometry(points, ['net'])!;
    expect(geo.yTicks.length).toBeGreaterThan(2);
    for (const tick of geo.yTicks) {
      expect(tick.value).toBeGreaterThanOrEqual(geo.min);
      expect(tick.value).toBeLessThanOrEqual(geo.max);
    }
  });
});

describe('the four series', () => {
  it('decompose the actual line, which is why they are drawn together', () => {
    // Real numbers from the founder's own history on 2026-09-04.
    const net = -272.0;
    const showdown = 1819.2;
    const nonShowdown = -2091.2;
    expect(showdown + nonShowdown).toBeCloseTo(net, 6);
  });

  it('carries a second encoding beside colour for every line', () => {
    // Colour-blind readers, printouts and forced-colours mode all lose the palette; the dash
    // pattern and the end label survive all three.
    const solid = SERIES.filter((series) => series.dash === '');
    expect(solid.map((series) => series.key)).toEqual(['net']);
    expect(new Set(SERIES.map((series) => series.dash)).size).toBeGreaterThan(1);
  });
});

describe('nearestPoint', () => {
  it('snaps the crosshair to the closest day', () => {
    const points = [point('2026-08-01'), point('2026-08-11'), point('2026-08-21')];
    const geo = geometry(points, ['net'])!;
    const target = geo.points[1]!;
    expect(nearestPoint(geo.points, target.x + 2)!.day).toBe('2026-08-11');
    expect(nearestPoint(geo.points, 0)!.day).toBe('2026-08-01');
    expect(nearestPoint(geo.points, 10_000)!.day).toBe('2026-08-21');
  });

  it('has nothing to snap to on an empty chart', () => {
    expect(nearestPoint([], 10)).toBeNull();
  });
});

describe('spread', () => {
  it('leaves labels alone when they already clear each other', () => {
    const ends = [
      { key: 'net' as const, x: 0, y: 10, label: 'a' },
      { key: 'ev' as const, x: 0, y: 90, label: 'b' },
    ];
    expect(spread(ends).map((end) => end.y)).toEqual([10, 90]);
  });

  it('never reorders them, so a label cannot cross another and swap identities', () => {
    const ends = [
      { key: 'showdown' as const, x: 0, y: 50, label: 'c' },
      { key: 'net' as const, x: 0, y: 10, label: 'a' },
      { key: 'ev' as const, x: 0, y: 12, label: 'b' },
    ];
    const out = spread(ends, 12);
    expect(out.map((end) => end.key)).toEqual(['net', 'ev', 'showdown']);
    for (let at = 1; at < out.length; at += 1) expect(out[at]!.y).toBeGreaterThanOrEqual(out[at - 1]!.y);
  });

  it('separates a whole stack of coincident labels', () => {
    const keys = ['net', 'ev', 'showdown', 'nonShowdown'] as const;
    const out = spread(keys.map((key) => ({ key, x: 0, y: 40, label: key })), 12);
    expect(out.map((end) => end.y)).toEqual([40, 52, 64, 76]);
  });
});
