<script setup lang="ts">
/**
 * What a first visit is offered (spec §13): the tour, and the Examples, which open with nothing
 * uploaded and no account. Inline under the header rather than a modal, so it traps nothing; it
 * goes away for good once the reader takes either or says no, and the help menu keeps both.
 */
import type { TourStop } from '~/help/tour';
import { goToStop } from '~/help/tour';
import { useHelp } from '~/help/useHelp';

interface OfferedExample {
  readonly id: string;
  readonly title: string;
  readonly teaches: string;
}

const props = defineProps<{ stops: readonly TourStop[]; examples: readonly OfferedExample[] }>();

const help = useHelp();

function takeTour(): void {
  void goToStop(help, props.stops, 0, (path) => navigateTo(path));
}

function answer(): void {
  help.update({ welcomed: true });
}
</script>

<template>
  <aside class="border-b border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40" aria-labelledby="welcome-title" data-testid="welcome-offer">
    <div class="mx-auto max-w-7xl space-y-3 px-4 py-4 text-sm">
      <div class="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 id="welcome-title" class="font-semibold">New here? Start from an example — nothing to upload, no account needed.</h2>
        <button type="button" class="rounded bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900" data-testid="welcome-tour" @click="takeTour">Take the tour ({{ stops.length }} stops)</button>
        <button type="button" class="text-zinc-600 underline dark:text-zinc-400" data-testid="welcome-dismiss" @click="answer">No thanks</button>
      </div>
      <ul class="grid gap-2 md:grid-cols-2 xl:grid-cols-4" data-testid="welcome-examples">
        <li v-for="example in examples" :key="example.id">
          <NuxtLink :to="`/examples/${example.id}`" class="block h-full rounded border border-amber-200 bg-white p-2 hover:border-amber-400 dark:border-amber-900 dark:bg-zinc-950" :data-testid="`welcome-example-${example.id}`" @click="answer">
            <span class="block font-medium">{{ example.title }}</span>
            <span class="block text-zinc-600 dark:text-zinc-400">{{ example.teaches }}</span>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </aside>
</template>
