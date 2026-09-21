// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PresetButton from './PresetButton.vue';

/**
 * The affordance this component exists for (ADR-057): a standard report's description used to sit
 * behind a `title=`, which no keyboard and no finger reaches. Here it must be a real description
 * the button points at, on both pages that now share the button. What the sentence *says* is the
 * server's business — `analysis/{hero,pool}/presets.yaml` — so nothing here pins wording.
 */
const PRESET = {
  code: 'blind_defence',
  label: 'Blind defence',
  description: 'How the blinds respond to an open, by the opener’s seat.',
};

function button(over: { disabled?: boolean; size?: 'sm' | 'md' } = {}) {
  return mount(PresetButton, { props: { preset: PRESET, disabled: false, testid: 'preset-blind_defence', ...over } });
}

type Button = ReturnType<typeof button>;

const trigger = (w: Button) => w.find('[data-testid="preset-blind_defence"]');
const tip = (w: Button) => w.find('[role="tooltip"]');

describe('PresetButton — what the description is attached to', () => {
  it('points the button itself at the tip that holds the description', () => {
    const w = button();
    expect(trigger(w).element.tagName).toBe('BUTTON');
    expect(trigger(w).attributes('aria-describedby')).toBe(tip(w).attributes('id'));
    expect(tip(w).text()).toContain('How the blinds respond to an open');
  });

  it('shows the label on the button and the label again as the tip’s heading', () => {
    const w = button();
    expect(trigger(w).text()).toBe('Blind defence');
    expect(tip(w).text()).toContain('Blind defence');
  });
});

describe('PresetButton — the control', () => {
  it('hands a press back to the page rather than opening anything itself', async () => {
    const w = button();
    await trigger(w).trigger('click');
    expect(w.emitted('open')).toEqual([[]]);
  });

  it('is disabled while a report is running, so a second one cannot be asked for', () => {
    expect(trigger(button({ disabled: true })).attributes('disabled')).toBeDefined();
    expect(trigger(button()).attributes('disabled')).toBeUndefined();
  });

  /** `/pool` draws its presets one size up; `/reports` takes the default. */
  it('takes the bigger size when a page asks for it', () => {
    expect(trigger(button({ size: 'md' })).classes()).toContain('text-sm');
    expect(trigger(button()).classes()).toContain('text-xs');
  });
});
