// @vitest-environment happy-dom
/**
 * The blocker trainer's reveal (spec §16), and the last live instance of the UX audit's §2.1
 * "controls that render editable and do nothing" — this one in the trainers (ADR-074).
 *
 * `BlockerPanel` gives every ranked row a pointer cursor and a hover highlight and emits
 * `comboSelect` on click. Mounted with neither the listener nor `selectedCombo`, the whole table
 * advertised itself as clickable and answered a click with nothing. This is the only test the
 * trainer has, which is why the panel sits here unstubbed: the click has to reach the real rows.
 */
import { BlockerPanel, RangeMatrix } from '@poker/ui';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { BlockersSpot } from '~/train/types';

import BlockersTrainer from './BlockersTrainer.vue';

const SPOT: BlockersSpot = {
  mode: 'blockers',
  seed: 1,
  hash: 'blockers:1',
  label: 'BTN bet vs BB · flop Kd 9h 4c',
  questions: [],
  bucket: 'dry',
  heroText: 'AA,KK,AKs,AQs,A5s',
  villainText: 'QQ,JJ,TT,KQs,T9s',
  villainLabel: 'BB call',
  boardText: 'Kd 9h 4c',
  potBB: 6,
  betBB: 4,
  candidates: ['AhKh', 'As5s', 'AdQd', 'AcKc'],
};

function render(spot: BlockersSpot = SPOT) {
  return mount(BlockersTrainer, { props: { spot, revealed: true } });
}

describe('BlockersTrainer — the ranked table', () => {
  it('pins the row a reader clicks and rings that combo on their own grid', async () => {
    const wrapper = render();
    const panel = wrapper.findComponent(BlockerPanel);
    expect(panel.props('selectedCombo')).toBeNull();

    const row = panel.find('tbody tr');
    expect(row.exists()).toBe(true);
    await row.trigger('click');

    const combo = wrapper.findComponent(BlockerPanel).props('selectedCombo');
    expect(combo).not.toBeNull();
    // The hero grid is the one to ring it on: the rows are hero's candidate combos, and the
    // second matrix holds villain's continuing range.
    expect(wrapper.findAllComponents(RangeMatrix)[0]!.props('highlightCombos')).toEqual([combo]);
  });

  it('starts the next spot with nothing pinned', async () => {
    const wrapper = render();
    await wrapper.findComponent(BlockerPanel).find('tbody tr').trigger('click');
    expect(wrapper.findComponent(BlockerPanel).props('selectedCombo')).not.toBeNull();

    await wrapper.setProps({ spot: { ...SPOT, seed: 2, hash: 'blockers:2' } });
    expect(wrapper.findComponent(BlockerPanel).props('selectedCombo')).toBeNull();
    expect(wrapper.findAllComponents(RangeMatrix)[0]!.props('highlightCombos')).toBeNull();
  });

  it('shows nothing of the ranking before the answer is in', () => {
    const wrapper = mount(BlockersTrainer, { props: { spot: SPOT, revealed: false } });
    expect(wrapper.findComponent(BlockerPanel).exists()).toBe(false);
  });
});
