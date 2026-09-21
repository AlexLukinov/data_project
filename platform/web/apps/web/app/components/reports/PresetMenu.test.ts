// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { SavedReport } from '~/reports/api';
import type { ModulePreset } from '~/reports/library';

import PresetMenu from './PresetMenu.vue';

/**
 * Two things this list must never get wrong (F.12c): a failed library is not an empty one, and a
 * standard report opens as itself. The wording of the presets belongs to the server and the
 * wording of the empty line to the component; what is pinned here is which of them appears.
 */
const PRESET: ModulePreset = {
  code: 'preflop_overview',
  label: 'Preflop overview',
  description: 'Every preflop stat by seat.',
  request: { stats: ['vpip'] },
  module: 'hero',
};

const SAVED: SavedReport = {
  id: 'id-1',
  name: 'Blind defence, deep',
  module: 'hero',
  definition: { stats: ['vpip'] },
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

type Props = { presets?: ModulePreset[]; saved?: SavedReport[]; openId?: string | null; busy?: boolean; failed?: boolean };

function menu(over: Props = {}) {
  return mount(PresetMenu, {
    props: { presets: [PRESET], saved: [], openId: null, busy: false, failed: false, ...over },
  });
}

const find = (w: ReturnType<typeof menu>, id: string) => w.find(`[data-testid="${id}"]`);

describe('PresetMenu — an empty list versus a list that could not be read', () => {
  /* The page shows `library-error` with the reason above this list; "None yet. Build a report and
     save it" underneath it would be telling someone their own saved reports are gone. */
  it('says nothing about saved reports when the library failed to load', () => {
    const w = menu({ saved: [], failed: true });
    expect(find(w, 'library-empty').exists()).toBe(false);
    expect(find(w, 'library-saved').exists()).toBe(false);
  });

  it('invites a first save when the library was read and holds none', () => {
    const w = menu({ saved: [], failed: false });
    expect(find(w, 'library-empty').text()).toContain('None yet');
  });

  it('lists what was read, and then says nothing about emptiness', () => {
    const w = menu({ saved: [SAVED] });
    expect(find(w, 'saved-id-1').text()).toBe('Blind defence, deep');
    expect(find(w, 'library-empty').exists()).toBe(false);
  });
});

describe('PresetMenu — opening a standard report', () => {
  it('offers each preset as a button under its own testid', () => {
    const w = menu();
    expect(find(w, 'preset-preflop_overview').element.tagName).toBe('BUTTON');
    expect(w.text()).toContain('Standard reports — My game');
  });

  it('hands the whole preset back, since the page opens it by its request', async () => {
    const w = menu();
    await find(w, 'preset-preflop_overview').trigger('click');
    expect(w.emitted('openPreset')).toEqual([[PRESET]]);
  });

  it('disables the presets while a report is running', () => {
    expect(find(menu({ busy: true }), 'preset-preflop_overview').attributes('disabled')).toBeDefined();
    expect(find(menu(), 'preset-preflop_overview').attributes('disabled')).toBeUndefined();
  });
});
