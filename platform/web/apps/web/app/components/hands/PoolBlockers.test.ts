// @vitest-environment happy-dom
/**
 * The pool-fed blocker table (plan H.7): one ask on a press and none before it, the measured half
 * and the assumed half said before the rows, the withheld state kept as words, a refusal as a
 * sentence, a picked row rung on the host's grid, a stale answer dropped, and one pipeline at a
 * time across steps.
 */
import type { NodeKey } from '@poker/core';
import { COMBO_COUNT, comboIndex, nodeKey, parseCard, parseRange, step } from '@poker/core';
import { BlockerPanel } from '@poker/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { facingNode } from '~/analyze/facing';
import { WHOLE_FIELD } from '~/hands/reveal';
import type { NodeFrequencies } from '~/pool/api';

import PoolBlockers from './PoolBlockers.vue';

const NODE: NodeKey = nodeKey('CO', {
  villain_position: 'BB',
  street: 'flop',
  action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call'), step('CO', 'bet', { size_pct: 0.33 })],
});
const FACING = facingNode(NODE)!;
const LATER = facingNode({ ...NODE, action_sequence: [...NODE.action_sequence, step('BB', 'raise'), step('CO', 'raise')] })!;

/** The gate's own fields (plan G.3): none of these tests is about them. */
const GATE = { min_n: 100, intervals: {}, players: 400, design_effect: null, max_half_width: 0.05, min_players: 30 };

function tier1(enough = true, fold = 0.6): NodeFrequencies {
  return { ...GATE, tier: 1, sample_size: enough ? 3988 : 57, enough, actions: {}, frequencies: enough ? { fold, call: 1 - fold } : {} };
}

const CHART = parseRange('AA,KK,22:0.5').range;
const combo = (text: string) => comboIndex(parseCard(text.slice(0, 2)), parseCard(text.slice(2)));
const AA = combo('AsAh');
/** AA strongest, then KK, then 22 — 15 weighted combos, so a 40% cut is exactly the six aces. */
const EQUITIES = (() => {
  const equities = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  for (let index = 0; index < COMBO_COUNT; index += 1) {
    if ((CHART.weights[index] ?? 0) <= 0) continue;
    equities[index] = [combo('AsAh'), combo('AsAd'), combo('AsAc'), combo('AhAd'), combo('AhAc'), combo('AdAc')].includes(index) ? 0.9 : [combo('KsKh'), combo('KsKd'), combo('KsKc'), combo('KhKd'), combo('KhKc'), combo('KdKc')].includes(index) ? 0.6 : 0.3;
  }
  return equities;
})();

const api = { frequencies: vi.fn() };
const NuxtLink = defineComponent({ setup: (_, { slots }) => () => h('a', slots.default?.()) });

function panel(extra: Record<string, unknown> = {}) {
  return mount(PoolBlockers, {
    props: { facing: FACING, hero: parseRange('AA,AKs,76s').range, chart: CHART, equities: EQUITIES, board: [], pot: 9, bet: 4, group: WHOLE_FIELD, api, ...extra },
    global: { components: { NuxtLink }, stubs: { PoolDataBadge: true } },
  });
}
let wrapper: ReturnType<typeof panel>;
const has = (id: string) => wrapper.find(`[data-testid="${id}"]`).exists();
const said = (id: string) => wrapper.find(`[data-testid="${id}"]`).text();

async function press(): Promise<void> {
  await wrapper.find('[data-testid="blockers-ask"]').trigger('click');
  await flushPromises();
}

