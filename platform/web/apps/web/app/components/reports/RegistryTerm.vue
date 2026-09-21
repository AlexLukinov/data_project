<script setup lang="ts">
/**
 * A registry word with its explanation (ADR-057): a dotted underline whose hover, focus or tap
 * shows the one sentence behind the word, and where the number is counted.
 *
 * Deliberately shaped like `@poker/ui`'s `TermLabel` — the same three props, the same
 * `describedby` slot — so that the two can become one component later. The one thing it cannot
 * borrow is the positioning. Every table that shows a registry word (`LeakTable`, `SessionTable`,
 * `StatGrid`) sits inside an `overflow-x-auto` wrapper, and a tip positioned `absolute` inside one
 * is clipped at the wrapper's edge or grows it a scrollbar. So the tip is `fixed` and placed from
 * the trigger's own bounding rect, which no ancestor can crop.
 *
 * `fixed` is placed once and then goes stale, so while the tip is open the word is followed: the
 * page scrolls, the window resizes, and a slotted header button opens the click-through panel
 * *above* its own table and pushes the header itself down. It also flips above the word when the
 * viewport has no room below, which is the only reason a row at the bottom edge of the screen —
 * the one Tab just scrolled into view — has a readable tip at all.
 *
 * Three affordances, not one: hover, focus (Tab, then Escape to dismiss) and tap. A `title=` has
 * none of the last two, which is why it is not used. Safari does not focus a `<button>` on tap, so
 * a touch tap holds the tip open by itself rather than relying on focus. `aria-describedby` points
 * at the tip whether it is open or shut — a hidden node that is directly referenced is still read
 * out — so the definition reaches a screen reader without anything being opened at all.
 *
 * No wording lives here. Every word comes from `stats/vocabulary.ts`.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';

import type { TermEntry } from '~/stats/vocabulary';

const props = defineProps<{
  entry: TermEntry;
  /** The visible text when it should differ from the entry's term (a shorter column header). */
  label?: string;
  /** Written as `data-term` on the fallback trigger; defaults to the entry's term. */
  name?: string;
}>();

defineSlots<{
  /** The trigger, when it is already a control; bind `describedby` to its `aria-describedby`. */
  default?: (props: { describedby: string }) => unknown;
}>();

/** The gap between the word and its tip, and the tip's own ceiling — the `max-width` below. */
const GAP_PX = 6;
const TIP_WIDTH_PX = 352;
/**
 * The room a tip is assumed to need under the word. A constant rather than a measurement because
 * the tip is `display: none` until it opens and a hidden element's `offsetHeight` is 0 — measuring
 * would report that every tip fits anywhere, which is the bug this is here to avoid. 112px is a
 * five-line tip at this size plus its padding and border.
 */
const TIP_HEIGHT_PX = 112;
/** Following a scroll must never delay one: passive, and in capture, because tables scroll too. */
const SCROLL_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

/** Which viewport edge the tip is pinned to, and how far in — `top` below the word, `bottom` above. */
type Placement = { left: number; edge: 'top' | 'bottom'; offset: number };

const id = useId();
const root = ref<HTMLElement | null>(null);
const at = ref<Placement | null>(null);
const hovered = ref(false);
const focused = ref(false);
const tapped = ref(false);

const style = computed(() =>
  at.value === null ? {} : { left: `${at.value.left}px`, [at.value.edge]: `${at.value.offset}px` },
);

/**
 * Place the tip against the word, inside the viewport on both axes: the tables this appears in
 * scroll sideways, so the last column's word sits a few pixels from the right edge, and a word near
 * the bottom of the screen has no room underneath — there the tip goes above it instead.
 */
function place(): void {
  const box = root.value?.getBoundingClientRect();
  if (box === undefined) return;
  const width = globalThis.innerWidth || TIP_WIDTH_PX + GAP_PX * 2;
  const height = globalThis.innerHeight || TIP_HEIGHT_PX * 2;
  const room = width - Math.min(TIP_WIDTH_PX, width - GAP_PX * 2) - GAP_PX;
  const left = Math.max(GAP_PX, Math.min(box.left, room));
  if (box.bottom + GAP_PX + TIP_HEIGHT_PX <= height) {
    at.value = { left, edge: 'top', offset: box.bottom + GAP_PX };
    return;
  }
  at.value = { left, edge: 'bottom', offset: Math.max(GAP_PX, height - box.top + GAP_PX) };
}

