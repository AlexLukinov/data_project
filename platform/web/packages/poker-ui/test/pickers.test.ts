// @vitest-environment happy-dom
import { cardToString, parseCard, parseCards, parseRange } from '@poker/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import BoardSelector from '../src/components/BoardSelector.vue';
import CardPicker from '../src/components/CardPicker.vue';
import CardRemovalPanel from '../src/components/CardRemovalPanel.vue';

const button = (wrapper: ReturnType<typeof mount>, card: string) => wrapper.find(`button[aria-label="${cardToString(parseCard(card)).replace('c', '♣').replace('d', '♦').replace('h', '♥').replace('s', '♠')}"]`);

describe('CardPicker', () => {
  it('renders 52 toggles, marks selected and disables taken cards', async () => {
    const wrapper = mount(CardPicker, { props: { selected: parseCards('As'), disabled: parseCards('Kd') } });
    expect(wrapper.findAll('button')).toHaveLength(52);
    expect(button(wrapper, 'As').attributes('aria-pressed')).toBe('true');
    expect(button(wrapper, 'Kd').attributes('disabled')).toBeDefined();
    await button(wrapper, 'Qh').trigger('click');
    expect(wrapper.emitted('toggle')![0]).toEqual([parseCard('Qh')]);
  });
});

describe('BoardSelector', () => {
  it('adds board cards up to five and removes them from their chips', async () => {
    const wrapper = mount(BoardSelector, { props: { board: parseCards('Kh 7d 2c 9s 3h'), deadCards: [] } });
    expect(wrapper.text()).toContain('River');
    await button(wrapper, 'As').trigger('click');
    expect(wrapper.emitted('update:board')).toBeUndefined(); // sixth card refused
    await wrapper.find('[aria-label="board"] button').trigger('click');
    expect((wrapper.emitted('update:board')![0]![0] as number[]).length).toBe(4);
  });

  it('adds a card to the board, or to the dead cards in dead mode', async () => {
    const wrapper = mount(BoardSelector, { props: { board: [], deadCards: [] } });
    expect(wrapper.text()).toContain('Preflop');
    await button(wrapper, 'Kh').trigger('click');
    expect(wrapper.emitted('update:board')![0]).toEqual([[parseCard('Kh')]]);
    await wrapper.find('input[value="dead"]').setValue();
    await button(wrapper, 'Qh').trigger('click');
    expect(wrapper.emitted('update:deadCards')![0]).toEqual([[parseCard('Qh')]]);
  });
});

describe('CardRemovalPanel', () => {
  it('counts what dead cards remove and toggles them', async () => {
    const wrapper = mount(CardRemovalPanel, { props: { range: parseRange('AA,KK').range, deadCards: parseCards('As') } });
    expect(wrapper.text()).toContain('12 combos (12 weighted) → 9 (9 weighted) after 1 dead card');
    expect(wrapper.text()).toContain('removes 3 combos');
    await button(wrapper, 'Kd').trigger('click');
    expect(wrapper.emitted('update:deadCards')![0]).toEqual([parseCards('As Kd')]);
    await wrapper.find('button.pk-btn').trigger('click');
    expect(wrapper.emitted('update:deadCards')![1]).toEqual([[]]);
  });
});
