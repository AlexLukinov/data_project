// @vitest-environment happy-dom
/**
 * An example opens the analyzer's own steps with no backend (ADR-050): the steps it offers are the
 * ones poker-core answers, a committed answer is revealed without a single request, and no gate
 * is left waiting for a pool.
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { stepDef } from '~/analyze/steps';
import { EXAMPLES, EXAMPLE_STEPS } from '~/help/examples';
import { CHART_PROVENANCE } from '~/train/charts';

import ExamplePage from './[id].vue';

const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots, attrs }) => () => h('a', { ...attrs, href: props.to }, slots.default?.()),
});

function page(id: string) {
  vi.stubGlobal('useRoute', () => ({ params: { id }, path: `/examples/${id}` }));
  return mount(ExamplePage, { global: { components: { NuxtLink }, stubs: { EquityCalculator: true } } });
}

const title = (w: ReturnType<typeof page>) => w.find('[data-testid="step-title"]').text();

describe('the example page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn());
    vi.stubGlobal('useEquityService', () => ({ service: { compute: vi.fn(), cancel: vi.fn() } }));
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('an example must not call the API'))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('names every example there is when asked for one that does not exist', () => {
    const w = page('no-such-spot');
    const unknown = w.find('[data-testid="example-unknown"]');
    expect(unknown.text()).toContain('no-such-spot');
    expect(unknown.findAll('a').map((a) => a.attributes('href'))).toEqual(EXAMPLES.map((e) => `/examples/${e.id}`));
  });

  it('says what is set up and where it comes from before asking anything', () => {
    const w = page(EXAMPLES[0]!.id);
    expect(w.find('[data-testid="example-title"]').text()).toBe(EXAMPLES[0]!.title);
    expect(w.find('[data-testid="example-provenance"]').text()).toBe(CHART_PROVENANCE);
    expect(w.find('[data-testid="example-charts"]').text()).toContain('BTN open · 100bb · 6-max');
    expect(w.find('[data-testid="example-size"]').text()).toContain('46% of the pot');
    expect(w.find('[data-testid="example-left-out"]').text()).toContain('Nothing here is saved');
  });

  it('offers exactly the steps poker-core answers, and opens on the first', () => {
    const w = page(EXAMPLES[0]!.id);
    const rail = w.findAll('[data-testid^="stepper-"]').map((b) => b.attributes('data-testid')).filter((id) => /^stepper-\d+$/.test(id!));
    expect(rail).toEqual(EXAMPLE_STEPS.map((n) => `stepper-${n}`));
    expect(title(w)).toBe(`3. ${stepDef(3).title}`);
    expect(w.find('[data-testid="example-prev"]').attributes('disabled')).toBeDefined();
  });

  it('walks the offered steps with next, previous and the rail', async () => {
    const w = page(EXAMPLES[1]!.id);
    await w.find('[data-testid="example-next"]').trigger('click');
    expect(title(w)).toBe(`4. ${stepDef(4).title}`);
    await w.find('[data-testid="stepper-7"]').trigger('click');
    expect(title(w)).toBe(`7. ${stepDef(7).title}`);
    await w.find('[data-testid="example-next"]').trigger('click');
    expect(title(w)).toBe(`8. ${stepDef(8).title}`);
    expect(w.find('[data-testid="example-next"]').attributes('disabled')).toBeDefined();
  });

  it('reveals a committed answer with no request and never leaves a gate waiting', async () => {
    const w = page(EXAMPLES[0]!.id);
    for (const step of [3, 5, 7]) {
      await w.find(`[data-testid="stepper-${step}"]`).trigger('click');
      if (step === 7) await w.find('[data-testid="gate-choice-value"]').trigger('click');
      else {
        await w.find('[data-testid="gate-input"]').setValue('20');
        await w.find('[data-testid="gate-commit"]').trigger('click');
      }
      await flushPromises();
      expect(w.find('[data-testid="gate-verdict"]').exists(), `step ${step}`).toBe(true);
      expect(w.find('[data-testid="gate-waiting"]').exists(), `step ${step}`).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(w.text()).toContain('3 of 5 predictions committed');
  });
});
