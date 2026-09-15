// @vitest-environment happy-dom
import type { RakeConfig } from '@poker/core';
import { NO_RAKE } from '@poker/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';

import PotOddsTrainer from '~/components/train/PotOddsTrainer.vue';
import type { PotOddsSpot } from '~/train/types';

import type { OddsSource } from './useEditableOdds';
import { useEditableOdds } from './useEditableOdds';

const GG_RAKE: RakeConfig = { rakePct: 0.05, rakeCapBB: 3 };

describe('useEditableOdds', () => {
  it('is not edited when an edit lands back on the source number, float noise and all', () => {
    // 0.35 − 0.1 is 0.24999999999999997: what a hand's pot minus its call can come out as.
    const odds = useEditableOdds(() => ({ pot: 0.35 - 0.1, bet: 0.1 }));
    odds.pot.value = 0.3;
    expect(odds.edited.value).toBe(true);
    odds.pot.value = 0.25;
    expect(odds.edited.value).toBe(false);
  });

  it('counts an implied extra, a call and each half of the rake as an edit', () => {
    const odds = useEditableOdds(() => ({ pot: 10, bet: 5, call: 5, rakeConfig: GG_RAKE }));
    odds.impliedExtra.value = 20;
    expect(odds.edited.value).toBe(true);
    odds.reset();
    odds.call.value = null;
    expect(odds.edited.value).toBe(true);
    odds.reset();
    odds.rakeConfig.value = { ...GG_RAKE, rakeCapBB: null };
    expect(odds.edited.value).toBe(true);
    odds.reset();
    odds.rakeConfig.value = { ...GG_RAKE, rakePct: 0.1 };
    expect(odds.edited.value).toBe(true);
  });

  it('starts from the source, with no call, no rake and no implied extra unless it says otherwise', () => {
    const odds = useEditableOdds(() => ({ pot: 100, bet: 66 }));
    expect([odds.pot.value, odds.bet.value, odds.call.value, odds.impliedExtra.value]).toEqual([100, 66, null, 0]);
    expect(odds.rakeConfig.value).toEqual(NO_RAKE);
    expect(odds.edited.value).toBe(false);
  });

  it('marks an edit as edited', () => {
    const odds = useEditableOdds(() => ({ pot: 12.5, bet: 4, call: 4, rakeConfig: GG_RAKE }));
    odds.bet.value = 9;
    expect(odds.edited.value).toBe(true);
    expect(odds.pot.value).toBe(12.5);
  });

  it('takes the new numbers and forgets the edits when the source moves on', async () => {
    const source = ref<OddsSource>({ pot: 12.5, bet: 4, call: 4 });
    const odds = useEditableOdds(() => source.value);
    odds.pot.value = 30;
    odds.impliedExtra.value = 15;
    source.value = { pot: 20, bet: 10, call: 10, rakeConfig: GG_RAKE };
    await nextTick();
    expect([odds.pot.value, odds.bet.value, odds.call.value, odds.impliedExtra.value]).toEqual([20, 10, 10, 0]);
    expect(odds.rakeConfig.value).toEqual(GG_RAKE);
    expect(odds.edited.value).toBe(false);
  });

  it('puts every number back on reset', () => {
    const odds = useEditableOdds(() => ({ pot: 12.5, bet: 4, call: 4, rakeConfig: GG_RAKE }));
    odds.pot.value = 1;
    odds.bet.value = 2;
    odds.call.value = 3;
    odds.impliedExtra.value = 4;
    odds.rakeConfig.value = NO_RAKE;
    odds.reset();
    expect([odds.pot.value, odds.bet.value, odds.call.value, odds.impliedExtra.value]).toEqual([12.5, 4, 4, 0]);
    expect(odds.rakeConfig.value).toEqual(GG_RAKE);
    expect(odds.edited.value).toBe(false);
  });
});

describe('the pot-odds trainer, once revealed', () => {
  const spot = (potBB: number, betBB: number): PotOddsSpot => ({
    mode: 'potodds',
    seed: 1,
    hash: `potodds/${potBB}-${betBB}`,
    label: 'Facing a bet',
    questions: [],
    bucket: 'half pot',
    ask: 'mdf',
    potBB,
    betBB,
    rakePct: 0.05,
    rakeCapBB: 3,
    afterRake: true,
  });
  const has = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-testid="${id}"]`).exists();
  const mdf = (w: ReturnType<typeof mount>) => w.find('[data-testid="mdf-value"]').text();

  it("lets the reader push the size around, says the numbers are no longer the spot's, and puts them back", async () => {
    const w = mount(PotOddsTrainer, { props: { spot: spot(10, 5), revealed: true } });
    expect(has(w, 'odds-edited')).toBe(false);
    expect(mdf(w)).toContain('66.7%');

    await w.findAll('input')[1]!.setValue('10');
    expect(mdf(w)).toContain('50.0%');
    expect(has(w, 'odds-edited')).toBe(true);

    await w.find('[data-testid="odds-reset"]').trigger('click');
    expect(mdf(w)).toContain('66.7%');
    expect(has(w, 'odds-edited')).toBe(false);
  });

  it("starts the next spot on the next spot's numbers, not on the last edit", async () => {
    const w = mount(PotOddsTrainer, { props: { spot: spot(10, 5), revealed: true } });
    await w.findAll('input')[1]!.setValue('10');
    await w.setProps({ spot: spot(9, 3) });
    expect(mdf(w)).toContain('75.0%');
    expect(has(w, 'odds-edited')).toBe(false);
  });

  it('starts clean on a next spot that happens to have the same pot and bet', async () => {
    const w = mount(PotOddsTrainer, { props: { spot: spot(10, 5), revealed: true } });
    await w.findAll('input')[1]!.setValue('10');
    expect(has(w, 'odds-edited')).toBe(true);
    await w.setProps({ spot: { ...spot(10, 5), hash: 'the-next-spot' } });
    expect(mdf(w)).toContain('66.7%');
    expect(has(w, 'odds-edited')).toBe(false);
  });
});
