// @vitest-environment happy-dom
/**
 * The reveal panel (plan H.7): nothing is asked before the press, the press asks the field and
 * then the chosen cohort with their own ids, a thin answer shows its count and no matrix, a
 * refused group is a sentence beside the answered one, and a late answer to a situation the
 * reader has left is dropped.
 */
import type { NodeKey } from '@poker/core';
import { nodeKey, parseRange, step } from '@poker/core';
import { RangeDiffView, RangeMatrix } from '@poker/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WHOLE_FIELD } from '~/hands/reveal';
import type { NodeShowdownRange } from '~/pool/api';

import RangeReveal from './RangeReveal.vue';

const NODE: NodeKey = nodeKey('CO', {
  villain_position: 'BB',
  street: 'flop',
  action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call'), step('CO', 'bet', { size_pct: 0.33 })],
});
const OTHER: NodeKey = { ...NODE, action_sequence: [...NODE.action_sequence, step('BB', 'call')], hero_position: 'BB', villain_position: 'CO' };

function shown(enough: boolean, sample = 400): NodeShowdownRange {
  return { tier: 2, sample_size: sample, enough, min_n: 100, decisions_at_node: 20_000, covers: sample / 20_000, classes: enough ? { AA: 60, AKs: 40 } : {}, weights: {} };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const api = { showdownRange: vi.fn() };
const groups = vi.fn();

function panel(node: NodeKey | null = NODE) {
  return mount(RangeReveal, {
    props: { node, board: [], api, groups, group: WHOLE_FIELD, 'onUpdate:group': (next) => wrapper.setProps({ group: next }) },
    global: { stubs: { RangeMatrix: true, RangeDiffView: true, PoolDataBadge: true } },
  });
}
let wrapper: ReturnType<typeof panel>;

const has = (id: string) => wrapper.find(`[data-testid="${id}"]`).exists();
const said = (id: string) => wrapper.find(`[data-testid="${id}"]`).text();

async function paintSomething(): Promise<void> {
  wrapper.findComponent(RangeMatrix).vm.$emit('update:range', parseRange('AA,KK').range);
  await flushPromises();
}

describe('RangeReveal', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    groups.mockResolvedValue({ groups: [WHOLE_FIELD, { key: 'group:fish', label: 'fish' }, { key: 'c1', label: 'regs' }], problem: '' });
    api.showdownRange.mockResolvedValue(shown(true));
    wrapper = panel();
    await flushPromises();
  });

  it('asks the question as "before", lists the groups it was handed, and asks nothing until the press', () => {
    expect(said('reveal-question')).toContain('What is CO holding when the action reaches them here — before they bet?');
    expect(wrapper.find('[data-testid="reveal-group"]').findAll('option').map((option) => option.text())).toEqual(['nobody — the field alone', 'fish', 'regs']);
    expect(api.showdownRange).not.toHaveBeenCalled();
  });

  it('keeps Reveal off, and says why, until something is painted', async () => {
    expect(wrapper.find('[data-testid="reveal-button"]').attributes('disabled')).toBeDefined();
    expect(said('reveal-paint-first')).toContain('Paint your read first');
    await paintSomething();
    expect(wrapper.find('[data-testid="reveal-button"]').attributes('disabled')).toBeUndefined();
    expect(has('reveal-paint-first')).toBe(false);
  });

  it('asks the field, then the chosen cohort with its id, and draws the diff with the read as reference', async () => {
    await paintSomething();
    await wrapper.find('[data-testid="reveal-group"]').setValue('c1');
    await flushPromises();
    expect(wrapper.props('group')).toEqual({ key: 'c1', label: 'regs' });

    const first = deferred<NodeShowdownRange>();
    api.showdownRange.mockReturnValueOnce(first.promise).mockResolvedValueOnce(shown(true, 250));
    await wrapper.find('[data-testid="reveal-button"]').trigger('click');
    await flushPromises();
    expect(api.showdownRange).toHaveBeenCalledTimes(1);
    expect(api.showdownRange).toHaveBeenCalledWith(NODE, '');
    expect(said('reveal-asking')).toContain('Asking the pool about the whole field');

    first.resolve(shown(true));
    await flushPromises();
    expect(api.showdownRange).toHaveBeenCalledTimes(2);
    expect(api.showdownRange).toHaveBeenLastCalledWith(NODE, 'c1');
    expect(has('reveal-asking')).toBe(false);
    expect(has('reveal-group-field')).toBe(true);
    expect(has('reveal-group-c1')).toBe(true);
    const diff = wrapper.findComponent(RangeDiffView);
    expect(diff.props('ranges').map((entry: { label: string }) => entry.label)).toEqual(['your read', 'the pool · the whole field', 'the pool · regs']);
  });

  it('shows the withheld state with its count, and no matrix for that group', async () => {
    api.showdownRange.mockResolvedValue(shown(false, 57));
    await paintSomething();
    await wrapper.find('[data-testid="reveal-button"]').trigger('click');
    await flushPromises();
    expect(said('reveal-group-field')).toContain('57 of the 20,000 decisions at this spot were turned over, and 100 are needed');
    expect(wrapper.findComponent(RangeDiffView).exists()).toBe(false);
  });

  it('words a refused group and keeps the other group’s answer beside it', async () => {
    const refused = Object.assign(new Error('FetchError'), { name: 'FetchError', status: 429, data: { detail: 'The account is already running as many queries at once as it may; ask again in a moment.' } });
    await wrapper.find('[data-testid="reveal-group"]').setValue('c1');
    await paintSomething();
    api.showdownRange.mockRejectedValueOnce(refused).mockResolvedValueOnce(shown(true));
    await wrapper.find('[data-testid="reveal-button"]').trigger('click');
    await flushPromises();
    expect(said('reveal-group-field')).toContain('The pool could not be asked what the whole field has here.');
    expect(said('reveal-group-field')).toContain('only a few of them are answered at a time');
    expect(said('reveal-group-c1')).not.toContain('could not be asked');
    expect(wrapper.findComponent(RangeDiffView).props('ranges')).toHaveLength(2);
  });

  it('drops an answer that lands after the reader has stepped to another situation, and finds the read again on return', async () => {
    await paintSomething();
    const late = deferred<NodeShowdownRange>();
    api.showdownRange.mockReturnValueOnce(late.promise);
    await wrapper.find('[data-testid="reveal-button"]').trigger('click');
    await flushPromises();

    await wrapper.setProps({ node: OTHER });
    await flushPromises();
    expect(has('reveal-answer')).toBe(false);
    expect(wrapper.find('[data-testid="reveal-button"]').attributes('disabled')).toBeDefined(); // nothing painted here yet
    late.resolve(shown(true));
    await flushPromises();
    expect(has('reveal-answer')).toBe(false);

    await wrapper.setProps({ node: NODE });
    await flushPromises();
    expect(wrapper.find('[data-testid="reveal-button"]').attributes('disabled')).toBeUndefined(); // the read was kept
  });

  it('joins an ask still in flight rather than firing it twice when the reader steps away, comes back and presses again', async () => {
    await paintSomething();
    const slow = deferred<NodeShowdownRange>();
    api.showdownRange.mockReturnValueOnce(slow.promise);
    await wrapper.find('[data-testid="reveal-button"]').trigger('click');
    await flushPromises();
    await wrapper.setProps({ node: OTHER });
    await wrapper.setProps({ node: NODE });
    await flushPromises();
    // The abandoned ask is still running, so the button waits for it rather than starting a twin.
    expect(wrapper.find('[data-testid="reveal-button"]').attributes('disabled')).toBeDefined();
    slow.resolve(shown(true));
    await flushPromises();
    expect(wrapper.find('[data-testid="reveal-button"]').attributes('disabled')).toBeUndefined();
    expect(has('reveal-answer')).toBe(false); // that answer was for the press the reader stepped away from
    await wrapper.find('[data-testid="reveal-button"]').trigger('click');
    await flushPromises();
    expect(api.showdownRange).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll('[data-testid="reveal-group-field"]')).toHaveLength(1);
  });

  it('forgets a refusal so the next press asks afresh, while a real answer is kept', async () => {
    await paintSomething();
    api.showdownRange.mockRejectedValueOnce(new Error('down')).mockResolvedValue(shown(true));
    await wrapper.find('[data-testid="reveal-button"]').trigger('click');
    await flushPromises();
    expect(said('reveal-group-field')).toContain('could not be asked');
    await wrapper.find('[data-testid="reveal-button"]').trigger('click');
    await flushPromises();
    expect(api.showdownRange).toHaveBeenCalledTimes(2);
    expect(said('reveal-group-field')).not.toContain('could not be asked');
  });

  it('asks nothing new for a spot and group it has already been answered about', async () => {
    await paintSomething();
    await wrapper.find('[data-testid="reveal-button"]').trigger('click');
    await flushPromises();
    await wrapper.setProps({ node: OTHER });
    await wrapper.setProps({ node: NODE });
    await flushPromises();
    await wrapper.find('[data-testid="reveal-button"]').trigger('click');
    await flushPromises();
    expect(api.showdownRange).toHaveBeenCalledTimes(1);
    expect(has('reveal-group-field')).toBe(true);
  });

  it('says which list is missing, and still offers what was listed', async () => {
    groups.mockResolvedValue({ groups: [WHOLE_FIELD, { key: 'c1', label: 'regs' }], problem: 'The pool’s player groups could not be listed, so they cannot be chosen here.' });
    wrapper = panel();
    await flushPromises();
    expect(said('reveal-groups-problem')).toContain('player groups could not be listed');
    expect(wrapper.find('[data-testid="reveal-group"]').findAll('option')).toHaveLength(2);

    groups.mockRejectedValue(new Error('down'));
    wrapper = panel();
    await flushPromises();
    expect(said('reveal-groups-problem')).toContain('only the whole field can be asked here');
    expect(wrapper.find('[data-testid="reveal-group"]').findAll('option')).toHaveLength(1);
  });

  it('has nothing to paint before the first decision', () => {
    wrapper = panel(null);
    expect(said('reveal-no-node')).toContain('Step to a decision');
    expect(wrapper.findComponent(RangeMatrix).exists()).toBe(false);
  });
});
