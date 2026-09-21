<script setup lang="ts">
/**
 * One tool of the catalogue, read out in full (plan F.13, ADR-058).
 *
 * The same component on `/help` and inside the per-page explainer, so the answer to "what is
 * this" is a single rendering of a single entry — there is no second wording to drift.
 *
 * It is presentation only: it takes a `Tool` and renders it. Nothing is fetched, so it is correct
 * with the API stopped, and it is the reason `/help` works signed out.
 */
import { computed } from 'vue';

import { exampleById } from '~/help/examples';
import type { Tool } from '~/help/tools';
import { linkFor, toolById } from '~/help/tools';

const props = defineProps<{ tool: Tool; headingLevel?: 2 | 3 }>();

const heading = computed(() => `h${props.headingLevel ?? 3}` as const);
const example = computed(() => exampleById(props.tool.example));
const related = computed(() =>
  props.tool.related.map(toolById).filter((tool): tool is Tool => tool !== null),
);
</script>

<template>
  <div class="space-y-3 text-sm" :data-testid="`tool-card-${tool.id}`">
    <component :is="heading" class="font-semibold">
      <NuxtLink :to="linkFor(tool.route)" class="underline underline-offset-2" :data-testid="`tool-link-${tool.id}`">{{ tool.name }}</NuxtLink>
      <span v-if="tool.account === 'required'" class="ml-2 rounded border border-zinc-300 px-1 text-[0.65rem] font-normal uppercase tracking-wide text-zinc-500 dark:border-zinc-700" :data-testid="`tool-signin-${tool.id}`">sign in</span>
    </component>
    <p class="text-zinc-700 dark:text-zinc-300" :data-testid="`tool-what-${tool.id}`">{{ tool.what }}</p>

    <section class="space-y-1">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">How it works</h4>
      <p v-for="line in tool.how" :key="line" class="text-zinc-700 dark:text-zinc-300" :data-testid="`tool-how-${tool.id}`">{{ line }}</p>
    </section>

    <section class="space-y-1">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">How to use it</h4>
      <ol class="list-decimal space-y-0.5 pl-5 text-zinc-700 dark:text-zinc-300" :data-testid="`tool-steps-${tool.id}`">
        <li v-for="step in tool.steps" :key="step">{{ step }}</li>
      </ol>
    </section>

    <section v-if="tool.needs.length" class="space-y-1">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">What it needs first</h4>
      <ul class="list-disc space-y-0.5 pl-5 text-zinc-700 dark:text-zinc-300" :data-testid="`tool-needs-${tool.id}`">
        <li v-for="need in tool.needs" :key="need">{{ need }}</li>
      </ul>
    </section>

    <section class="space-y-1">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">What it does not do</h4>
      <ul class="list-disc space-y-0.5 pl-5 text-zinc-600 dark:text-zinc-400" :data-testid="`tool-limits-${tool.id}`">
        <li v-for="limit in tool.limits" :key="limit">{{ limit }}</li>
      </ul>
    </section>

    <p v-if="example" class="text-zinc-600 dark:text-zinc-400">
      See it worked through:
      <NuxtLink :to="`/examples/${example.id}`" class="underline underline-offset-2" :data-testid="`tool-example-${tool.id}`">{{ example.title }}</NuxtLink>
    </p>

    <p v-if="related.length" class="text-zinc-600 dark:text-zinc-400" :data-testid="`tool-related-${tool.id}`">
      Related:
      <template v-for="(other, index) in related" :key="other.id">
        <NuxtLink :to="linkFor(other.route)" class="underline underline-offset-2">{{ other.name }}</NuxtLink><span v-if="index < related.length - 1">, </span>
      </template>
    </p>
  </div>
</template>
