// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import MetricValue from '../src/components/MetricValue.vue';
import { GLOSSARY } from '../src/glossary';

/** The intervals below are the ones `platform/tests/test_intervals.py` works by hand. */
const HERO_WINRATE = { value: -1.37, low: -2.624, high: -0.116, n: 19802 }; // sd 0.9 bb, 95%
const THIN_WINRATE = { value: -1.37, low: -15.229, high: 12.489, n: 200 }; // same sd, 200 hands
const VPIP = { value: 22.96, low: 22.38, high: 23.55, n: 19802 }; // Wilson
const NOTHING_YET = { value: 0, low: 0, high: 56.15, n: 3 }; // Wilson on 0 of 3

const text = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-testid="${id}"]`).text();
const has = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-testid="${id}"]`).exists();

describe('MetricValue', () => {
  it('prints a symmetric interval as one band, with the unit and the sample size', () => {
    const w = mount(MetricValue, { props: { ...HERO_WINRATE, unit: 'bb/100', signed: true } });
    expect(text(w, 'metric-number')).toBe('-1.37');
    // A mean's interval is symmetric by construction: 1.254 either side of -1.37.
    expect(text(w, 'metric-band')).toBe('± 1.25');
    expect(text(w, 'metric-unit')).toBe('bb/100');
    expect(text(w, 'metric-n')).toBe('n = 19,802');
    expect(has(w, 'metric-bounds')).toBe(false);
  });

  it('is the same point estimate over 200 hands and visibly not the same claim', () => {
    const w = mount(MetricValue, { props: { ...THIN_WINRATE, unit: 'bb/100' } });
    expect(text(w, 'metric-number')).toBe('-1.37'); // identical to the 19,802-hand tile
    expect(text(w, 'metric-band')).toBe('± 13.86'); // and eleven times as wide
    expect(text(w, 'metric-n')).toBe('n = 200');
  });

  it('prints the bounds themselves when Wilson leans to one side', () => {
    // 22.38 is 0.58 below the value and 23.55 is 0.59 above it: at two decimals those are
    // different numbers, so a single ± would be a lie about which way the interval leans.
    const w = mount(MetricValue, { props: { ...VPIP, unit: '%' } });
    expect(has(w, 'metric-band')).toBe(false);
    expect(text(w, 'metric-bounds')).toBe('22.38 – 23.55');
    expect(text(w, 'metric-n')).toBe('n = 19,802');
  });

  it('shows how little three observations say', () => {
    // The case the whole step exists for: a Wald interval would render "0.00 ± 0.00, n = 3".
    const w = mount(MetricValue, { props: { ...NOTHING_YET, unit: '%' } });
    expect(text(w, 'metric-number')).toBe('0');
    expect(text(w, 'metric-bounds')).toBe('0 – 56.15');
    expect(text(w, 'metric-n')).toBe('n = 3');
  });

  it('labels the interval with its level and explains it on hover', () => {
    const w = mount(MetricValue, { props: { ...VPIP, level: 99 } });
    expect(w.find('.pk-term-text').text()).toBe('99% CI');
    expect(w.find('[role="tooltip"]').text()).toContain(GLOSSARY.confidenceInterval.definition);
  });

  it('signs a positive value only when asked', () => {
    const up = { value: 2.14, low: 0.89, high: 3.39, n: 19802 };
    expect(text(mount(MetricValue, { props: { ...up, signed: true } }), 'metric-number')).toBe('+2.14');
    expect(text(mount(MetricValue, { props: up }), 'metric-number')).toBe('2.14');
  });

  it('shows the value alone when the server sent no interval', () => {
    const w = mount(MetricValue, { props: { value: 2.4, n: 5000 } });
    expect(text(w, 'metric-number')).toBe('2.4');
    expect(has(w, 'metric-band')).toBe(false);
    expect(has(w, 'metric-bounds')).toBe(false);
    expect(w.find('.pk-term-text').exists()).toBe(false); // no interval, no CI label
    expect(text(w, 'metric-n')).toBe('n = 5,000');
  });

  it('says nothing rather than something wrong when there is no value', () => {
    const w = mount(MetricValue, { props: { value: null, low: 1, high: 2, n: 0 } });
    expect(text(w, 'metric-number')).toBe('—');
    expect(has(w, 'metric-band')).toBe(false);
    expect(has(w, 'metric-bounds')).toBe(false);
  });

  it('ignores a non-finite bound instead of rendering NaN', () => {
    const w = mount(MetricValue, { props: { value: 1.5, low: Number.NaN, high: 2, n: 10 } });
    expect(text(w, 'metric-number')).toBe('1.5');
    expect(has(w, 'metric-band')).toBe(false);
    expect(has(w, 'metric-bounds')).toBe(false);
  });

  it('omits the sample size when there is none to report', () => {
    const w = mount(MetricValue, { props: { value: 1.5 } });
    expect(has(w, 'metric-n')).toBe(false);
    expect(text(w, 'metric-value')).toBe('1.5');
  });
});

// Appended by plan D.4, MetricValue's first real consumer: a row of KPI tiles reads at one
// precision, so the trimming that is right for a lone figure is wrong for a grid of them.
describe('MetricValue — fixed decimals', () => {
  it('trims trailing zeros by default, as every existing caller expects', () => {
    const w = mount(MetricValue, { props: { value: 22.96, digits: 1 } });
    expect(text(w, 'metric-number')).toBe('23');
  });

  it('keeps them when asked, so 22.96 does not read as less precise than its own band', () => {
    const w = mount(MetricValue, { props: { value: 22.96, digits: 1, fixed: true } });
    expect(text(w, 'metric-number')).toBe('23.0');
  });

  it('pads the band to the same precision as the value', () => {
    const w = mount(MetricValue, { props: { value: 23, low: 22.4, high: 23.6, digits: 1, fixed: true } });
    expect(text(w, 'metric-number')).toBe('23.0');
    expect(text(w, 'metric-band')).toBe('± 0.6');
  });

  it('pads asymmetric bounds too', () => {
    const w = mount(MetricValue, { props: { value: 56.57, low: 52.8, high: 60.3, digits: 1, fixed: true } });
    expect(text(w, 'metric-bounds')).toBe('52.8 – 60.3');
  });

  it('groups a hand count, which is the number a reader scans', () => {
    // The tile printed `19802` while its own support line two rows below said `n = 19,802`.
    const w = mount(MetricValue, { props: { value: 19802, n: 19802, digits: 0, fixed: true } });
    expect(text(w, 'metric-number')).toBe('19,802');
    expect(text(w, 'metric-n')).toBe('n = 19,802');
  });

  it('uses the minus sign the grid, the tables and the winnings axis use', () => {
    const w = mount(MetricValue, { props: { value: -1.374, digits: 2, fixed: true, signed: true } });
    expect(text(w, 'metric-number')).toBe('−1.37');
  });

  it('still signs a positive, and does not touch a bare zero', () => {
    expect(text(mount(MetricValue, { props: { value: 0.281, digits: 2, fixed: true, signed: true } }), 'metric-number')).toBe('+0.28');
    expect(text(mount(MetricValue, { props: { value: 0, digits: 2, fixed: true, signed: true } }), 'metric-number')).toBe('0.00');
  });
});
