// @vitest-environment happy-dom
/**
 * The replayer and the table it draws. The hand is the same real one `poker-core` replays, so
 * the component is tested against the values the API actually produces rather than a mock-up.
 */
import type { NodeKey } from '@poker/core';
import { nodeKeyLabel, replayStates } from '@poker/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { GG_HAND } from '../../poker-core/test/fixtures/hand';
import HandReplayer from '../src/components/HandReplayer.vue';
import PokerTable from '../src/components/PokerTable.vue';
import { tableSeats } from '../src/table';

const STATES = replayStates(GG_HAND);

function replayer(step = 0) {
  return mount(HandReplayer, { props: { hand: GG_HAND, modelValue: step, 'onUpdate:modelValue': (v: number) => void v } });
}

describe('PokerTable', () => {
  it('draws the seats, the board and the pot at one point in the hand', () => {
    const wrapper = mount(PokerTable, {
      props: { seats: tableSeats(GG_HAND, STATES[10]!), board: STATES[10]!.board, pot: STATES[10]!.pot, activeSeat: STATES[10]!.actor, bigBlind: 0.5, buttonSeat: 1 },
    });
    expect(wrapper.find('[data-testid="table-board"]').text()).toContain('8');
    expect(wrapper.find('[data-testid="table-pot"]').text()).toContain('19.50');
    expect(wrapper.find('[data-testid="table-seat-2"]').text()).toContain('SB · Hero');
    // Hero has bet 7 of a 50 stack after putting 6 in preflop: 37 behind, 7 in front.
    expect(wrapper.find('[data-testid="table-seat-2"]').text()).toContain('74bb');
    expect(wrapper.find('[data-testid="table-chips-2"]').text()).toBe('7.00');
  });

  it('shows only the cards the hand revealed', () => {
    const wrapper = mount(PokerTable, { props: { seats: tableSeats(GG_HAND, STATES[0]!), board: [], pot: 0, activeSeat: 2 } });
    expect(wrapper.find('[data-testid="table-seat-2"]').text()).toContain('Q');
    expect(wrapper.find('[data-testid="table-seat-1"]').text()).not.toContain('Q');
    expect(wrapper.find('[data-testid="table-board"]').text()).toContain('no board yet');
  });

  it('reports the seat that was clicked', async () => {
    const wrapper = mount(PokerTable, { props: { seats: tableSeats(GG_HAND, STATES[0]!), board: [], pot: 0, activeSeat: null } });
    await wrapper.find('[data-testid="table-seat-3"]').trigger('click');
    expect(wrapper.emitted('seatClick')![0]).toEqual([3]);
  });
});

describe('HandReplayer', () => {
  it('steps forward and back, and stops at both ends', async () => {
    const wrapper = replayer(0);
    expect(wrapper.find('[data-testid="replay-back"]').attributes('disabled')).toBeDefined();
    await wrapper.find('[data-testid="replay-next"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([1]);
  });

  it('reports the situation the hand is in at every step', async () => {
    const wrapper = replayer(0);
    expect(wrapper.emitted('nodeChange')![0]![0]).toBeNull();

    await wrapper.setProps({ modelValue: 7 });
    const node = wrapper.emitted('nodeChange')!.at(-1)![0] as NodeKey;
    expect(nodeKeyLabel(node)).toBe('SB 3-bet vs BTN 3bb · 100bb · NL50');
  });

  it('names the winner at the end, since taking the pot is not an action', async () => {
    const wrapper = replayer(GG_HAND.actions.length);
    expect(wrapper.find('[data-testid="table-wins-2"]').exists()).toBe(true);
    await wrapper.setProps({ modelValue: 5 });
    expect(wrapper.find('[data-testid="table-wins-2"]').exists()).toBe(false);
  });

  it('jumps to a street and offers only the streets the hand reached', async () => {
    const wrapper = replayer(0);
    expect(wrapper.findAll('.pk-streets button').map((b) => b.text())).toEqual(['preflop 1', 'flop 2']);
    await wrapper.find('[data-testid="replay-street-flop"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([9]);
  });

  it('seeks from the action log, which shows the pot after each action', async () => {
    const wrapper = replayer(0);
    expect(wrapper.find('[data-testid="log-step-7"]').text()).toContain('raises to 6.00');
    expect(wrapper.find('[data-testid="log-step-7"]').text()).toContain('pot 8.00');
    await wrapper.find('[data-testid="log-step-10"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([10]);
  });

  it('steps with the arrow keys but not while a field has focus', async () => {
    const wrapper = replayer(3);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([4]);

    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([4]);
    input.remove();
    wrapper.unmount();
  });
});
