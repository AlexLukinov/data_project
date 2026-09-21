// @vitest-environment happy-dom
/**
 * The range-drawing trainer's undo and redo (audit §2.7): ⌘Z works from anywhere on the page, not
 * only while focus is inside the trainer, a stroke is one step back, and a drawing that has been
 * graded cannot be changed.
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { generate } from '~/train/spot-drawing';
import type { DrawingSpot } from '~/train/types';

import DrawingTrainer from './DrawingTrainer.vue';

const SPOT = generate(1);
const AA = 0;
const AA_COMBOS = '6 combos drawn';
const NOTHING = '0 combos drawn';

const mounted: ReturnType<typeof mount>[] = [];

function trainer(spot: DrawingSpot = SPOT) {
  const wrapper = mount(DrawingTrainer, { props: { spot, revealed: false } });
  mounted.push(wrapper);
  return wrapper;
}

/** A drag over one cell: down on it, up anywhere on the page. */
async function paint(wrapper: ReturnType<typeof trainer>, cls: number): Promise<void> {
  await wrapper.find(`[data-cls="${cls}"]`).trigger('pointerdown');
  window.dispatchEvent(new Event('pointerup'));
  await flushPromises();
}

/** A key pressed with focus on the page itself, nowhere near the trainer. */
async function press(key: string, mods: KeyboardEventInit = {}): Promise<void> {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
  await flushPromises();
}

const drawn = (wrapper: ReturnType<typeof trainer>) => wrapper.find('[data-testid="drawn-combos"]').text();
const button = (wrapper: ReturnType<typeof trainer>, id: string) => wrapper.find<HTMLButtonElement>(`[data-testid="${id}"]`);

describe('DrawingTrainer — undo and redo', () => {
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
  });

  it('ignores the keys and disables Undo, Redo and Clear once the drawing is revealed', async () => {
    const wrapper = trainer();
    await paint(wrapper, AA);
    await wrapper.setProps({ revealed: true });

    await press('z', { metaKey: true });
    expect(drawn(wrapper)).toBe(AA_COMBOS);
    for (const id of ['drawing-undo', 'drawing-redo', 'drawing-clear']) expect(button(wrapper, id).element.disabled).toBe(true);
  });

  it('starts a fresh history for a new chart', async () => {
    const wrapper = trainer();
    await paint(wrapper, AA);
    await wrapper.setProps({ spot: { ...SPOT, hash: `${SPOT.hash}-next` } });

    expect(drawn(wrapper)).toBe(NOTHING);
    expect(button(wrapper, 'drawing-undo').element.disabled).toBe(true);
    await press('z', { metaKey: true });
    expect(drawn(wrapper)).toBe(NOTHING);
  });

  it('takes a stroke back with ⌘Z pressed anywhere on the page, and puts it back with ⌘⇧Z', async () => {
    const wrapper = trainer();
    await paint(wrapper, AA);
    expect(drawn(wrapper)).toBe(AA_COMBOS);

    await press('z', { metaKey: true });
    expect(drawn(wrapper)).toBe(NOTHING);
    expect(wrapper.find(`[data-cls="${AA}"] .pk-fill`).attributes('style')).toContain('height: 0%');

    await press('z', { metaKey: true, shiftKey: true });
    expect(drawn(wrapper)).toBe(AA_COMBOS);
  });

  it('has a Redo button beside Undo, each naming its key', async () => {
    const wrapper = trainer();
    expect(button(wrapper, 'drawing-redo').element.disabled).toBe(true);
    await paint(wrapper, AA);

    await button(wrapper, 'drawing-undo').trigger('click');
    expect(drawn(wrapper)).toBe(NOTHING);
    expect(button(wrapper, 'drawing-redo').element.disabled).toBe(false);

    await button(wrapper, 'drawing-redo').trigger('click');
    expect(drawn(wrapper)).toBe(AA_COMBOS);
    expect(button(wrapper, 'drawing-undo').attributes('title')).toBe('⌘Z');
    expect(button(wrapper, 'drawing-redo').attributes('title')).toBe('⌘⇧Z');
  });
});
