<script setup lang="ts">
// The three-way comparison (spec §11.1, acceptance 7): my chart | solver range | pool range at
// one situation, three matrices, the diff heatmap and the biggest per-cell disagreements. The
// pool column is the field's own showdown range at this node (plan F.8), gated on `min_n`.
import type { ComboIndex, HandClass, NodeKey, WeightedRange } from '@poker/core';
import { HAND_CLASS_COMBOS, nodeKey, nodeKeyLabel, parseRange, step } from '@poker/core';
import { EstimatedRangePanel, NodeKeyEditor, PoolDataBadge, RangeDiffView, RangeDisagreementTable, RangeMatrix } from '@poker/ui';
import { computed, ref, watch } from 'vue';

import { createPoolApi } from '~/pool/api';
import { estimateAt, movers, reweight } from '~/pool/estimate';
import { poolRange } from '~/pool/range';
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

// The pool column is not a stored range: it is what the field showed down at this node.
const poolApi = createPoolApi(useApi());
const { data: shown } = await useAsyncData('compare-pool', () => poolApi.showdownRange(key.value).catch(() => null), { server: false, watch: [key] });
const poolFromServer = computed(() => (shown.value?.enough ? poolRange(shown.value.classes, 'Pool') : null));

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
const showdown = computed(() => poolFromServer.value ?? parsed(current('pool'), 'Pool'));

/**
 * Tier 3 (plan F.10). A reconstruction needs a range to start from, so it runs only once a
 * chart of mine is on screen — and it replaces the showdown column when it lands, because a
 * prior reweighted by the field beats the field's shown hands read as a range (spec §10.3).
 */
const MOVERS = 10;
const estimated = ref<Awaited<ReturnType<typeof estimateAt>>>(null);

watch(
  [mine, key],
  async ([prior, at]) => {
    estimated.value = prior === null ? null : await estimateAt(poolApi, at, prior);
  },
  { immediate: true },
);

const reconstructed = computed(() => {
  const answer = estimated.value;
  return answer?.enough && mine.value ? reweight(mine.value, answer.classes, 'Pool estimate') : null;
});
const topMovers = computed(() => (estimated.value === null ? [] : movers(estimated.value, MOVERS)));
const measured = computed(() => (estimated.value?.classes ?? []).filter((c) => !c.fallback).length);
const pool = computed(() => reconstructed.value ?? showdown.value);
const poolTier = computed<1 | 2 | 3>(() => (reconstructed.value === null ? 2 : 3));
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
        <template v-if="c.source === 'pool' && pool">
          <RangeMatrix :range="pool" mode="view" :highlight-combos="highlight" @cell-click="ring" />
          <PoolDataBadge
            v-if="estimated?.enough"
            :tier="3"
            :sample-size="estimated.sample_size"
            :enough="true"
            :min-n="estimated.min_n"
            :covers="estimated.covers"
          />
          <PoolDataBadge v-else-if="shown" :tier="poolTier" :sample-size="shown.sample_size" :enough="shown.enough" :min-n="shown.min_n" :covers="shown.covers" />
        </template>
        <template v-else-if="c.source !== 'pool' && current(c.source)">
          <RangeMatrix :range="(c.source === 'own' ? mine : solver)!" mode="view" :highlight-combos="highlight" @cell-click="ring" />
          <p class="text-xs text-zinc-500" :data-testid="`compare-${c.source}-name`">{{ current(c.source)!.name }} · v{{ current(c.source)!.version }}<span v-if="current(c.source)!.source_tool"> · {{ current(c.source)!.source_tool }}</span></p>
        </template>
        <div v-else-if="c.source === 'pool'" class="space-y-2 rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700" data-testid="compare-pool-empty">
          <p>Insufficient data: the pool has not shown down enough hands at this situation.</p>
          <PoolDataBadge v-if="shown" :tier="2" :sample-size="shown.sample_size" :enough="false" :min-n="shown.min_n" />
        </div>
        <p v-else class="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700" :data-testid="`compare-${c.source}-empty`">
          No {{ c.source === 'own' ? 'chart of yours' : 'solver range' }} stored at this situation.
        </p>
      </div>
    </div>

    <section v-if="estimated" class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="compare-tier3">
      <h2 class="mb-2 font-medium">What the field does with your range here</h2>
      <EstimatedRangePanel
        v-if="estimated.enough"
        :action="estimated.action"
        :observed="estimated.observed_frequency"
        :implied="estimated.implied_frequency"
        :classes="topMovers"
        :measured="measured"
        :total="estimated.classes.length"
        :min-bucket-n="estimated.min_bucket_n"
      />
      <p v-else class="text-sm text-zinc-500" data-testid="compare-tier3-thin">
        The pool has played this situation {{ estimated.sample_size.toLocaleString('en-US') }} times, under the
        {{ estimated.min_n }} a reconstruction needs. The Pool column is the showdown range, unreweighted.
      </p>
    </section>

    <div v-if="diffRanges.length >= 2" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" data-testid="compare-diff">
      <RangeDiffView :ranges="diffRanges" @cell-click="ring" />
      <div v-if="mine && solver">
        <h2 class="mb-2 font-medium">Biggest disagreements</h2>
        <RangeDisagreementTable :a="mine" :b="solver" a-label="Mine" b-label="Solver" @cell-click="ring" />
      </div>
    </div>
  </section>
</template>
