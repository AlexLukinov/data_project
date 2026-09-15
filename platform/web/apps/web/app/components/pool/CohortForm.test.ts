// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { CohortIn } from '~/pool/stats';
import type { Stat } from '~/stats/api';

import CohortForm from './CohortForm.vue';

const VPIP: Stat = { code: 'vpip', label: 'VPIP', category: 'preflop', grain: 'hand', format: 'percent', cached: true };

function form(initial: CohortIn | null = null) {
  return mount(CohortForm, { props: { stats: [VPIP], initial, replacing: false, busy: false, failure: '' } });
}

const find = (w: ReturnType<typeof form>, id: string) => w.find(`[data-testid="${id}"]`);

async function name(w: ReturnType<typeof form>): Promise<void> {
  await find(w, 'cohort-name').setValue('loose players');
}

describe('CohortForm — the rule value', () => {
  it('refuses to save a rule whose value was emptied, and says which rule', async () => {
    const w = form({ name: 'regs', criteria: { rules: [{ stat: 'vpip', op: 'gte', value: 25 }] } });
    await find(w, 'rule-value').setValue('');
    await find(w, 'cohort-form').trigger('submit');
    expect(w.emitted('save')).toBeUndefined();
    expect(w.findAll('[data-testid="cohort-problem"]').map((p) => p.text())).toContain('Rule 1 needs a number.');
  });

  it('keeps the last number when the text is not one, rather than saving the text', async () => {
    const w = form();
    await name(w);
    await find(w, 'rule-value').setValue('25');
    await find(w, 'rule-value').setValue('25..5');
    expect(find(w, 'rule-value').attributes('aria-invalid')).toBe('true');
    await find(w, 'cohort-form').trigger('submit');
    expect(w.emitted('save')![0]).toEqual([{ name: 'loose players', criteria: { rules: [{ stat: 'vpip', op: 'gte', value: 25 }] } }]);
  });

  it('reads a comma as the decimal point and saves the number', async () => {
    const w = form();
    await name(w);
    await find(w, 'rule-value').setValue('25,5');
    await find(w, 'cohort-form').trigger('submit');
    expect(w.emitted('save')![0]).toEqual([{ name: 'loose players', criteria: { rules: [{ stat: 'vpip', op: 'gte', value: 25.5 }] } }]);
  });

  it('opens a saved cohort with its value written with a dot, in a decimal text box', () => {
    const w = form({ name: 'regs', criteria: { rules: [{ stat: 'vpip', op: 'lt', value: 18.5 }] } });
    const value = find(w, 'rule-value');
    expect(value.attributes()).toMatchObject({ type: 'text', inputmode: 'decimal' });
    expect((value.element as HTMLInputElement).value).toBe('18.5');
  });
});
