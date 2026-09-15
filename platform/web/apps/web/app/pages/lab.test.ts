// @vitest-environment happy-dom
import { NumberInput, PotOddsPanel, RangeMatrix } from '@poker/ui';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Lab from './lab.vue';

/** The page with every panel stubbed but its own number boxes, which are what is under test. */
function page() {
  return mount(Lab, { shallow: true, global: { stubs: { NumberInput: false } } });
}

/** The number box inside the label that starts with `words`. */
function boxAfter(w: ReturnType<typeof page>, words: string) {
  const label = w.findAll('label').find((l) => l.text().startsWith(words));
  if (label === undefined) throw new Error(`no label starting "${words}"`);
  return label.findComponent(NumberInput).find('input');
}

const brushes = (w: ReturnType<typeof page>) => w.findAllComponents(RangeMatrix).map((m) => m.props('brush'));

describe('the Range Lab number boxes', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn());
    vi.stubGlobal('useEquityService', () => ({ service: { compute: vi.fn(), cancel: vi.fn() } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the brush when the custom strength is outside 0 to 1 or not a number', async () => {
    const w = page();
    const custom = boxAfter(w, 'custom');
    await custom.setValue('1,5');
    await custom.setValue('x');
    expect(brushes(w)).toEqual([1, 1]);
    expect(custom.attributes('aria-invalid')).toBe('true');
  });

  it('paints with a custom strength once it is entered, read with a comma or a dot', async () => {
    const w = page();
    const custom = boxAfter(w, 'custom');
    // Typed, not yet entered: `setValue` would fire the change too.
    (custom.element as HTMLInputElement).value = '0,4';
    await custom.trigger('input');
    expect(brushes(w)).toEqual([1, 1]);
    await custom.trigger('change');
    expect(brushes(w)).toEqual([0.4, 0.4]);
    await custom.trigger('blur');
    expect((custom.element as HTMLInputElement).value).toBe('0.4');
  });

  it('refuses a pot below 1 and shares a typed pot and bet with the pot-odds panel', async () => {
    const w = page();
    await boxAfter(w, 'pot').setValue('0,5');
    expect(w.findComponent(PotOddsPanel).props('pot')).toBe(100);
    await boxAfter(w, 'pot').setValue('12,5');
    await boxAfter(w, 'bet').setValue('6.25');
    expect(w.findComponent(PotOddsPanel).props()).toMatchObject({ pot: 12.5, bet: 6.25 });
  });

  it('holds the equity thresholds between 0 and 100', async () => {
    const w = page();
    const continues = boxAfter(w, 'villain continues');
    await continues.setValue('101');
    expect(continues.attributes('aria-invalid')).toBe('true');
    await continues.trigger('blur');
    expect((continues.element as HTMLInputElement).value).toBe('40');
    expect((boxAfter(w, 'hero value').element as HTMLInputElement).value).toBe('60');
  });
});