describe('PoolBlockers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.frequencies.mockResolvedValue(tier1());
    wrapper = panel();
  });

  it('names the two seats, and asks nothing until the press', () => {
    expect(wrapper.text()).toContain('Which of CO’s hands block the answer');
    expect(said('blockers-ask')).toContain('Ask the pool how BB answers');
    expect(api.frequencies).not.toHaveBeenCalled();
  });

  it('asks tier 1 at the facing node for the chosen group, says which half is measured, and feeds the table the cut', async () => {
    await wrapper.setProps({ group: { key: 'c1', label: 'regs' } });
    await press();
    expect(api.frequencies).toHaveBeenCalledWith(FACING, 'c1');
    expect(said('blockers-provenance')).toContain('The pool folds 60.0% of the time here as regs, so 40.0% of your chart for BB is taken as what continues');
    expect(said('blockers-provenance')).toContain('no solver was asked');
    expect(said('blockers-cutoff')).toContain('6 combos continue');
    const table = wrapper.findComponent(BlockerPanel);
    expect(table.props('selectable')).toBe(true);
    expect(table.props('villainCall').weights[AA]).toBe(1);
    expect(table.props('villainFold').weights[AA]).toBe(0);
    expect(table.props('villainFold').weights[combo('KsKh')]).toBe(1);
    expect(table.props('pot')).toBe(9);
  });

  it('keeps the rate and asks for the chart when there is none for the defender', async () => {
    await wrapper.setProps({ chart: null, equities: null });
    await press();
    expect(said('blockers-provenance')).toContain('The pool folds 60.0%');
    expect(said('blockers-no-chart')).toContain('needs your chart for BB here');
    expect(wrapper.findComponent(BlockerPanel).exists()).toBe(false);
  });

  it('waits for the equities, and cuts the chart the moment they land, without asking again', async () => {
    await wrapper.setProps({ equities: null });
    await press();
    expect(said('blockers-no-equities')).toContain('once the equities');
    await wrapper.setProps({ equities: EQUITIES });
    await flushPromises();
    expect(wrapper.findComponent(BlockerPanel).exists()).toBe(true);
    expect(api.frequencies).toHaveBeenCalledTimes(1);
  });

  it('keeps the words and draws no table when the frequency was withheld', async () => {
    api.frequencies.mockResolvedValue(tier1(false));
    await press();
    expect(said('blockers-thin')).toContain('too few times to say how often it folds — 57 of the 100 decisions needed');
    expect(has('blockers-provenance')).toBe(false);
    expect(wrapper.findComponent(BlockerPanel).exists()).toBe(false);
  });

  /* Plan G.3 (ADR-076): a rate above the floor travels with its interval and the players behind it. */
  it('prints the fold rate’s interval and its players when the server sent them, and says why a measured rate was still withheld', async () => {
    const interval = { low: 0.52, high: 0.68, n: 3988, level: 0.95, method: 'cluster' as const, players: 412 };
    api.frequencies.mockResolvedValue({ ...tier1(), intervals: { fold: interval }, players: 412 });
    await press();
    expect(said('blockers-provenance')).toContain('The pool folds 60.0% of the time here as the whole field (between 52.0% and 68.0%, over 412 players)');

    api.frequencies.mockResolvedValue({ ...tier1(), enough: false, sample_size: 240, min_n: 1800, intervals: { fold: { ...interval, low: 0.4, high: 0.8, players: 31 } }, players: 31 });
    await press();
    expect(said('blockers-thin')).toContain('The pool folds about 60.0% here as the whole field (between 40.0% and 80.0%, over 31 players), but that is too wide a claim to cut a range by — 240 of the 1,800 decisions needed');
    expect(wrapper.findComponent(BlockerPanel).exists()).toBe(false);
  });

  it('words a refusal, naming the button as the retry', async () => {
    api.frequencies.mockRejectedValue(Object.assign(new Error('FetchError'), { name: 'FetchError', status: 500, data: { detail: 'Internal server error' } }));
    await press();
    expect(said('blockers-error')).toContain('The pool could not be asked how BB answers this bet.');
    expect(said('blockers-error')).toContain('Press Ask the pool again to try once more.');
    expect(wrapper.find('[data-testid="blockers-ask"]').attributes('disabled')).toBeUndefined();
  });

  it('hands a picked row up, so the host can ring it on the bettor’s grid', async () => {
    await press();
    wrapper.findComponent(BlockerPanel).vm.$emit('comboSelect', AA);
    await flushPromises();
    // The press itself emitted `null` first: a new table starts unpinned, and so must the host's ring.
    expect(wrapper.emitted('comboSelect')).toEqual([[null], [AA]]);
    expect(wrapper.findComponent(BlockerPanel).props('selectedCombo')).toBe(AA);
  });

  it('names the group the split was cut with, not the one chosen since', async () => {
    await press();
    expect(said('blockers-provenance')).toContain('as the whole field');
    await wrapper.setProps({ group: { key: 'c1', label: 'regs' } });
    expect(said('blockers-provenance')).toContain('as the whole field');
    expect(api.frequencies).toHaveBeenCalledTimes(1);
  });

  it('clears the host’s ring when a new ask clears the table, and keeps one ask at a time across steps', async () => {
    await press();
    wrapper.findComponent(BlockerPanel).vm.$emit('comboSelect', AA);
    await flushPromises();
    let resolveAnswer!: (value: NodeFrequencies) => void;
    api.frequencies.mockReturnValueOnce(new Promise<NodeFrequencies>((resolve) => (resolveAnswer = resolve)));
    await press();
    expect(wrapper.emitted('comboSelect')!.at(-1)).toEqual([null]);
    // Step away and back while the ask is in flight: the button waits for it instead of starting a twin.
    await wrapper.setProps({ facing: LATER });
    await wrapper.setProps({ facing: FACING });
    expect(wrapper.find('[data-testid="blockers-ask"]').attributes('disabled')).toBeDefined();
    resolveAnswer(tier1());
    await flushPromises();
    expect(wrapper.find('[data-testid="blockers-ask"]').attributes('disabled')).toBeUndefined();
    expect(has('blockers-split')).toBe(false);
    expect(api.frequencies).toHaveBeenCalledTimes(2);
  });

  it('asks for the bettor’s chart when there is none to rank', () => {
    wrapper = panel({ hero: null });
    expect(said('blockers-no-hero')).toContain('Ranking needs your chart for CO here');
    expect(has('blockers-ask')).toBe(false);
  });
});
