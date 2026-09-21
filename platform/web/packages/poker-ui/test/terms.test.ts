// @vitest-environment happy-dom
/**
 * The one explained-word affordance and what is built on it (ADR-056): `TermLabel` with its
 * fallback and slotted triggers, the situation shorthand's `NodeLabel`, the reference
 * `VocabularyTable`, and the pool badge whose every word now carries its meaning.
 */
import { nodeKey, step } from '@poker/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';

import NodeLabel from '../src/components/NodeLabel.vue';
import PoolDataBadge from '../src/components/PoolDataBadge.vue';
import TermLabel from '../src/components/TermLabel.vue';
import VocabularyTable from '../src/components/VocabularyTable.vue';
import type { TermEntry } from '../src/glossary';
import { GLOSSARY } from '../src/glossary';
import { NODE_WORDS, POSITION_WORDS } from '../src/vocabulary';

const WITH_RULE: TermEntry = { term: 'Top pair', definition: 'One hole card pairs the highest card on the board.', formula: 'the rule' };
const WITHOUT_RULE: TermEntry = { term: 'Situation shorthand', definition: 'A sentence.' };

describe('TermLabel', () => {
  it('prints no formula line for an entry that has none', () => {
    const wrapper = mount(TermLabel, { props: { entry: WITHOUT_RULE } });
    expect(wrapper.find('[role="tooltip"] code').exists()).toBe(false);
    expect(wrapper.find('[role="tooltip"]').text()).toBe('Situation shorthand · A sentence.');
  });

  it('falls back to a focusable text trigger described by the tooltip', () => {
    const wrapper = mount(TermLabel, { props: { entry: WITH_RULE } });
    const trigger = wrapper.get('span.pk-term > .pk-term-text');
    const tip = wrapper.get('span.pk-term > [role="tooltip"].pk-tip');
    expect(trigger.text()).toBe('Top pair');
    expect(trigger.attributes('tabindex')).toBe('0');
    expect(trigger.attributes('data-term')).toBe('Top pair');
    expect(trigger.attributes('aria-describedby')).toBe(tip.attributes('id'));
    expect(tip.find('strong').text()).toBe('Top pair');
    expect(tip.find('code').text()).toBe('the rule');
  });

  it('shows a label and a name in place of the term where given', () => {
    const wrapper = mount(TermLabel, { props: { entry: WITH_RULE, label: 'top pair', name: 'top_pair' } });
    expect(wrapper.get('.pk-term-text').text()).toBe('top pair');
    expect(wrapper.get('.pk-term-text').attributes('data-term')).toBe('top_pair');
    expect(wrapper.get('[role="tooltip"] strong').text()).toBe('Top pair');
  });

  it('lets a control be the trigger and hands it the tooltip id', async () => {
    let clicks = 0;
    const wrapper = mount(TermLabel, {
      props: { entry: WITH_RULE },
      slots: { default: ({ describedby }: { describedby: string }) => h('button', { 'aria-describedby': describedby, onClick: () => clicks++ }, 'Top pair') },
    });
    expect(wrapper.find('.pk-term-text').exists()).toBe(false);
    const button = wrapper.get('button');
    expect(button.attributes('aria-describedby')).toBe(wrapper.get('[role="tooltip"]').attributes('id'));
    await button.trigger('click');
    expect(clicks).toBe(1);
  });

  it('takes a tooltip body of the caller’s own', () => {
    const wrapper = mount(TermLabel, { props: { entry: WITH_RULE }, slots: { tip: () => h('em', 'custom body') } });
    expect(wrapper.get('[role="tooltip"]').text()).toBe('custom body');
    expect(wrapper.get('.pk-term-text').text()).toBe('Top pair');
  });
});

