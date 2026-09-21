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
 *
 * **Why it brings itself to the reader** (plan F.12, spec §13 "fast feedback"). Every one of the
 * four pages that mounts this panel — `/reports`, `/pool`, `/pool/players`, `/pool/cohorts` —
 * renders it between the pickers and the grid, and the grid's own column headings open it. Click
 * one from a grid twenty rows down and the panel opens somewhere above the fold: the page answers,
 * and the answer is off screen, which reads exactly like a control that does nothing. No single
 * position fixes both callers — below the grid would put it off screen for the pickers instead —
 * so the panel scrolls itself just into view and takes focus, which is also how a keyboard or
 * screen-reader user learns that anything happened at all.
 */
import { computed, nextTick, ref, watch } from 'vue';

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

const panel = ref<HTMLElement | null>(null);

/**
 * `block: 'nearest'` scrolls the least that will do and does nothing at all when the panel is
 * already on screen, so a reader clicking a second column heading beside the first is not thrown
 * about. Instant rather than smooth: this is a jump to an answer, not an animation, and smooth
 * scrolling ignores `prefers-reduced-motion` in more than one browser.
 */
watch(
  // The whole subject, not the object: a stat and a dimension never share a code, and both are
  // `undefined` between one heading closing and the next opening.
  () => `${props.stat?.code ?? ''}·${props.dimension?.code ?? ''}`,
  async (subject) => {
    if (subject === '·') return;
    await nextTick();
    const element = panel.value;
    if (element === null) return;
    // Guarded: `scrollIntoView` is absent in the test environment's DOM, and a panel that cannot
    // scroll must still open and still take focus.
    element.scrollIntoView?.({ block: 'nearest' });
    element.focus();
  },
  { immediate: true },
);
</script>

<template>
  <section v-if="lines.length" ref="panel" tabindex="-1" class="space-y-2 rounded-lg border border-zinc-200 p-3 outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-800" data-testid="definition-panel">
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
