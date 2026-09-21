<script setup lang="ts">
/**
 * Attaches a control's sentence to the control, without editing the component that renders it
 * (plan F.13, ADR-058).
 *
 * The tutorial's rule, applied one level down: anchor on what the markup already declares. For
 * every entry in `~/help/controls` this finds the matching elements and sets two things on them —
 * `aria-describedby`, pointing at a tip rendered *here*, and `data-help`, our own attribute, which
 * is what the styles and the delegated listeners key off. Nothing is inserted into another lane's
 * DOM, no bound class or attribute is touched, and several of these controls are `<select>`s and
 * range inputs that could not host a child element anyway.
 *
 * **Listeners are delegated to the document**, so a re-render costs nothing and there is nothing
 * to unbind per element; a `MutationObserver` re-runs the scan when the page changes. The tip
 * opens on hover, on focus and on a tap, closes on Escape and on a click elsewhere — the same
 * affordance as `RegistryTerm`, and never a bare `title`, which no keyboard and no finger can
 * reach.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { ControlHelp } from '~/help/controls';
import { CONTROLS, controlById, tipId } from '~/help/controls';
import { clearHighlight, highlightedControl, setAttachedControls } from '~/help/explainer';
import type { Box } from '~/help/placement';
import { placeCard } from '~/help/placement';
import { isTyping } from '~/help/shortcuts';

/** The tip's assumed size, as `RegistryTerm` assumes one: enough to place it without measuring. */
const TIP_WIDTH = 340;
const TIP_HEIGHT = 124;
/** How long a control asked for from the explainer stays ringed. */
const HIGHLIGHT_MS = 2600;
const PASSIVE: AddEventListenerOptions = { capture: true, passive: true };

const route = useRoute();
const active = ref('');
const at = ref<{ top: number; left: number } | null>(null);
const ring = ref<Box | null>(null);
/** A tip opened by a tap stays until something else is touched; hover and focus close themselves. */
const sticky = ref(false);

let observer: MutationObserver | null = null;
let scanQueued = false;
let ringTimer: ReturnType<typeof setTimeout> | null = null;

const shown = computed<ControlHelp | null>(() => (active.value === '' ? null : controlById(active.value)));
const tipStyle = computed(() => (at.value === null ? {} : { top: `${at.value.top}px`, left: `${at.value.left}px` }));
const ringStyle = computed(() =>
  ring.value === null ? {} : { top: `${ring.value.top - 4}px`, left: `${ring.value.left - 4}px`, width: `${ring.value.width + 8}px`, height: `${ring.value.height + 8}px` },
);

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/** What a Tab lands on. A control that has one of these inside it is already reachable. */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]';

/** Add our tip to whatever the control is already described by, once. */
function describe(element: HTMLElement, id: string): void {
  const existing = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((value) => value !== '');
  if (existing.includes(id)) return;
  element.setAttribute('aria-describedby', [...existing, id].join(' '));
}

/**
 * Make a control that nothing can focus reachable by Tab, the way `TermLabel` makes an explained
 * word reachable: a plain `tabindex="0"`. Only where the element is not focusable **and** holds
 * nothing focusable, so a picker full of buttons gains no second tab stop — and taken away again
 * if it later grows one, which is why the attribute we added is marked as ours.
 */
function reach(element: HTMLElement): void {
  // Our own `tabindex` makes the element match `[tabindex]`, so asking the question again would
  // answer "already focusable" and take it straight back off — on, off, on, with the final state
  // decided by how many times the page happened to change. So a tab stop we added never counts.
  const ours = element.dataset.helpTab !== undefined;
  const needed = !(ours ? false : element.matches(FOCUSABLE)) && element.querySelector(FOCUSABLE) === null;
  if (needed && element.dataset.helpTab === undefined) {
    element.dataset.helpTab = 'yes';
    element.setAttribute('tabindex', '0');
    return;
  }
  if (!needed && element.dataset.helpTab !== undefined) {
    delete element.dataset.helpTab;
    element.removeAttribute('tabindex');
  }
}

function scan(): void {
  const found: string[] = [];
  for (const control of CONTROLS) {
    const matches = document.querySelectorAll<HTMLElement>(control.anchor);
    if (matches.length > 0) found.push(control.id);
    for (const element of matches) {
      if (element.dataset.help !== control.id) element.dataset.help = control.id;
      describe(element, tipId(control.id));
      reach(element);
    }
  }
  setAttachedControls(found);
}

function queueScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    scan();
  });
}

function hostOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-help]') : null;
}

