// @vitest-environment happy-dom
/**
 * An example opens the analyzer's own steps with no backend (ADR-050, amended by ADR-061): all
 * nine are offered, a committed answer is revealed without a single request, and no gate is left
 * waiting — the four steps scored against the pool say there is none instead.
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { stepDef } from '~/analyze/steps';
import { EXAMPLES, EXAMPLE_OPENS_AT, EXAMPLE_STEPS } from '~/help/examples';
import { TOUR_STOPS } from '~/help/tour';
import { CHART_PROVENANCE } from '~/train/charts';

import ExamplePage from './[id].vue';

// Step 1 reaches for the range library store; an example never uses it (`libraryMissing`), and a
// mount with no Pinia must not be the thing that proves it.
vi.mock('~/stores/ranges', () => ({ useRangesStore: () => ({ lookup: vi.fn(), status: 'idle', error: null }) }));

const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots, attrs }) => () => h('a', { ...attrs, href: props.to }, slots.default?.()),
});

function page(id: string) {
  vi.stubGlobal('useRoute', () => ({ params: { id }, path: `/examples/${id}` }));
  return mount(ExamplePage, { global: { components: { NuxtLink }, stubs: { EquityCalculator: true } } });
}

const title = (w: ReturnType<typeof page>) => w.find('[data-testid="step-title"]').text();

/** Commit an answer on the step now on screen, whatever shape its gate takes. */
async function commit(w: ReturnType<typeof page>, choice: string | null): Promise<void> {
  if (choice !== null) await w.find(`[data-testid="gate-choice-${choice}"]`).trigger('click');
  else {
    await w.find('[data-testid="gate-input"]').setValue('20');
    await w.find('[data-testid="gate-commit"]').trigger('click');
  }
  await flushPromises();
}

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

  it('offers all nine steps, and opens on the first with a board', () => {
    const w = page(EXAMPLES[0]!.id);
    const rail = w.findAll('[data-testid^="stepper-"]').map((b) => b.attributes('data-testid')).filter((id) => /^stepper-\d+$/.test(id!));
    expect(EXAMPLE_STEPS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rail).toEqual(EXAMPLE_STEPS.map((n) => `stepper-${n}`));
    expect(title(w)).toBe(`${EXAMPLE_OPENS_AT}. ${stepDef(EXAMPLE_OPENS_AT).title}`);
    // Steps 1 and 2 are behind it and reachable, so previous is live from the start.
    expect(w.find('[data-testid="example-prev"]').attributes('disabled')).toBeUndefined();
  });

  it('keeps the tour’s two analyzer stops describing the step it actually opens on', () => {
    // The bug this pins: the example used to open on 3 because it offered only 3,4,5,7,8, and the
    // tour quotes that step's own words. Opening somewhere else would make both cards lie.
    const stops = TOUR_STOPS.filter((stop) => stop.route.startsWith('/examples/') && stop.anchor !== 'stepper-7');
    expect(stops.length).toBe(2);
    expect(stops.map((stop) => stop.title)).toEqual([stepDef(EXAMPLE_OPENS_AT).title, stepDef(EXAMPLE_OPENS_AT).question]);
  });

  it('walks the offered steps with next, previous and the rail', async () => {
    const w = page(EXAMPLES[1]!.id);
    await w.find('[data-testid="example-prev"]').trigger('click');
    expect(title(w)).toBe(`2. ${stepDef(2).title}`);
    await w.find('[data-testid="stepper-1"]').trigger('click');
    expect(w.find('[data-testid="example-prev"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="stepper-7"]').trigger('click');
    expect(title(w)).toBe(`7. ${stepDef(7).title}`);
    await w.find('[data-testid="example-next"]').trigger('click');
    expect(title(w)).toBe(`8. ${stepDef(8).title}`);
    await w.find('[data-testid="stepper-9"]').trigger('click');
    expect(w.find('[data-testid="example-next"]').attributes('disabled')).toBeDefined();
  });

  it('reveals a committed answer with no request and never leaves a gate waiting', async () => {
    // 4 and 8 are left out: their truth comes from the equity engine, stubbed away here, so their
    // gate is right to say it is still working the number out.
    const w = page(EXAMPLES[0]!.id);
    for (const step of [3, 5, 7]) {
      await w.find(`[data-testid="stepper-${step}"]`).trigger('click');
      await commit(w, step === 7 ? 'value' : null);
      expect(w.find('[data-testid="gate-verdict"]').exists(), `step ${step}`).toBe(true);
      expect(w.find('[data-testid="gate-waiting"]').exists(), `step ${step}`).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(w.text()).toContain('3 of 9 predictions committed');
  });

  it('tells the four pool-scored steps there is no pool, rather than leaving them waiting', async () => {
    const w = page(EXAMPLES[0]!.id);
    for (const step of [1, 2, 6, 9]) {
      await w.find(`[data-testid="stepper-${step}"]`).trigger('click');
      await commit(w, step === 6 ? 'bet' : null);
      expect(w.find('[data-testid="gate-unavailable"]').text(), `step ${step}`).toContain('An example has no pool');
      expect(w.find('[data-testid="gate-waiting"]').exists(), `step ${step}`).toBe(false);
      expect(w.find('[data-testid="gate-verdict"]').exists(), `step ${step}`).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not offer step 1’s range library, because an example has none', async () => {
    const w = page(EXAMPLES[0]!.id);
    await w.find('[data-testid="stepper-1"]').trigger('click');
    expect(w.find('[data-testid="step1-load"]').exists()).toBe(false);
    expect(w.find('[data-testid="step1-no-library"]').text()).toContain('no range library');
    await flushPromises();
    expect(fetch).not.toHaveBeenCalled();
  });
});
