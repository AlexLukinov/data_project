<script setup lang="ts">
/**
 * Help: every tool in the app, grouped the way the areas are, each with its one-liner and the
 * way in (plan F.13, ADR-058). This is the page to send somebody who has just been given an
 * account and does not know what any of it is for.
 *
 * Public and entirely client-side: the catalogue is data in this bundle, so the page reads with
 * the API stopped and signed out, including the entries for screens that do need an account.
 * The tutorial's first three chapters stop on this page for exactly that reason.
 */
import { ref } from 'vue';

import ToolCard from '~/components/help/ToolCard.vue';
import { TOUR_CHAPTERS, chapterStart, goToStop, TOUR_STOPS } from '~/help/tour';
import type { Tool } from '~/help/tools';
import { linkFor, toolsByArea } from '~/help/tools';
import { useHelp } from '~/help/useHelp';

definePageMeta({ public: true }); // the catalogue is data in this bundle (ADR-058)

const help = useHelp();
const groups = toolsByArea();
const open = ref('');

function toggle(id: string): void {
  open.value = open.value === id ? '' : id;
}

/** Start the tutorial at this area's chapter, from the reader's own spot on this page. */
function startChapter(area: string): void {
  const at = chapterStart(TOUR_STOPS, area);
  if (at === null) return;
  void goToStop(help, TOUR_STOPS, at, (path) => navigateTo(path));
}

function hasChapter(area: string): boolean {
  return TOUR_CHAPTERS.some((chapter) => chapter === area);
}

function summary(tool: Tool): string {
  return open.value === tool.id ? 'Less' : 'How it works';
}
</script>

<template>
  <section class="space-y-8">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Help</h1>
      <p class="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
        Every screen in the app, what it is for, and what it will not tell you. Nothing here needs an account or a running
        server — open a tool when you want to use it, or an example when you would rather see it first.
      </p>
    </div>

    <section v-for="group in groups" :key="group.area" class="space-y-3" :data-testid="`help-area-${group.area}`">
      <div class="flex flex-wrap items-baseline gap-3 border-b border-zinc-200 pb-1 dark:border-zinc-800">
        <h2 class="text-lg font-semibold">{{ group.area }}</h2>
        <button
          v-if="hasChapter(group.area)"
          type="button"
          class="text-sm text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          :data-testid="`help-chapter-${group.area}`"
          @click="startChapter(group.area)"
        >
          Walk me through it
        </button>
      </div>

      <ul class="space-y-2">
        <li
          v-for="tool in group.tools"
          :key="tool.id"
          class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          :data-testid="`help-tool-${tool.id}`"
        >
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <NuxtLink :to="linkFor(tool.route)" class="font-medium underline underline-offset-2" :data-testid="`help-open-${tool.id}`">{{ tool.name }}</NuxtLink>
            <span class="flex-1 text-sm text-zinc-600 dark:text-zinc-400" :data-testid="`help-what-${tool.id}`">{{ tool.what }}</span>
            <button
              type="button"
              class="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              :aria-expanded="open === tool.id"
              :data-testid="`help-more-${tool.id}`"
              @click="toggle(tool.id)"
            >
              {{ summary(tool) }}
            </button>
          </div>
          <div v-if="open === tool.id" class="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <ToolCard :tool="tool" />
          </div>
        </li>
      </ul>
    </section>
  </section>
</template>
