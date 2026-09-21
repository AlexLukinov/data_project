<script setup lang="ts">
// The three-way comparison (spec §11.1, acceptance 7): my chart | solver range | pool range at
// one situation, three matrices, the diff heatmap and the biggest per-cell disagreements. The
// pool column is the field's own showdown range at this node (plan F.8), gated on `min_n`.
import type { ComboIndex, HandClass, NodeKey, WeightedRange } from '@poker/core';
import { HAND_CLASS_COMBOS, nodeKey, nodeKeyLabel, parseRange, step } from '@poker/core';
import { EstimatedRangePanel, NodeKeyEditor, PoolDataBadge, RangeDiffView, RangeDisagreementTable, RangeMatrix } from '@poker/ui';
import { computed, ref, watch } from 'vue';

import { describeApiError } from '~/auth/api';
import EmptyState from '~/components/reports/EmptyState.vue';
import { LIBRARY_UNREADABLE } from '~/hands/study';
import { createPoolApi } from '~/pool/api';
import { estimateAt, movers, reweight } from '~/pool/estimate';
import { poolRange } from '~/pool/range';
import type { StoredRange } from '~/ranges/api';
import type { ColumnSource, ColumnView } from '~/ranges/compareColumn';
import { columnView } from '~/ranges/compareColumn';
import { LIBRARY_EMPTY, POOL_THIN, POOL_UNASKED, compareEmptyView, tier3Problem } from '~/ranges/compareEmpty';
import { openLinkedSituation } from '~/ranges/situation';
import type { EmptyStateView } from '~/reports/emptyState';
import { useRangesStore } from '~/stores/ranges';

const store = useRangesStore();
const route = useRoute();
const key = ref<NodeKey>(nodeKey('UTG', { action_sequence: [step('UTG', 'raise')] }));
const picked = ref('');
const chosen = ref<Record<'own' | 'solver' | 'pool', string>>({ own: '', solver: '', pool: '' });
const highlight = ref<ComboIndex[] | null>(null);

// `store.load()` answers from this browser's own copy whenever the API is away, so the one failure
// that reaches here is that copy refusing as well — and it leaves the picker below empty with the
// store still on 'loading', which says nothing at all unless this error is read.
//
// **`lazy: true` is the whole of F.12's "fast feedback" on this page** (audit §2.11). Awaited
// without it, `<Suspense>` holds the *entire* page — heading, situation editor, all three columns —
// until the library answers, so a slow or absent API renders a blank screen with nothing to read
// and nothing to do. Lazy, the page paints at once and each part says what it is waiting for: the
// picker below, and the three columns through `view()`, which already has a `'loading'` branch.
// This is the trap F.12a documented and this page was the one left holding it.
const { error: libraryError } = await useAsyncData('ranges-for-compare', () => store.load(), { server: false, lazy: true });
// A link names the situation (`?node=`, the replayer's) or a stored range whose situation it is
// (`?range=`, the editor's). One that cannot be read opens the default and says why on the page.
const linked = await openLinkedSituation(route.query, (id) => store.open(id));
if (linked.key !== null) key.value = linked.key;

const { data: matches, status: lookupStatus, error: lookupError } = await useAsyncData('compare-lookup', () => store.lookup(key.value), { server: false, lazy: true, watch: [key] });

// The pool column is not a stored range: it is what the field showed down at this node. A failed
// call is an error on screen, never "insufficient data" — that is an answer, and there was none.
const poolApi = createPoolApi(useApi());
const { data: shown, status: poolStatus, error: poolError } = await useAsyncData('compare-pool', () => poolApi.showdownRange(key.value), { server: false, lazy: true, watch: [key] });
const poolFromServer = computed(() => (shown.value?.enough ? poolRange(shown.value.classes, 'Pool') : null));

/**
 * A column's answer for the situation on screen is still on its way; what it showed before was for
 * another. Both lookups are lazy, so the page renders — and says so — while the first one runs.
 */
function waiting(source: ColumnSource): boolean {
  return (source === 'pool' ? poolStatus.value : lookupStatus.value) === 'pending';
}
/** Nothing on the page is left over from the previous situation. */
const settled = computed(() => !waiting('own') && !waiting('pool'));