/** Hover, focus and a touch tap are independent: any one of them still holding keeps the tip up. */
function shut(): void {
  if (!hovered.value && !focused.value && !tapped.value) at.value = null;
}

/** Escape, or a pointer landing anywhere else, takes the tip away whatever was holding it open. */
function close(): void {
  hovered.value = false;
  focused.value = false;
  tapped.value = false;
  at.value = null;
}

function onEnter(): void {
  hovered.value = true;
  place();
}

function onLeave(): void {
  hovered.value = false;
  shut();
}

function onFocus(): void {
  focused.value = true;
  place();
}

function onBlur(): void {
  focused.value = false;
  tapped.value = false;
  shut();
}

/**
 * Safari and iOS Safari do not focus a `<button>` on tap, so every slotted trigger would open on
 * `pointerenter` and close again on `pointerleave` with no focus in between — the definition would
 * be unreachable by finger, which is the affordance ADR-057 exists to provide. A touch tap
 * therefore holds the tip open on its own, until Escape, a blur, or a tap somewhere else.
 */
function onTap(event: PointerEvent): void {
  if (event.pointerType !== 'touch') return;
  tapped.value = true;
  place();
}

/** A tap held the tip open; the next tap anywhere else is how it is put away. */
function onOutside(event: Event): void {
  const target = event.target;
  if (target instanceof Node && root.value?.contains(target) === true) return;
  close();
}

/**
 * A slotted header button opens the click-through panel *above* its own table, which moves the
 * word down the page while a `fixed` tip stays where it was. Re-place once that has rendered.
 */
function onClick(): void {
  if (at.value !== null) void nextTick(place);
}

/** An open tip follows the word; a shut one listens to nothing, and neither does an unmounted one. */
function follow(on: boolean): void {
  if (on) {
    globalThis.addEventListener('scroll', place, SCROLL_OPTIONS);
    globalThis.addEventListener('resize', place);
    document.addEventListener('pointerdown', onOutside, true);
    return;
  }
  globalThis.removeEventListener('scroll', place, SCROLL_OPTIONS);
  globalThis.removeEventListener('resize', place);
  document.removeEventListener('pointerdown', onOutside, true);
}

watch(() => at.value !== null, follow);
onBeforeUnmount(() => follow(false));
</script>

<template>
  <span
    ref="root"
    class="pk-term"
    @pointerenter="onEnter"
    @pointerleave="onLeave"
    @pointerup="onTap"
    @click="onClick"
    @focusin="onFocus"
    @focusout="onBlur"
    @keydown.escape="close"
  >
    <slot :describedby="id">
      <span class="pk-term-text" tabindex="0" :aria-describedby="id" :data-term="props.name ?? props.entry.term">{{ props.label ?? props.entry.term }}</span>
    </slot>
    <span v-show="at !== null" :id="id" role="tooltip" class="pk-tip" :style="style">
      <strong>{{ props.entry.term }}</strong> · {{ props.entry.definition }}
      <span v-if="props.entry.formula" class="pk-tip-source">{{ props.entry.formula }}</span>
    </span>
  </span>
</template>

<style scoped>
.pk-term {
  display: inline-block;
}
/* `:slotted` so a consumer that needs the test id on the visible word itself — rather than on this
   root, where it would swallow the tip's text — can pass the same plain word through the slot. */
.pk-term-text,
:slotted(.pk-term-text) {
  border-bottom: 1px dotted currentColor;
  cursor: help;
}
.pk-term-text:focus-visible,
:slotted(.pk-term-text:focus-visible) {
  outline: 2px solid var(--pk-accent, #2563eb);
  outline-offset: 2px;
}
.pk-tip {
  position: fixed;
  z-index: 30;
  width: max-content;
  /* Never wider than the phone it is on: 12px is the 6px gap kept on both sides. */
  max-width: min(22rem, calc(100vw - 12px));
  padding: 0.4rem 0.6rem;
  /* The tip is never interactive. Inert, it cannot cover the link underneath it, cannot hold the
     pointer inside `.pk-term` so that `pointerleave` never fires, and cannot eat the next tap. */
  pointer-events: none;
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.4;
  text-align: left;
  text-transform: none;
  letter-spacing: 0;
  white-space: normal;
  color: var(--pk-fg, #18181b);
  background: var(--pk-bg, #ffffff);
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
}
.pk-tip-source {
  display: block;
  margin-top: 0.25rem;
  color: var(--pk-muted, #71717a);
}
</style>
