// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, nextTick } from 'vue';
import type { VNode } from 'vue';

import type { TermEntry } from '~/stats/vocabulary';

import RegistryTerm from './RegistryTerm.vue';
/** The component's own source: two of its rules are things no unit mount can observe (see below). */
import SOURCE from './RegistryTerm.vue?raw';

/**
 * The affordance, not the wording (ADR-057): the definition must reach a mouse, a keyboard and a
 * finger, and reach a screen reader whether or not anything is open. The words themselves are
 * `stats/vocabulary.test.ts`'s business.
 */
const VPIP: TermEntry = {
  term: 'VPIP',
  definition: 'Voluntarily put money in the pot preflop, per hand dealt in (blind posts excluded). Usually 18–28%.',
  formula: 'Counted once per hand, and answered from the daily statistics, so it is cheap.',
};

type Props = { entry?: TermEntry; label?: string; name?: string };
/** The trigger slot, given the id it must describe itself with. */
type Trigger = (slot: { describedby: string }) => VNode;

function term(props: Props = {}, trigger?: Trigger, attachTo?: HTMLElement) {
  return mount(RegistryTerm, { props: { entry: VPIP, ...props }, slots: trigger ? { default: trigger } : {}, attachTo });
}

type Term = ReturnType<typeof term>;

const tip = (w: Term) => w.find('[role="tooltip"]');
const word = (w: Term) => w.find('.pk-term-text');

/** `v-show` keeps the tip in the DOM and hides it, which is what `aria-describedby` needs. */
const open = (w: Term) => (tip(w).element as HTMLElement).style.display !== 'none';
const spot = (w: Term) => (tip(w).element as HTMLElement).style;

type Box = { left: number; top: number; bottom: number };

/**
 * happy-dom measures nothing — every box is 0×0 and the window is a fixed size — so the word's
 * rectangle and the viewport around it are whatever the test says they are. The object is read on
 * every call, so a test can move the word and fire a scroll.
 */
function measures(box: Box, viewport = { width: 1000, height: 768 }): void {
  vi.stubGlobal('innerWidth', viewport.width);
  vi.stubGlobal('innerHeight', viewport.height);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        ...box,
        right: box.left,
        width: 0,
        height: box.bottom - box.top,
        x: box.left,
        y: box.top,
        toJSON: () => ({}),
      }) as DOMRect,
  );
}

/** A touch pointer event built by hand: happy-dom drops a `pointerType` passed through an init. */
function touch(el: Element, type: 'pointerdown' | 'pointerup'): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  el.dispatchEvent(event);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RegistryTerm — what a screen reader gets', () => {
  it('holds the definition in the DOM and points the word at it before anything is opened', () => {
    const w = term();
    const id = tip(w).attributes('id');
    expect(id).toBeTruthy();
    expect(word(w).attributes('aria-describedby')).toBe(id);
    expect(tip(w).text()).toContain('Voluntarily put money in the pot preflop');
    expect(open(w)).toBe(false);
  });

  it('shows the source line only when the entry has one', () => {
    expect(term().find('.pk-tip-source').text()).toBe(VPIP.formula);
    const plain = term({ entry: { term: 'the field', definition: 'Everyone else in the hands you have uploaded.' } });
    expect(plain.find('.pk-tip-source').exists()).toBe(false);
    expect(tip(plain).text()).toContain('Everyone else in the hands you have uploaded.');
  });
});

describe('RegistryTerm — the three ways in', () => {
  it('opens on focus and shuts on blur, so Tab alone reads it', async () => {
    const w = term();
    await word(w).trigger('focusin');
    expect(open(w)).toBe(true);
    await word(w).trigger('focusout');
    expect(open(w)).toBe(false);
  });

  it('opens on hover and shuts when the pointer leaves', async () => {
    const w = term();
    await w.trigger('pointerenter');
    expect(open(w)).toBe(true);
    await w.trigger('pointerleave');
    expect(open(w)).toBe(false);
  });

  /** A tap is a pointer and a focus at once, and lifting the finger must not take the tip away. */
  it('stays open when a hover ends while the word is still focused', async () => {
    const w = term();
    await w.trigger('pointerenter');
    await word(w).trigger('focusin');
    await w.trigger('pointerleave');
    expect(open(w)).toBe(true);
    await word(w).trigger('focusout');
    expect(open(w)).toBe(false);
  });

  it('lets Escape dismiss the tip without taking the keyboard with it', async () => {
    const w = term({}, undefined, document.body);
    const el = word(w).element as HTMLElement;
    el.focus();
    await word(w).trigger('focusin');
    expect(open(w)).toBe(true);
    await w.trigger('keydown', { key: 'Escape' });
    expect(open(w)).toBe(false);
    expect(document.activeElement).toBe(el);
    w.unmount();
  });
});