function place(host: HTMLElement): void {
  const placed = placeCard(boxOf(host), { width: TIP_WIDTH, height: TIP_HEIGHT }, { width: window.innerWidth, height: window.innerHeight });
  at.value = { top: placed.top, left: placed.left };
}

function show(host: HTMLElement | null): void {
  const id = host?.dataset.help ?? '';
  if (host === null || id === '' || controlById(id) === null) return;
  active.value = id;
  place(host);
}

function close(): void {
  active.value = '';
  sticky.value = false;
  at.value = null;
}

function onOver(event: PointerEvent): void {
  if (sticky.value) return;
  const host = hostOf(event.target);
  if (host === null) return;
  show(host);
}

function onOut(event: PointerEvent): void {
  if (sticky.value || active.value === '') return;
  if (hostOf(event.relatedTarget) !== null) return;
  if (document.activeElement !== null && hostOf(document.activeElement) !== null) return;
  close();
}

function onFocusIn(event: FocusEvent): void {
  const host = hostOf(event.target);
  if (host !== null) show(host);
}

function onFocusOut(): void {
  if (!sticky.value) close();
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerType !== 'touch') return;
  const host = hostOf(event.target);
  if (host === null) {
    close();
    return;
  }
  sticky.value = true;
  show(host);
}

function onPointerDown(event: PointerEvent): void {
  if (sticky.value && hostOf(event.target) === null) close();
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || active.value === '' || isTyping(event.target)) return;
  close();
}

function reposition(): void {
  if (active.value === '') return;
  const host = document.querySelector<HTMLElement>(`[data-help="${CSS.escape(active.value)}"]`);
  if (host === null) close();
  else place(host);
}

watch(highlightedControl, (id) => {
  if (ringTimer !== null) clearTimeout(ringTimer);
  if (id === '') {
    ring.value = null;
    return;
  }
  const host = document.querySelector<HTMLElement>(`[data-help="${CSS.escape(id)}"]`);
  if (host === null) return;
  host.scrollIntoView({ block: 'center' });
  ring.value = boxOf(host);
  show(host);
  ringTimer = setTimeout(() => {
    ring.value = null;
    clearHighlight();
  }, HIGHLIGHT_MS);
});

watch(() => route.fullPath, () => {
  close();
  ring.value = null;
  queueScan();
});

onMounted(() => {
  scan();
  observer = new MutationObserver(queueScan);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointerover', onOver, PASSIVE);
  document.addEventListener('pointerout', onOut, PASSIVE);
  document.addEventListener('pointerup', onPointerUp, PASSIVE);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, PASSIVE);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  if (ringTimer !== null) clearTimeout(ringTimer);
  document.removeEventListener('pointerover', onOver, PASSIVE);
  document.removeEventListener('pointerout', onOut, PASSIVE);
  document.removeEventListener('pointerup', onPointerUp, PASSIVE);
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('focusin', onFocusIn, true);
  document.removeEventListener('focusout', onFocusOut, true);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', reposition);
  window.removeEventListener('scroll', reposition, PASSIVE);
});

defineExpose({ scan });
</script>

<template>
  <div>
    <div v-if="ring" class="pointer-events-none fixed z-40 rounded-md ring-2 ring-sky-500" :style="ringStyle" data-testid="control-help-ring" />
    <span
      v-for="control in CONTROLS"
      :id="tipId(control.id)"
      :key="control.id"
      role="tooltip"
      class="pk-control-tip"
      :hidden="active !== control.id"
      :style="active === control.id ? tipStyle : undefined"
      :data-testid="`control-tip-${control.id}`"
    >
      <strong>{{ control.control }}</strong> · {{ control.does }}
    </span>
    <span v-if="shown" class="sr-only" role="status" data-testid="control-help-open">{{ shown.control }}</span>
  </div>
</template>

<style>
/*
 * Global rather than scoped, because the cue goes on elements this component never renders.
 * `cursor` and `outline` are the two properties that can be added to an arbitrary control
 * without moving anything: an outline is painted outside the border box and takes part in no
 * layout, so a hairline on hover or focus cannot reflow somebody else's page.
 */
[data-help] {
  cursor: help;
}
[data-help]:hover,
[data-help]:focus-within {
  outline: 1px dotted var(--pk-muted, #71717a);
  outline-offset: 2px;
}
</style>

<style scoped>
.pk-control-tip[hidden] {
  display: none;
}
.pk-control-tip {
  position: fixed;
  z-index: 45;
  width: max-content;
  max-width: min(21rem, calc(100vw - 16px));
  padding: 0.4rem 0.6rem;
  pointer-events: none;
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.4;
  text-align: left;
  white-space: normal;
  color: var(--pk-fg, #18181b);
  background: var(--pk-bg, #ffffff);
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
