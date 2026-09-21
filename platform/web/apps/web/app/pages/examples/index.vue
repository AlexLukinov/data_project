<script setup lang="ts">
// The permanent Examples section (spec §13, ADR-050): worked spots that open in the analyzer's own
// steps with nothing uploaded and no account, and keep nothing.
import { nodeKeyLabel } from '@poker/core';

import { EXAMPLES } from '~/help/examples';

definePageMeta({ public: true }); // an example needs no backend and no account (ADR-050)
</script>

<template>
  <section class="space-y-4">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Examples</h1>
      <p class="text-sm text-zinc-500">
        The same two ranges — the button opens, the big blind calls — on three flops. Each one opens all nine of the
        analyzer's steps on a spot that is already set up: commit your answer, then see what is true. The four steps that
        read your pool say so instead, because an example has no pool. Nothing is uploaded, and nothing you do in an
        example is saved.
      </p>
    </div>

    <ul class="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="examples-list">
      <li v-for="example in EXAMPLES" :key="example.id" class="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <NuxtLink :to="`/examples/${example.id}`" class="block space-y-2" :data-testid="`example-${example.id}`">
          <h2 class="font-medium">{{ example.title }}</h2>
          <p class="text-sm text-zinc-600 dark:text-zinc-400">{{ example.teaches }}</p>
          <p class="text-xs text-zinc-500">{{ nodeKeyLabel(example.node) }}</p>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