describe('RegistryTerm — the trigger', () => {
  it('lets a control that is already focusable carry the description itself', () => {
    const w = term({}, (slot) => h('button', { 'aria-describedby': slot.describedby }, 'VPIP'));
    expect(w.find('button').attributes('aria-describedby')).toBe(tip(w).attributes('id'));
    expect(word(w).exists()).toBe(false);
    expect(w.findAll('[tabindex="0"]')).toHaveLength(0);
  });

  it('opens from the slotted control the same way', async () => {
    const w = term({}, () => h('button', 'VPIP'));
    await w.find('button').trigger('focusin');
    expect(open(w)).toBe(true);
  });

  it('shows the entry’s own term, and names it in `data-term`', () => {
    const w = term();
    expect(word(w).text()).toBe('VPIP');
    expect(word(w).attributes('data-term')).toBe('VPIP');
  });

  it('lets a narrow column shorten the word without changing what the tip says', () => {
    const w = term({ label: '3-bet', name: 'threebet' });
    expect(word(w).text()).toBe('3-bet');
    expect(word(w).attributes('data-term')).toBe('threebet');
    expect(tip(w).text()).toContain('VPIP');
  });
});

describe('RegistryTerm — the finger, on a browser that does not focus a button', () => {
  /**
   * Safari and iOS Safari do not focus a `<button>` on tap, so the tap path cannot rest on focus:
   * without this the tip would open on `pointerenter` and close again on `pointerleave`, and every
   * slotted button — the grid headers, the situation builder's eighty — would be mouse-only.
   */
  it('holds the tip open after a touch tap, with no focus anywhere', async () => {
    const w = term({}, () => h('button', 'VPIP'));
    await w.trigger('pointerenter');
    touch(w.find('button').element, 'pointerup');
    await w.trigger('pointerleave');
    expect(open(w)).toBe(true);
  });

  it('puts a tapped tip away on the next pointer down elsewhere, and not on one inside the word', async () => {
    const w = term({}, () => h('button', 'VPIP'), document.body);
    await w.trigger('pointerenter');
    touch(w.find('button').element, 'pointerup');
    await w.trigger('pointerleave');

    touch(w.find('button').element, 'pointerdown');
    await nextTick();
    expect(open(w)).toBe(true);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();
    expect(open(w)).toBe(false);
    w.unmount();
  });

  it('lets Escape put away a tip a tap is holding open', async () => {
    const w = term({}, () => h('button', 'VPIP'));
    await w.trigger('pointerenter');
    touch(w.find('button').element, 'pointerup');
    await w.trigger('pointerleave');
    await w.trigger('keydown', { key: 'Escape' });
    expect(open(w)).toBe(false);
  });
});

describe('RegistryTerm — where the tip lands', () => {
  it('keeps the last column of a sideways-scrolling table inside the right edge', async () => {
    measures({ left: 2000, top: 24, bottom: 40 });
    const w = term();
    await w.trigger('pointerenter');
    expect(spot(w).left).toBe('642px');
    expect(spot(w).top).toBe('46px');
    expect(spot(w).bottom).toBe('');
  });

  /** A row Tab has just scrolled to the bottom edge would otherwise open its tip below the fold. */
  it('flips the tip above the word when there is no room under it', async () => {
    measures({ left: 100, top: 364, bottom: 380 }, { width: 1000, height: 400 });
    const w = term();
    await word(w).trigger('focusin');
    expect(spot(w).bottom).toBe('42px');
    expect(spot(w).top).toBe('');
  });

  /** `fixed` does not move with the page, so an open tip has to be told where the word went. */
  it('follows the word when the page scrolls under an open tip', async () => {
    const box = { left: 100, top: 300, bottom: 316 };
    measures(box);
    const w = term();
    await w.trigger('pointerenter');
    expect(spot(w).top).toBe('322px');

    box.top = 100;
    box.bottom = 116;
    globalThis.dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(spot(w).top).toBe('122px');
  });

  /** A slotted header opens the click-through panel above its own table, moving the header down. */
  it('re-places the tip after a click on the word has reflowed the page', async () => {
    const box = { left: 100, top: 300, bottom: 316 };
    measures(box);
    const w = term({}, () => h('button', 'VPIP'));
    await w.trigger('pointerenter');
    expect(spot(w).top).toBe('322px');

    box.top = 460;
    box.bottom = 476;
    await w.find('button').trigger('click');
    await nextTick();
    expect(spot(w).top).toBe('482px');
  });

  it('lets go of the window when the tip shuts, and when it unmounts still open', async () => {
    const added = vi.spyOn(globalThis, 'addEventListener');
    const dropped = vi.spyOn(globalThis, 'removeEventListener');
    const types = (spy: typeof added) => spy.mock.calls.map(([type]) => type);

    const w = term();
    await w.trigger('pointerenter');
    expect(types(added)).toEqual(expect.arrayContaining(['scroll', 'resize']));
    expect(types(dropped)).toHaveLength(0);

    await w.trigger('pointerleave');
    expect(types(dropped)).toEqual(expect.arrayContaining(['scroll', 'resize']));

    dropped.mockClear();
    await w.trigger('pointerenter');
    w.unmount();
    expect(types(dropped)).toEqual(expect.arrayContaining(['scroll', 'resize']));
  });
});

describe('RegistryTerm — what the tip must never do', () => {
  /**
   * No stylesheet is applied in a unit mount, so the rule itself is the assertion. A tip that takes
   * pointer events covers the link it is drawn over, holds the pointer inside the word so that
   * `pointerleave` never fires, and swallows the next tap; one wider than the screen is cut off at
   * the edge on a phone. Both are one deleted line away from coming back.
   */
  it('is inert to the pointer and never wider than the window', () => {
    const rule = /\.pk-tip \{([^}]*)\}/.exec(SOURCE)?.[1];
    expect(rule).toContain('pointer-events: none');
    expect(rule).toContain('calc(100vw - 12px)');
  });
});