describe('NodeLabel', () => {
  const key = nodeKey('BB', { eff_stack_bb: 40, stake: 'NL5', villain_position: 'CO', action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call')] });

  it('reads exactly as the shorthand and lists every word it is made of', () => {
    const wrapper = mount(NodeLabel, { props: { node: key } });
    expect(wrapper.get('.pk-term-text').text()).toBe('BB call vs CO 2.5bb · 40bb · NL5');
    expect(wrapper.get('.pk-term-text').attributes('data-term')).toBe('node');
    const parts = wrapper.findAll('[data-testid="node-label-part"]').map((part) => part.text());
    expect(parts).toHaveLength(7);
    expect(parts[0]).toBe(`BB — ${POSITION_WORDS.BB.definition}`);
    expect(parts[4]).toBe(`2.5bb — ${NODE_WORDS.raiseTo.definition}`);
    expect(parts[6]).toBe(`NL5 — ${NODE_WORDS.stake.definition}`);
  });

  it('follows the key when it changes', async () => {
    const wrapper = mount(NodeLabel, { props: { node: key } });
    await wrapper.setProps({ node: nodeKey('UTG', { action_sequence: [step('UTG', 'raise')] }) });
    expect(wrapper.get('.pk-term-text').text()).toBe('UTG RFI · 100bb');
    expect(wrapper.findAll('[data-testid="node-label-part"]')).toHaveLength(3);
  });

  // A stored situation is often the only thing on its row, so a shorthand this file cannot take
  // apart still has to print. `nodeLabelParts` keeps throwing; the component is what catches.
  it('prints the plain label, with no tooltip, for a shorthand it cannot take apart', () => {
    const odd = { ...nodeKey('BTN', { action_sequence: [step('BTN', 'raise')] }), hero_position: 'ZZ' } as unknown as typeof key;
    const wrapper = mount(NodeLabel, { props: { node: odd } });
    expect(wrapper.get('[data-testid="node-label-plain"]').text()).toBe('ZZ to act vs BTN · 100bb');
    expect(wrapper.find('.pk-term-text').exists()).toBe(false);
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
  });
});

describe('VocabularyTable', () => {
  it('lists a table as term, meaning and rule', () => {
    const wrapper = mount(VocabularyTable, { props: { table: 'positions', caption: 'How seats are named.' } });
    expect(wrapper.get('caption').text()).toBe('How seats are named.');
    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual(['term', 'meaning', 'rule']);
    const first = wrapper.findAll('tbody tr')[0]!;
    expect(first.get('th').text()).toBe('UTG');
    expect(first.findAll('td').map((td) => td.text())).toEqual([POSITION_WORDS.UTG.definition, POSITION_WORDS.UTG.formula]);
  });

  it('shows the pool tiers from the glossary, with how each is counted', () => {
    const wrapper = mount(VocabularyTable, { props: { table: 'tiers' } });
    expect(wrapper.find('caption').exists()).toBe(false);
    expect(wrapper.findAll('thead th')[2]!.text()).toBe('how it is counted');
    expect(wrapper.findAll('tbody th').map((th) => th.text())).toEqual(['Observed frequencies', 'Showdown range', 'Reconstructed range', 'Sample size', 'Showdown coverage']);
    expect(wrapper.findAll('tbody tr')[3]!.findAll('td')[1]!.text()).toBe(GLOSSARY.sampleSize.formula);
  });
});

describe('PoolDataBadge', () => {
  it('explains a thin sample without ever showing a number for it', () => {
    const wrapper = mount(PoolDataBadge, { props: { tier: 1, sampleSize: 1234, enough: false, minN: 2000 } });
    const thin = wrapper.get('[data-testid="pool-badge-thin"]');
    expect(thin.get('.pk-term-text').text()).toBe('insufficient data');
    expect(thin.get('.pk-term-text').attributes('data-term')).toBe('sampleSize');
    expect(thin.get('[role="tooltip"]').text()).toContain('never a number');
    expect(wrapper.find('[data-testid="pool-badge-n"]').exists()).toBe(false);
    expect(thin.text()).toContain('1,234 of the 2,000 needed');
  });

  it('explains the tier chip with that tier’s entry, keeping the chip’s words', () => {
    for (const [tier, term] of [[1, 'observedFrequencies'], [2, 'showdownRange'], [3, 'reconstructedRange']] as const) {
      const chip = mount(PoolDataBadge, { props: { tier, sampleSize: 500 } }).get('.pk-tier');
      expect(chip.get('.pk-term-text').text()).toBe(`pool · tier ${tier}`);
      expect(chip.get('.pk-term-text').attributes('data-term')).toBe(term);
      expect(chip.get('[role="tooltip"]').text()).toContain(GLOSSARY[term].definition);
    }
  });

  it('explains n and the showdown coverage where they stand', () => {
    const wrapper = mount(PoolDataBadge, { props: { tier: 2, sampleSize: 1234, covers: 0.042 } });
    const n = wrapper.get('[data-testid="pool-badge-n"]');
    expect(n.get('.pk-term-text').text()).toBe('n');
    expect(n.get('.pk-term-text').attributes('data-term')).toBe('sampleSize');
    expect(n.text()).toContain('= 1,234');
    const covers = wrapper.get('[data-testid="pool-badge-covers"]');
    expect(covers.text().startsWith('4.2% of the decisions here were shown down')).toBe(true);
    expect(covers.get('.pk-term-text').attributes('data-term')).toBe('showdownCoverage');
  });
});
