// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { CohortSpec, Stat } from '~/stats/api';

import ReadingOptions from './ReadingOptions.vue';

function stat(code: string, label: string): Stat {
  return { code, label, category: 'preflop', grain: 'hand', format: 'percent' } as Stat;
}

const STATS = [stat('vpip', 'VPIP'), stat('hands', 'Hands')];
const REGS: CohortSpec = { rules: [{ stat: 'vpip', op: 'lt', value: 25 }, { stat: 'hands', op: 'gte', value: 1000 }] };

function options(over: Record<string, unknown> = {}) {
  return mount(ReadingOptions, { props: { compare: false, minN: 100, compareOn: true, cohort: null, cohortOn: false, stats: STATS, ...over } });
}

const find = (w: ReturnType<typeof options>, id: string) => w.find(`[data-testid="${id}"]`);

describe('ReadingOptions', () => {
  /* The note used to print the request as the API sends it — "vpip lt 25 and hands gte 1000" — so a
     standard pool report announced its own scope in code (ADR-057). */
  it('says whom a stored report is scoped to in the words the rule was built with', () => {
    const w = options({ cohort: REGS, cohortOn: true });
    expect(find(w, 'cohort-note').text()).toBe('Scoped to players whose VPIP is below 25 and Hands is at least 1,000.');
  });

  it('says nothing about a cohort when the report is not scoped to one', () => {
    expect(find(options(), 'cohort-note').exists()).toBe(false);
    expect(find(options({ cohort: REGS, cohortOn: false }), 'cohort-note').exists()).toBe(false);
  });

  it('admits when a remembered comparison is not in effect', () => {
    expect(find(options({ compare: true, compareOn: false }), 'compare-inert').exists()).toBe(true);
    expect(find(options({ compare: true, compareOn: true }), 'compare-inert').exists()).toBe(false);
    expect(find(options({ compare: false, compareOn: false }), 'compare-inert').exists()).toBe(false);
  });

  it('hands both choices straight back, since the report they change is the page’s', async () => {
    const w = options();
    await find(w, 'compare-toggle').setValue(true);
    await find(w, 'minn-select').setValue('0');
    expect(w.emitted('update:compare')).toEqual([[true]]);
    expect(w.emitted('update:minN')).toEqual([[0]]);
  });
});
