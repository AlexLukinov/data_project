// @vitest-environment happy-dom
/**
 * The replayer's two F.12a fixes where they are wired (ADR-053): "Compare here" carries the whole
 * situation, and the pot-odds panels take the reader's numbers and give the hand's back.
 */
import type { HandState, NodeKey } from '@poker/core';
import { nodeKey, nodeKeyEquals, step } from '@poker/core';
import { HandReplayer } from '@poker/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { situationFromQuery } from '~/ranges/situation';

import { GG_HAND } from '../../../../../packages/poker-core/test/fixtures/hand';
import HandStudy from './HandStudy.vue';

vi.mock('~/stores/ranges', () => ({ useRangesStore: () => ({ lookup: async () => [] }) }));
vi.mock('~/pool/api', () => ({ createPoolApi: () => ({ frequencies: async () => null, realization: async () => null }) }));

const NODE: NodeKey = nodeKey('BB', {
  villain_position: 'CO',
  street: 'flop',
  stake: 'NL10',
  action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call'), step('CO', 'bet', { size_pct: 0.33 })],
});

/** A `NuxtLink` that keeps its `to`, so the test can read the query the page built. */
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup: (props, { slots }) => () => h('a', { 'data-to': JSON.stringify(props.to) }, slots.default?.()),
});

function at(pot: number, toCall: number): HandState {
  return { index: 7, street: 'flop', board: ['Kh', '7d', '2c'], pot, actor: 0, toAct: 0, toCall } as unknown as HandState;
}

async function study() {
  const wrapper = mount(HandStudy, {
    props: { hand: GG_HAND },
    global: { components: { NuxtLink }, stubs: { HandReplayer: true, EquityCalculator: true, ComboDistributionPanel: true, RangeMatrix: true } },
  });
  return wrapper;
}

async function reach(wrapper: Awaited<ReturnType<typeof study>>, node: NodeKey, state: HandState) {
  wrapper.findComponent(HandReplayer).vm.$emit('nodeChange', node, state);
  await flushPromises();
}

const oddsInput = (wrapper: Awaited<ReturnType<typeof study>>, n: number) => wrapper.find('[data-testid="study-pot-odds"]').findAll('input')[n]!;
const has = (wrapper: Awaited<ReturnType<typeof study>>, id: string) => wrapper.find(`[data-testid="${id}"]`).exists();

describe('HandStudy — the situation link and the bound panels', () => {
  beforeEach(() => {
    vi.stubGlobal('useApi', () => ({}));
    vi.stubGlobal('useEquityService', () => ({ service: { compute: vi.fn(), cancel: vi.fn() } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('links to the compare page with the whole situation, which reads back as the same node', async () => {
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));
    const to = JSON.parse(wrapper.find('[data-testid="study-compare"]').attributes('data-to')!) as { path: string; query: Record<string, string> };
    expect(to.path).toBe('/ranges/compare');
    expect(Object.keys(to.query)).toEqual(['node']);
    const read = situationFromQuery(to.query);
    expect(read.problem).toBeNull();
    expect(nodeKeyEquals(read.key!, NODE)).toBe(true);
  });

  it("takes an edited bet, lets the call follow it, says so, and gives the hand's numbers back", async () => {
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));
    // The pot before the bet is 13 - 4 = 9; the call is the bet.
    expect([oddsInput(wrapper, 0).element.value, oddsInput(wrapper, 1).element.value]).toEqual(['9', '4']);
    expect(has(wrapper, 'study-odds-edited')).toBe(false);

    await oddsInput(wrapper, 1).setValue('9');
    await flushPromises();
    expect(wrapper.find('[data-testid="odds-explain"]').text()).toContain('Calling 9 to win 18');
    expect(has(wrapper, 'study-odds-edited')).toBe(true);

    await wrapper.find('[data-testid="study-odds-reset"]').trigger('click');
    await flushPromises();
    expect(oddsInput(wrapper, 1).element.value).toBe('4');
    expect(has(wrapper, 'study-odds-edited')).toBe(false);
  });

  it("starts the next step with different numbers on that step's numbers", async () => {
    const wrapper = await study();
    await reach(wrapper, NODE, at(13, 4));
    await oddsInput(wrapper, 1).setValue('9');
    await reach(wrapper, NODE, at(30, 10));
    expect([oddsInput(wrapper, 0).element.value, oddsInput(wrapper, 1).element.value]).toEqual(['20', '10']);
    expect(has(wrapper, 'study-odds-edited')).toBe(false);
  });
});
