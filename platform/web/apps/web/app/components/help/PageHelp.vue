<script setup lang="ts">
/**
 * The per-page explainer (plan F.13, ADR-058): one line saying what this screen is, opening to
 * the tool's whole card and the sentences for the controls on it.
 *
 * **Open on the first visit to a tool, collapsed on every later one.** The decision is read
 * synchronously from `localStorage` at setup, so the card is already in its final state on the
 * first paint and nothing moves under the reader. Collapsing it is what marks the tool read —
 * a reader who closes it has been told — and `help/state.ts` remembers tools by id rather than
 * by a counter, so a screen added next month explains itself even to somebody who has been here
 * for a year. Help ▸ Explain this page opens it again, always.
 *
 * It sits in the flow at the top of `<main>`, never over the page, so it cannot cover a control.
 */
import { computed, nextTick, ref, watch } from 'vue';

import ToolCard from '~/components/help/ToolCard.vue';
import type { ControlHelp } from '~/help/controls';
import { controlById } from '~/help/controls';
import { attachedControls, explainerRequests, highlightControl } from '~/help/explainer';
import { hasSeenTool, seeTool } from '~/help/state';
import { toolForPath } from '~/help/tools';
import { useHelp } from '~/help/useHelp';

const help = useHelp();
const route = useRoute();

const tool = computed(() => toolForPath(route.path));
const open = ref(firstVisit());
const card = ref<HTMLElement | null>(null);

/** Whether this tool's card should open by itself: it has one, and it has not been read. */
function firstVisit(): boolean {
  const current = toolForPath(route.path);
  return current !== null && !hasSeenTool(help.state.value, current.id);
}

const controlsHere = computed<readonly ControlHelp[]>(() =>
  attachedControls.value.map(controlById).filter((control): control is ControlHelp => control !== null),
);

function collapse(): void {
  open.value = false;
  if (tool.value !== null) seeTool(help, tool.value.id);
}

function toggle(): void {
  if (open.value) collapse();
  else open.value = true;
}

function point(id: string): void {
  highlightControl(id);
}

watch(() => route.path, () => {
  open.value = firstVisit();
});

watch(explainerRequests, () => {
  open.value = true;
  void nextTick(() => card.value?.focus());
});
</script>

<template>
  <section
    v-if="tool"
    ref="card"
    class="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/40"
    tabindex="-1"
    :aria-labelledby="`page-help-what-${tool.id}`"
    data-testid="page-help"
    @keydown.escape="collapse"
  >
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span :id="`page-help-what-${tool.id}`" class="flex-1 text-zinc-700 dark:text-zinc-300" data-testid="page-help-what">
        <strong class="font-medium">{{ tool.name }}.</strong> {{ tool.what }}
      </span>
      <button
        type="button"
        class="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        :aria-expanded="open"
        data-testid="page-help-toggle"
        @click="toggle"
      >
        {{ open ? 'Hide' : 'How does this work?' }}
      </button>
      <NuxtLink to="/help" class="text-xs text-zinc-500 underline underline-offset-2" data-testid="page-help-all">All tools</NuxtLink>
    </div>

    <div v-if="open" class="mt-3 space-y-4 border-t border-zinc-200 pt-3 dark:border-zinc-800" data-testid="page-help-card">
      <ToolCard :tool="tool" :heading-level="2" />

      <section v-if="controlsHere.length" class="space-y-1" data-testid="page-help-controls">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">What the controls do</h3>
        <ul class="space-y-1 text-zinc-700 dark:text-zinc-300">
          <li v-for="control in controlsHere" :key="control.id" :data-testid="`page-help-control-${control.id}`">
            <button type="button" class="font-medium underline underline-offset-2" :data-testid="`page-help-point-${control.id}`" @click="point(control.id)">{{ control.control }}</button>
            — {{ control.does }}
          </li>
        </ul>
      </section>

      <p class="text-xs text-zinc-500">
        Press <kbd class="rounded border border-zinc-300 px-1 dark:border-zinc-700">Esc</kbd> to close this, or
        <kbd class="rounded border border-zinc-300 px-1 dark:border-zinc-700">?</kbd> for the keyboard shortcuts.
      </p>
    </div>
  </section>
</template>
