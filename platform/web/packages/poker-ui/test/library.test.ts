// @vitest-environment happy-dom
import type { NodeKey } from '@poker/core';
import { nodeKey, parseRange, step } from '@poker/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import NodeKeyEditor from '../src/components/NodeKeyEditor.vue';
import RangeDisagreementTable from '../src/components/RangeDisagreementTable.vue';

describe('NodeKeyEditor', () => {
  it('shows the label and emits a new key for every change', async () => {
    const key = nodeKey('BB', { villain_position: 'CO', action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call')] });
    const wrapper = mount(NodeKeyEditor, { props: { modelValue: key } });
    // The visible label is the tooltip's trigger; the tooltip beside it takes the label apart.
    expect(wrapper.find('[data-testid="node-label"] .pk-term-text').text()).toBe('BB call vs CO 2.5bb · 100bb');
    expect(wrapper.find('[data-testid="node-label"] [role="tooltip"]').text()).toContain('CO — Cutoff');

    await wrapper.find('[data-testid="node-hero"]').setValue('SB');
    const emitted = wrapper.emitted('update:modelValue')!;
    expect((emitted[0]![0] as NodeKey).hero_position).toBe('SB');

    await wrapper.find('[data-testid="node-stack"]').setValue('40');
    expect((emitted[1]![0] as NodeKey).eff_stack_bb).toBe(40);

    await wrapper.find('[data-testid="node-texture"]').setValue('rainbow, paired');
    expect((emitted[2]![0] as NodeKey).board_texture).toEqual(['rainbow', 'paired']);

    await wrapper.find('[data-testid="node-villain"]').setValue('');
    expect((emitted[3]![0] as NodeKey).villain_position).toBeNull();
  });

  it('drops a line the changed street or steps would contradict, and a faced size on preflop (ADR-078)', async () => {
    const key = nodeKey('BB', { villain_position: 'CO', street: 'flop', line_so_far: 'r/', size_bucket: 'mid', action_sequence: [step('CO', 'bet', { size_pct: 0.5 }), step('BB', 'call')] });
    const wrapper = mount(NodeKeyEditor, { props: { modelValue: key, 'onUpdate:modelValue': (k: NodeKey) => wrapper.setProps({ modelValue: k }) } });
    const latest = () => wrapper.emitted('update:modelValue')!.at(-1)![0] as NodeKey;
    // A stack is not a street: the line from the replayer survives.
    await wrapper.find('[data-testid="node-stack"]').setValue('40');
    expect(latest()).toMatchObject({ eff_stack_bb: 40, line_so_far: 'r/', size_bucket: 'mid' });
    await wrapper.find('[data-testid="node-street"]').setValue('turn');
    expect(latest()).toMatchObject({ street: 'turn', line_so_far: null, size_bucket: 'mid' });
    await wrapper.find('[data-testid="node-street"]').setValue('preflop');
    expect(latest()).toMatchObject({ street: 'preflop', line_so_far: null, size_bucket: null });

    const fresh = mount(NodeKeyEditor, { props: { modelValue: key } });
    await fresh.find('[data-testid="node-add-step"]').trigger('click');
    expect((fresh.emitted('update:modelValue')![0]![0] as NodeKey).line_so_far).toBeNull();
  });

  it('adds, edits and removes steps; the sizes are bb and % of pot', async () => {
    const wrapper = mount(NodeKeyEditor, { props: { modelValue: nodeKey('BTN'), 'onUpdate:modelValue': (k: NodeKey) => wrapper.setProps({ modelValue: k }) } });
    await wrapper.find('[data-testid="node-add-step"]').trigger('click');
    expect(wrapper.props('modelValue').action_sequence).toEqual([step('BTN', 'raise')]);
    expect(wrapper.find('[data-testid="node-label"] .pk-term-text').text()).toBe('BTN RFI · 100bb');

    const row = wrapper.find('[data-testid="node-step-0"]');
    await row.find('input[aria-label="raise to, bb"]').setValue('2.5');
    expect(wrapper.props('modelValue').action_sequence[0]!.size_bb).toBe(2.5);
    await row.find('input[aria-label="bet, % of pot"]').setValue('33');
    expect(wrapper.props('modelValue').action_sequence[0]!.size_pct).toBeCloseTo(0.33, 6);
    await row.find('select[aria-label="action"]').setValue('call');
    expect(wrapper.props('modelValue').action_sequence[0]!.action).toBe('call');

    await row.find('button[aria-label="remove step"]').trigger('click');
    expect(wrapper.props('modelValue').action_sequence).toEqual([]);
  });

  it('keeps what the seat names mean one click away, closed until asked', () => {
    const wrapper = mount(NodeKeyEditor, { props: { modelValue: nodeKey('BTN') } });
    const legend = wrapper.find('[data-testid="node-positions"]');
    expect(legend.attributes('open')).toBeUndefined();
    expect(legend.find('summary').text()).toBe('What UTG, HJ, CO … mean');
    expect(legend.findAll('[data-testid="vocabulary-positions"] tbody tr')).toHaveLength(10);
    // The caption is the rule `core/positions.py` keeps: the names follow the number of players.
    expect(legend.find('caption').text()).toContain('six-handed UTG, HJ, CO');
    expect(legend.find('caption').text()).toContain('nine-handed UTG, UTG1, MP, MP1, HJ, CO');
  });

  it('refuses a stack below 1 and a table outside 2..10, and rounds what it takes', async () => {
    const wrapper = mount(NodeKeyEditor, { props: { modelValue: nodeKey('BTN') } });
    await wrapper.find('[data-testid="node-stack"]').setValue('0,5');
    await wrapper.find('[data-testid="node-table"]').setValue('11');
    await wrapper.find('[data-testid="node-table"]').setValue('1');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await wrapper.find('[data-testid="node-stack"]').setValue('87,6');
    expect((wrapper.emitted('update:modelValue')![0]![0] as NodeKey).eff_stack_bb).toBe(88);
  });

  it('reads a comma in the sizes, keeps the percent unrounded, and clears a size to none', async () => {
    const key = nodeKey('BB', { action_sequence: [step('CO', 'raise', { size_bb: 3 }), step('BB', 'call')] });
    const wrapper = mount(NodeKeyEditor, { props: { modelValue: key, 'onUpdate:modelValue': (k: NodeKey) => wrapper.setProps({ modelValue: k }) } });
    const row = wrapper.find('[data-testid="node-step-0"]');
    const raiseTo = row.find('input[aria-label="raise to, bb"]');
    await raiseTo.setValue('2,5');
    expect(wrapper.props('modelValue').action_sequence[0]!.size_bb).toBe(2.5);
    await raiseTo.trigger('blur');
    expect((raiseTo.element as HTMLInputElement).value).toBe('2.5');

    const pct = row.find('input[aria-label="bet, % of pot"]');
    await pct.setValue('33,3');
    expect(wrapper.props('modelValue').action_sequence[0]!.size_pct).toBeCloseTo(0.333, 9);
    await pct.trigger('blur');
    expect((pct.element as HTMLInputElement).value).toBe('33.3');

    await raiseTo.setValue('');
    expect(wrapper.props('modelValue').action_sequence[0]!.size_bb).toBeNull();
    await pct.setValue('0');
    expect(wrapper.props('modelValue').action_sequence[0]!.size_pct).toBeNull();
    expect(wrapper.props('modelValue').action_sequence[1]).toEqual(step('BB', 'call'));
  });
});

describe('RangeDisagreementTable', () => {
  it('lists the classes the two ranges disagree on, largest difference first', () => {
    const a = parseRange('AA,QQ:0.5,AKs').range;
    const b = parseRange('KK,QQ,AKs').range;
    const wrapper = mount(RangeDisagreementTable, { props: { a, b, aLabel: 'Mine', bLabel: 'Solver' } });
    const rows = wrapper.findAll('tbody tr').map((tr) => tr.findAll('td').map((td) => td.text()));
    expect(rows).toEqual([
      ['AA', '100%', '0%', '+100.0 pp'],
      ['KK', '0%', '100%', '-100.0 pp'],
      ['QQ', '50%', '100%', '-50.0 pp'],
    ]);
    expect(wrapper.findAll('th').map((th) => th.text())).toEqual(['hand', 'Mine', 'Solver', 'difference']);
  });

  it('says so when they agree, and reports a clicked class', async () => {
    const same = parseRange('AA,KK').range;
    expect(mount(RangeDisagreementTable, { props: { a: same, b: same } }).find('[data-testid="disagree-empty"]').exists()).toBe(true);
    const wrapper = mount(RangeDisagreementTable, { props: { a: parseRange('AA').range, b: parseRange('KK').range, limit: 1 } });
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    await wrapper.find('tbody button').trigger('click');
    expect(wrapper.emitted('cellClick')).toEqual([[0]]);
  });
});