function column(source: ColumnSource): StoredRange[] {
  return (matches.value ?? []).filter((r) => r.source === source);
}
function current(source: ColumnSource): StoredRange | null {
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
/**
 * A failed ask, in words. Without it the tier-3 section simply vanishes and the Pool column goes
 * back to the showdown range, which looks exactly like having no chart of mine to reconstruct.
 */
const estimateProblem = ref('');
let estimates = 0;

// Only once the lookup has settled, so the prior is this situation's chart, and only the latest
// answer is kept: a reconstruction for the previous situation must not land on this one.
watch(
  [mine, key, lookupStatus],
  async ([prior, at, status]) => {
    const asked = ++estimates;
    estimated.value = null;
    estimateProblem.value = '';
    if (prior === null || status === 'pending') return;
    try {
      const answer = await estimateAt(poolApi, at, prior);
      if (asked === estimates) estimated.value = answer;
    } catch (error) {
      // `showdown` decides the tail: with the showdown call refused alongside this one there is no
      // range in the Pool column to send the reader to.
      if (asked === estimates) estimateProblem.value = tier3Problem(describeApiError(error), showdown.value !== null);
    }
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
/**
 * The Pool column is drawing a chart out of your own library while the pool itself went unasked.
 * `columnView` prefers a range to an error, so a stored `pool` range fills the column when the
 * showdown call fails — with no badge, since there is no answer to badge — and a chart somebody
 * saved reads as what the field showed down. Tier 3's reconstruction is a different thing and says
 * so in its own badge, which is why it is excluded here.
 */
const storedPoolShown = computed(() => Boolean(poolError.value) && reconstructed.value === null && poolFromServer.value === null && showdown.value !== null);
const diffRanges = computed(() => [mine.value, solver.value, pool.value].filter((r): r is WeightedRange => r !== null).map((r) => ({ label: r.label ?? '', range: r })));

watch(picked, (id) => {
  const item = store.items.find((r) => r.id === id);
  if (item !== undefined) key.value = item.node_key;
});

function view(source: ColumnSource): ColumnView {
  const pooled = source === 'pool';
  // Without the server's showdown range the pool column draws a stored one, which is the lookup's to give.
  const poolStatusNow = lookupStatus.value === 'pending' && poolFromServer.value === null ? 'pending' : poolStatus.value;
  return columnView({
    source,
    status: pooled ? poolStatusNow : lookupStatus.value,
    failed: Boolean(pooled ? poolError.value : lookupError.value),
    hasRange: pooled ? pool.value !== null : current(source) !== null,
    answered: shown.value !== undefined && shown.value !== null,
  });
}

/**
 * What a library column with nothing in it says. Only `solver` has words of its own: the pool
 * column never reaches this branch — `columnView` answers it with `insufficient` or `unasked` —
 * and `own` is what is left. The offline copy answering is its own sentence, because an empty
 * answer from it means "not in this browser", not "not stored".
 */
function emptyView(source: ColumnSource): EmptyStateView {
  return compareEmptyView({ source: source === 'solver' ? 'solver' : 'own', situation: nodeKeyLabel(key.value), offline: store.status === 'offline' });
}

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
    <p v-if="linked.problem" role="status" class="text-sm text-amber-700 dark:text-amber-300" data-testid="compare-link-problem">{{ linked.problem }}</p>
    <p v-if="libraryError" role="alert" class="text-sm text-red-700 dark:text-red-400" data-testid="compare-library-error">{{ LIBRARY_UNREADABLE }} {{ describeApiError(libraryError) }}</p>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <NodeKeyEditor v-model="key" />
      </div>
      <div class="space-y-2">
        <label class="block text-sm">pick a situation from the library
          <select v-model="picked" data-testid="compare-pick" class="mt-1 w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            <option value="">—</option>
            <option v-for="r in store.items" :key="r.id" :value="r.id">{{ nodeKeyLabel(r.node_key) }} · {{ r.name }}</option>
          </select>
        </label>
        <!-- The picker is empty both while the library is being read and when there is none of it;
             the two must not look alike, which is what the non-lazy await used to hide. -->
        <p v-if="store.status === 'idle' || store.status === 'loading'" role="status" class="text-xs text-zinc-500" data-testid="compare-library-loading">Reading your range library…</p>
        <EmptyState v-else-if="store.status === 'ready' && store.items.length === 0" :view="LIBRARY_EMPTY" testid="compare-library-empty" class="rounded border border-dashed border-zinc-300 p-3 dark:border-zinc-700" />
      </div>
    </div>

    <div class="grid gap-6 md:grid-cols-3" data-testid="compare-columns">
      <div v-for="c in COLUMNS" :key="c.source" class="space-y-2">
        <h2 class="font-medium">{{ c.title }}</h2>
        <select v-if="view(c.source) === 'range' && column(c.source).length > 1" :value="current(c.source)?.id" class="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" :aria-label="`${c.title} range`" @change="chosen[c.source] = ($event.target as HTMLSelectElement).value">
          <option v-for="r in column(c.source)" :key="r.id" :value="r.id">{{ r.name }} (v{{ r.version }})</option>
        </select>
        <p v-if="view(c.source) === 'loading'" role="status" class="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700" :data-testid="`compare-${c.source}-loading`">
          {{ c.source === 'pool' ? 'Asking the pool what it showed down here…' : 'Looking in your range library…' }}
        </p>
        <p v-else-if="view(c.source) === 'error' && c.source === 'pool'" role="alert" class="rounded border border-dashed border-red-300 p-4 text-sm text-red-700 dark:border-red-800 dark:text-red-400" data-testid="compare-pool-error">
          The pool could not be asked about this situation. {{ describeApiError(poolError) }}
        </p>
        <p v-else-if="view(c.source) === 'error'" role="alert" class="rounded border border-dashed border-red-300 p-4 text-sm text-red-700 dark:border-red-800 dark:text-red-400" :data-testid="`compare-${c.source}-error`">
          {{ LIBRARY_UNREADABLE }} {{ describeApiError(lookupError) }}
        </p>
        <template v-else-if="view(c.source) === 'range' && c.source === 'pool' && pool">
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
          <p v-if="storedPoolShown" role="alert" class="text-xs text-red-700 dark:text-red-400" data-testid="compare-pool-stored-note">
            The pool could not be asked what it showed down here. {{ describeApiError(poolError) }} This chart is the pool range stored in your own library, not the field's.
          </p>
        </template>
        <template v-else-if="view(c.source) === 'range' && c.source !== 'pool' && current(c.source)">
          <RangeMatrix :range="(c.source === 'own' ? mine : solver)!" mode="view" :highlight-combos="highlight" @cell-click="ring" />
          <p class="text-xs text-zinc-500" :data-testid="`compare-${c.source}-name`">{{ current(c.source)!.name }} · v{{ current(c.source)!.version }}<span v-if="current(c.source)!.source_tool"> · {{ current(c.source)!.source_tool }}</span></p>
        </template>
        <div v-else-if="view(c.source) === 'insufficient' && shown" class="space-y-2 rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700" data-testid="compare-pool-empty">
          <p>{{ POOL_THIN }}</p>
          <PoolDataBadge :tier="2" :sample-size="shown.sample_size" :enough="false" :min-n="shown.min_n" />
        </div>
        <p v-else-if="view(c.source) === 'unasked'" class="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700" data-testid="compare-pool-unasked">
          {{ POOL_UNASKED }}
        </p>
        <EmptyState v-else :view="emptyView(c.source)" :testid="`compare-${c.source}-empty`" class="rounded border border-dashed border-zinc-300 p-4 dark:border-zinc-700" />
      </div>
    </div>

    <p v-if="estimateProblem" role="alert" class="rounded border border-dashed border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400" data-testid="compare-tier3-error">
      {{ estimateProblem }}
    </p>

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

    <div v-if="settled && diffRanges.length >= 2" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" data-testid="compare-diff">
      <RangeDiffView :ranges="diffRanges" @cell-click="ring" />
      <div v-if="mine && solver">
        <h2 class="mb-2 font-medium">Biggest disagreements</h2>
        <RangeDisagreementTable :a="mine" :b="solver" a-label="Mine" b-label="Solver" @cell-click="ring" />
      </div>
    </div>
  </section>
</template>
