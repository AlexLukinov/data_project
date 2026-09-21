<script setup lang="ts">
/**
 * The help menu in the header: this page's explainer, the tutorial (taken, resumed, restarted or
 * opened at a chapter), the Examples, the whole catalogue, and the shortcut list. Spec §13 asks
 * for a tour "resumable from the help menu"; F.13 adds the chapters and the explainer to it.
 * A native `<details>`, so it opens with Enter and needs no focus management of its own.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { openExplainer } from '~/help/explainer';
import type { TourStop } from '~/help/tour';
import { TOUR_CHAPTERS, chapterStart, goToStop, resumeAt } from '~/help/tour';
import { useHelp } from '~/help/useHelp';

const props = defineProps<{ stops: readonly TourStop[] }>();
const emit = defineEmits<{ shortcuts: [] }>();

const help = useHelp();
const route = useRoute();
const menu = ref<HTMLDetailsElement | null>(null);

const tourLabel = computed(() => {
  const { tour, stop } = help.state.value;
  if (tour === 'running') return 'Restart the tour';
  if (tour === 'stopped' && stop < props.stops.length) return `Resume the tour (stop ${stop + 1} of ${props.stops.length})`;
  return 'Take the tour';
});

/** The chapters, with where each one starts. A chapter with no stops is simply not offered. */
const chapters = computed(() =>
  TOUR_CHAPTERS.flatMap((area) => {
    const at = chapterStart(props.stops, area);
    return at === null ? [] : [{ area, at }];
  }),
);

const chaptersOpen = ref(false);

function close(): void {
  if (menu.value !== null) menu.value.open = false;
}

/** A menu left open behind the reader is clutter: a click anywhere else, or a new page, closes it. */
function onPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (menu.value !== null && target instanceof Node && !menu.value.contains(target)) close();
}

watch(() => route.fullPath, close);
onMounted(() => document.addEventListener('pointerdown', onPointerDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown));

function tour(): void {
  close();
  const from = help.state.value.tour === 'running' ? 0 : resumeAt(help, props.stops);
  void goToStop(help, props.stops, from, (path) => navigateTo(path));
}

function chapter(at: number): void {
  close();
  chaptersOpen.value = false;
  void goToStop(help, props.stops, at, (path) => navigateTo(path));
}

/** Reopen this page's explainer, wherever the reader is and whether or not they closed it. */
function explain(): void {
  close();
  openExplainer();
}

function shortcuts(): void {
  close();
  emit('shortcuts');
}
</script>

<template>
  <details ref="menu" class="relative" data-testid="help-menu">
    <summary class="cursor-pointer list-none text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">Help</summary>
    <div class="absolute right-0 z-30 mt-2 w-72 space-y-1 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
      <button type="button" class="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900" data-testid="help-explain" @click="explain">Explain this page</button>
      <button type="button" class="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900" data-testid="help-tour" @click="tour">{{ tourLabel }}</button>
      <div class="rounded">
        <button type="button" class="flex w-full items-baseline justify-between rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900" :aria-expanded="chaptersOpen" data-testid="help-chapters" @click="chaptersOpen = !chaptersOpen">
          Chapters <span class="text-xs text-zinc-500">{{ chapters.length }}</span>
        </button>
        <ul v-if="chaptersOpen" class="space-y-0.5 pl-2" data-testid="help-chapter-list">
          <li v-for="item in chapters" :key="item.area">
            <button type="button" class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900" :data-testid="`help-chapter-${item.area}`" @click="chapter(item.at)">{{ item.area }}</button>
          </li>
        </ul>
      </div>
      <NuxtLink to="/examples" class="block rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900" data-testid="help-examples" @click="close">Examples</NuxtLink>
      <NuxtLink to="/help" class="block rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900" data-testid="help-all-tools" @click="close">All tools</NuxtLink>
      <button type="button" class="flex w-full items-baseline justify-between rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900" data-testid="help-shortcuts" @click="shortcuts">
        Keyboard shortcuts <kbd class="rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700">?</kbd>
      </button>
    </div>
  </details>
</template>
