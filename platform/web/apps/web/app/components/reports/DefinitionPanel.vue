<script setup lang="ts">
/**
 * What a column actually counts (plan D.5).
 *
 * The registry ships each stat's real definition — `situation` + `action`, or an expression over
 * `count`/`sum`/`countIf` — so this panel is generated from the same document the SQL is compiled
 * from, and cannot drift from it. That is the whole point: a number the founder will bet money on
 * should be able to say what it counted, in the same words the filter uses for the same condition.
 *
 * The wording is `reports/describe.ts`, unit-tested; this is the rendering.
 */
import { computed } from 'vue';

import { describeDimension, describeStat } from '~/reports/describe';
import type { Dimension, Stat } from '~/stats/api';

const props = defineProps<{
  stat: Stat | undefined;
  dimension: Dimension | undefined;
  dimensions: ReadonlyMap<string, Dimension>;
}>();

const emit = defineEmits<{ close: [] }>();

const lines = computed(() => {
  if (props.stat !== undefined) return describeStat(props.stat, props.dimensions);
  return props.dimension === undefined ? [] : describeDimension(props.dimension);
});

const title = computed(() => props.stat?.label ?? props.dimension?.label ?? '');
const subtitle = computed(() => props.stat?.description ?? '');
</script>

<template>
  <section v-if="lines.length" class="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="definition-panel">
    <div class="flex items-baseline gap-2">
      <h2 class="font-medium" data-testid="definition-title">{{ title }}</h2>
      <code class="text-xs text-zinc-500">{{ stat?.code ?? dimension?.code }}</code>
      <button type="button" data-testid="definition-close" class="ml-auto rounded px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" aria-label="close the definition" @click="emit('close')">×</button>
    </div>

    <p v-if="subtitle" class="text-sm" data-testid="definition-description">{{ subtitle }}</p>

    <dl class="grid gap-x-3 gap-y-1 text-sm" style="grid-template-columns: max-content minmax(0, 1fr)">
      <template v-for="line in lines" :key="line.term">
        <dt class="text-xs text-zinc-500">{{ line.term }}</dt>
        <dd :data-testid="`definition-${line.term.toLowerCase().replace(' ', '-')}`">{{ line.detail }}</dd>
      </template>
    </dl>
  </section>
</template>
