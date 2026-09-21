<script setup lang="ts">
/**
 * The first-run tour (spec §13: "short, skippable, resumable from the help menu").
 *
 * One card beside the part of the page it describes, found by a `data-testid` that page already
 * carries — the tour adds no attribute to anyone else's markup. Not a modal: the page stays
 * usable underneath, Esc or *End tour* stops it where it is, and the help menu resumes from that
 * stop. A stop whose anchor never appears says so on the card rather than waiting in silence.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { Box, Placement } from '~/help/placement';
import { placeCard } from '~/help/placement';
import type { TourStop } from '~/help/tour';
import { isTyping } from '~/help/shortcuts';
import { ANCHOR_POLL_MS, ANCHOR_WAIT_MS, chapterAt, goToStop } from '~/help/tour';
import { useHelp } from '~/help/useHelp';

const props = defineProps<{ stops: readonly TourStop[] }>();

const help = useHelp();
const route = useRoute();
const card = ref<HTMLElement | null>(null);
const anchor = ref<Box | null>(null);
const placement = ref<Placement | null>(null);
const missing = ref(false);

const index = computed(() => help.state.value.stop);
const current = computed(() => (help.state.value.tour === 'running' ? (props.stops[index.value] ?? null) : null));
const here = computed(() => current.value !== null && route.path === current.value.route);
const last = computed(() => index.value === props.stops.length - 1);
/** Where the reader is in the tutorial: which chapter, and which stop inside it. */
const progress = computed(() => chapterAt(props.stops, index.value));

let tracked: HTMLElement | null = null;
let search = 0;

async function place(): Promise<void> {
  await nextTick();
  if (tracked === null || card.value === null) return;
  // The page can replace what the stop points at without changing the route — a step component is
  // rebuilt, a panel closes. A detached element measures as a zero box at the window's corner, so
  // look for the anchor again instead of ringing nothing.
  if (!tracked.isConnected) {
    void locate();
    return;
  }
  const rect = tracked.getBoundingClientRect();
  anchor.value = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  placement.value = placeCard(anchor.value, card.value.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
}

/** Wait for this stop's anchor to render (pages load lazily), then point at it. */
async function locate(): Promise<void> {
  const mine = ++search;
  tracked = null;
  anchor.value = null;
  placement.value = null;
  missing.value = false;
  const stop = current.value;
  if (stop === null || !here.value) return;
  const started = Date.now();
  while (mine === search) {
    const found = document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(stop.anchor)}"]`);
    if (found !== null) {
      found.scrollIntoView({ block: 'center' });
      tracked = found;
      await place();
      card.value?.focus({ preventScroll: true });
      return;
    }
    if (Date.now() - started > ANCHOR_WAIT_MS) {
      missing.value = true;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ANCHOR_POLL_MS));
  }
}

function move(to: number): void {
  void goToStop(help, props.stops, to, (path) => navigateTo(path));
}

function end(): void {
  help.update({ tour: 'stopped' });
}

/**
 * Esc ends the tour — but not while a dialog is open, whose own Esc must not end the tour as well,
 * and not while the reader is typing, where Esc belongs to the box they are in.
 */
function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || current.value === null || isTyping(event.target)) return;
  if (document.querySelector('dialog[open]') !== null) return;
  end();
}

/** Scrolling can fire many times a frame; the card only has to be right once per frame. */
let queued = false;

function onViewportChange(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    void place();
  });
}

watch([current, () => route.path], () => void locate(), { immediate: true });

onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
});
onBeforeUnmount(() => {
  search += 1;
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, { capture: true });
});

const cardStyle = computed(() => (placement.value === null ? {} : { top: `${placement.value.top}px`, left: `${placement.value.left}px`, right: 'auto', bottom: 'auto' }));
const ringStyle = computed(() => (anchor.value === null ? {} : { top: `${anchor.value.top - 4}px`, left: `${anchor.value.left - 4}px`, width: `${anchor.value.width + 8}px`, height: `${anchor.value.height + 8}px` }));
</script>

<template>
  <template v-if="current">
    <div v-if="anchor && placement" class="pointer-events-none fixed z-40 rounded-md ring-2 ring-amber-500" :style="ringStyle" data-testid="tour-ring" />
    <section
      ref="card"
      role="dialog"
      aria-modal="false"
      aria-labelledby="tour-title"
      tabindex="-1"
      class="fixed bottom-3 right-3 z-50 w-80 max-w-[calc(100vw-1.5rem)] space-y-2 rounded-lg border border-amber-400 bg-white p-3 text-sm text-zinc-900 shadow-lg outline-none dark:border-amber-600 dark:bg-zinc-950 dark:text-zinc-100"
      :style="cardStyle"
      data-testid="tour-card"
    >
      <p v-if="progress" class="text-xs uppercase tracking-wide text-zinc-500" data-testid="tour-progress">
        {{ progress.area }} · chapter {{ progress.chapter }} of {{ progress.chapters }} · {{ progress.step }} of {{ progress.steps }} · {{ current.where }}
      </p>
      <h2 id="tour-title" class="font-semibold" data-testid="tour-title">{{ current.title }}</h2>
      <p v-for="line in current.lines" :key="line" class="text-zinc-700 dark:text-zinc-300" data-testid="tour-line">{{ line }}</p>
      <p v-if="current.tryIt" data-testid="tour-tryit">
        <NuxtLink :to="current.tryIt.to" class="underline underline-offset-2" @click="end">{{ current.tryIt.label }}</NuxtLink>
      </p>
      <p v-if="last" class="text-xs text-zinc-500" data-testid="tour-last">The tour, the Examples and the shortcuts stay under Help, top right.</p>
      <p v-if="!here" class="text-zinc-500" data-testid="tour-elsewhere">
        This stop is on another page.
        <button type="button" class="underline" data-testid="tour-go" @click="move(index)">Take me there</button>
      </p>
      <p v-else-if="missing" role="status" class="text-amber-700 dark:text-amber-400" data-testid="tour-missing">
        The part of the page this stop points at has not appeared, so the card sits here instead.
      </p>
      <div class="flex items-center gap-2 pt-1">
        <button type="button" class="rounded border border-zinc-300 px-2 py-0.5 disabled:opacity-40 dark:border-zinc-700" :disabled="index === 0" data-testid="tour-back" @click="move(index - 1)">Back</button>
        <button type="button" class="rounded bg-zinc-900 px-2 py-0.5 text-white dark:bg-zinc-100 dark:text-zinc-900" data-testid="tour-next" @click="move(index + 1)">{{ last ? 'Finish' : 'Next' }}</button>
        <button type="button" class="ml-auto text-zinc-500 hover:underline" data-testid="tour-end" @click="end">End tour <kbd class="text-xs">Esc</kbd></button>
      </div>
    </section>
  </template>
</template>
