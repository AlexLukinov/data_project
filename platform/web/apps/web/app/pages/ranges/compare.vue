<script setup lang="ts">
// The three-way comparison (spec §11.1, acceptance 7): my chart | solver range | pool range at
// one situation, three matrices, the diff heatmap and the biggest per-cell disagreements. The
// pool column is stubbed until F.8 delivers ranges at a node.
import type { ComboIndex, HandClass, NodeKey, WeightedRange } from '@poker/core';
import { HAND_CLASS_COMBOS, nodeKey, nodeKeyLabel, parseRange, step } from '@poker/core';
import { NodeKeyEditor, RangeDiffView, RangeDisagreementTable, RangeMatrix } from '@poker/ui';
import { computed, ref, watch } from 'vue';

import type { StoredRange } from '~/ranges/api';
import { useRangesStore } from '~/stores/ranges';

const store = useRangesStore();
const route = useRoute();
const key = ref<NodeKey>(nodeKey('UTG', { action_sequence: [step('UTG', 'raise')] }));
const picked = ref('');
const chosen = ref<Record<'own' | 'solver' | 'pool', string>>({ own: '', solver: '', pool: '' });
const highlight = ref<ComboIndex[] | null>(null);

await useAsyncData('ranges-for-compare', () => store.load(), { server: false });
const fromParam = typeof route.query.range === 'string' ? route.query.range : null;
if (fromParam !== null) {
  const range = await store.open(fromParam).catch(() => null);
  if (range !== null) key.value = range.node_key;
}

const { data: matches } = await useAsyncData('compare-lookup', () => store.lookup(key.value), { server: false, watch: [key] });

function column(source: 'own' | 'solver' | 'pool'): StoredRange[] {
  return (matches.value ?? []).filter((r) => r.source === source);
}
function current(source: 'own' | 'solver' | 'pool'): StoredRange | null {
  const list = column(source);
  return list.find((r) => r.id === chosen.value[source]) ?? list[0] ?? null;
}
function parsed(range: StoredRange | null, label: string): WeightedRange | null {
  return range === null ? null : { ...parseRange(range.weights).range, label };
}
const mine = computed(() => parsed(current('own'), 'My chart'));
const solver = computed(() => parsed(current('solver'), 'Solver'));
const pool = computed(() => parsed(current('pool'), 'Pool'));
const diffRanges = computed(() => [mine.value, solver.value, pool.value].filter((r): r is WeightedRange => r !== null).map((r) => ({ label: r.label ?? '', range: r })));

watch(picked, (id) => {
  const item = store.items.find((r) => r.id === id);
  if (item !== undefined) key.value = item.node_key;
});

function ring(cls: HandClass): void {
  highlight.value = [...HAND_CLASS_COMBOS[cls]!];
}
const COLUMNS = [
  { source: 'own', title: 'My chart' },
  { source: 'solver', title: 'Solver' },
  { source: 'pool', title: 'Pool' },
] as const;
</script>

<template>
  <section class="space-y-4">
    <div class="flex items-center gap-3">
      <NuxtLink to="/ranges" class="text-sm text-zinc-500 hover:underline">← library</NuxtLink>
      <h1 class="text-2xl font-semibold">Compare at a situation</h1>
    </div>
    <p v-if="store.status === 'offline'" role="status" class="text-sm text-amber-700 dark:text-amber-300">{{ store.error }}</p>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <NodeKeyEditor v-model="key" />
      </div>
      <label class="text-sm">pick a situation from the library
        <select v-model="picked" data-testid="compare-pick" class="mt-1 w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
          <option value="">—</option>
          <option v-for="r in store.items" :key="r.id" :value="r.id">{{ nodeKeyLabel(r.node_key) }} · {{ r.name }}</option>
        </select>
      </label>
    </div>

    <div class="grid gap-6 md:grid-cols-3" data-testid="compare-columns">
      <div v-for="c in COLUMNS" :key="c.source" class="space-y-2">
        <h2 class="font-medium">{{ c.title }}</h2>
        <select v-if="column(c.source).length > 1" :value="current(c.source)?.id" class="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" :aria-label="`${c.title} range`" @change="chosen[c.source] = ($event.target as HTMLSelectElement).value">
          <option v-for="r in column(c.source)" :key="r.id" :value="r.id">{{ r.name }} (v{{ r.version }})</option>
        </select>
        <template v-if="current(c.source)">
          <RangeMatrix :range="(c.source === 'own' ? mine : c.source === 'solver' ? solver : pool)!" mode="view" :highlight-combos="highlight" @cell-click="ring" />
          <p class="text-xs text-zinc-500" :data-testid="`compare-${c.source}-name`">{{ current(c.source)!.name }} · v{{ current(c.source)!.version }}<span v-if="current(c.source)!.source_tool"> · {{ current(c.source)!.source_tool }}</span></p>
        </template>
        <p v-else-if="c.source === 'pool'" class="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700" data-testid="compare-pool-empty">
          Insufficient data — the pool's range at a node arrives with the pool integration (plan F.8).
        </p>
        <p v-else class="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700" :data-testid="`compare-${c.source}-empty`">
          No {{ c.source === 'own' ? 'chart of yours' : 'solver range' }} stored at this situation.
        </p>
      </div>
    </div>

    <div v-if="diffRanges.length >= 2" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" data-testid="compare-diff">
      <RangeDiffView :ranges="diffRanges" @cell-click="ring" />
      <div v-if="mine && solver">
        <h2 class="mb-2 font-medium">Biggest disagreements</h2>
        <RangeDisagreementTable :a="mine" :b="solver" a-label="Mine" b-label="Solver" @cell-click="ring" />
      </div>
    </div>
  </section>
</template>
