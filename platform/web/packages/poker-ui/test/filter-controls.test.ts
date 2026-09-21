// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ActionLine from '../src/components/ActionLine.vue';
import PositionPicker from '../src/components/PositionPicker.vue';
import { formatLine, isActionLine, lineWords, parseLine } from '../src/line';
import { POSITION_WORDS } from '../src/vocabulary';

const SEATS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'UNKNOWN'];

describe('PositionPicker', () => {
  it('renders the vocabulary it is given, in that order', () => {
    const wrapper = mount(PositionPicker, { props: { seats: SEATS, selected: [] } });
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(SEATS.length);
    expect(buttons.map((b) => b.text())).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB', '?']);
  });

  /** The registry's `position` carries UNKNOWN and its siblings carry '' — both need words. */
  it("gives '' and UNKNOWN readable labels rather than blank buttons", () => {
    const wrapper = mount(PositionPicker, { props: { seats: ['', 'UTG'], selected: [] } });
    expect(wrapper.find('[data-testid="seat-none"]').text()).toBe('none');
    expect(wrapper.find('[data-testid="seat-none"]').attributes('title')).toContain('Not applicable');
    const unknown = mount(PositionPicker, { props: { seats: SEATS, selected: [] } });
    expect(unknown.find('[data-testid="seat-UNKNOWN"]').attributes('title')).toContain('anonymised');
  });

  it('says what a real seat abbreviation means, from the shared seat table', () => {
    const wrapper = mount(PositionPicker, { props: { seats: SEATS, selected: [] } });
    expect(wrapper.find('[data-testid="seat-UTG"]').attributes('title')).toBe(POSITION_WORDS.UTG.definition);
    expect(wrapper.find('[data-testid="seat-CO"]').attributes('title')).toContain('Cutoff');
  });

  it('marks what is selected for a screen reader as well as for the eye', () => {
    const wrapper = mount(PositionPicker, { props: { seats: SEATS, selected: ['BTN'] } });
    expect(wrapper.find('[data-testid="seat-BTN"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('[data-testid="seat-CO"]').attributes('aria-pressed')).toBe('false');
  });

  it('replaces the choice in single mode', async () => {
    const wrapper = mount(PositionPicker, { props: { seats: SEATS, selected: ['BTN'] } });
    await wrapper.find('[data-testid="seat-CO"]').trigger('click');
    expect(wrapper.emitted('update:selected')).toEqual([[['CO']]]);
  });

  it('adds and removes in multiple mode, and keeps the seats in ring order', async () => {
    const wrapper = mount(PositionPicker, { props: { seats: SEATS, selected: ['BTN'], multiple: true } });
    await wrapper.find('[data-testid="seat-CO"]').trigger('click');
    // CO comes before BTN in the vocabulary, so the emitted list follows the ring, not the clicks.
    expect(wrapper.emitted('update:selected')![0]).toEqual([['CO', 'BTN']]);

    await wrapper.setProps({ selected: ['CO', 'BTN'] });
    await wrapper.find('[data-testid="seat-CO"]').trigger('click');
    expect(wrapper.emitted('update:selected')![1]).toEqual([['BTN']]);
  });

  it('emits nothing while disabled', async () => {
    const wrapper = mount(PositionPicker, { props: { seats: SEATS, selected: [], disabled: true } });
    await wrapper.find('[data-testid="seat-BTN"]').trigger('click');
    expect(wrapper.emitted('update:selected')).toBeUndefined();
  });
});

describe('the action-line encoding', () => {
  it('splits streets on / and actions on -', () => {
    expect(parseLine('r/x-c/')).toEqual([['r'], ['x', 'c'], []]);
    expect(parseLine('')).toEqual([[]]);
    expect(parseLine('x')).toEqual([['x']]);
  });

  it('round-trips', () => {
    for (const line of ['', 'r', 'x-c', 'r/x-c/', 'l-c/b/x-r/f']) {
      expect(formatLine(parseLine(line))).toBe(line);
    }
  });

  it('spells the letters out', () => {
    expect(lineWords('')).toBe('no action yet');
    expect(lineWords('r')).toBe('raise');
    expect(lineWords('x-c')).toBe('check-call');
    expect(lineWords('r/x-c/')).toBe('raise / check-call / …');
  });

  it('recognises a value the registry would accept', () => {
    expect(isActionLine('r/x-c/')).toBe(true);
    expect(isActionLine('')).toBe(true);
    expect(isActionLine('r-z')).toBe(false);
    expect(isActionLine('RAISE')).toBe(false);
  });
});

describe('ActionLine', () => {
  it('shows the line as words, not as letters', () => {
    const wrapper = mount(ActionLine, { props: { line: 'r/x-c/' } });
    expect(wrapper.find('[data-testid="action-line-words"]').text()).toBe('raise / check-call / …');
  });

  it('offers no controls in view mode', () => {
    const wrapper = mount(ActionLine, { props: { line: 'x' } });
    expect(wrapper.find('[data-testid="action-add-r"]').exists()).toBe(false);
  });

  it('appends an action to the last street', async () => {
    const wrapper = mount(ActionLine, { props: { line: 'x', mode: 'edit' } });
    await wrapper.find('[data-testid="action-add-c"]').trigger('click');
    expect(wrapper.emitted('update:line')).toEqual([['x-c']]);
  });

  it('starts a new street only where the dimension spans streets', async () => {
    const single = mount(ActionLine, { props: { line: 'r', mode: 'edit' } });
    expect(single.find('[data-testid="action-next-street"]').exists()).toBe(false);

    const many = mount(ActionLine, { props: { line: 'r', mode: 'edit', streets: true } });
    await many.find('[data-testid="action-next-street"]').trigger('click');
    expect(many.emitted('update:line')).toEqual([['r/']]);
  });

  it('undoes an action, then the street it was on', async () => {
    const wrapper = mount(ActionLine, { props: { line: 'r/x-c', mode: 'edit', streets: true } });
    await wrapper.find('[data-testid="action-back"]').trigger('click');
    expect(wrapper.emitted('update:line')![0]).toEqual(['r/x']);

    await wrapper.setProps({ line: 'r/' });
    await wrapper.find('[data-testid="action-back"]').trigger('click');
    expect(wrapper.emitted('update:line')![1]).toEqual(['r']);
  });

  it('clears to the empty line, which is itself a value', async () => {
    const wrapper = mount(ActionLine, { props: { line: 'r/x-c/', mode: 'edit' } });
    await wrapper.find('[data-testid="action-clear"]').trigger('click');
    expect(wrapper.emitted('update:line')).toEqual([['']]);
  });
});
