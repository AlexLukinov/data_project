<script setup lang="ts">
// One hand, stepped through, with every panel bound to the node the hand is currently at
// (spec §9.3). The panels ask the range library what is written down for this situation and for
// what the other seat just did, so stepping forward walks both the hand and my own charts.
import type { EquityResult, HandState, NodeKey, ReplayHand, WeightedRange } from '@poker/core';
import { canonicalNodeKey, nodeKeyLabel, parseCards, parseRange } from '@poker/core';
import { ComboDistributionPanel, EQRPanel, EquityCalculator, HandReplayer, MDFPanel, PoolDataBadge, PoolRealizationPanel, PotOddsPanel, RangeMatrix, poolEqr } from '@poker/ui';
import { computed, ref } from 'vue';

import { createAnalysesApi } from '~/analyze/api';
import type { NodeRanges } from '~/hands/panels';
import { NO_RANGES, createNodeRangeReader } from '~/hands/panels';
import type { NodeFrequencies, NodeRealization } from '~/pool/api';
import { createPoolApi } from '~/pool/api';
import { classEquity } from '~/pool/estimate';
import { useRangesStore } from '~/stores/ranges';

const props = defineProps<{ hand: ReplayHand; watchSeat?: number | null; handText?: string }>();

const store = useRangesStore();
const { service } = useEquityService();
const reader = createNodeRangeReader((key) => store.lookup(key));
const poolApi = createPoolApi(useApi());
const analysesApi = createAnalysesApi(useApi());

const step = ref(0);
const node = ref<NodeKey | null>(null);
const state = ref<HandState | null>(null);
const ranges = ref<NodeRanges>(NO_RANGES);
const pool = ref<NodeFrequencies | null>(null);
const realized = ref<NodeRealization | null>(null);
const equity = ref<EquityResult | null>(null);

async function onNode(next: NodeKey | null, at: HandState): Promise<void> {
  node.value = next;
  state.value = at;
  pool.value = null;
  realized.value = null;
  equity.value = null;
  const [found] = await Promise.all([reader.at(props.hand, at.index), askThePool(next)]);
  ranges.value = found;
}

/**
 * What the field does here (tier 1). A silent API leaves the panel empty, never wrong.
 *
 * The answer is kept only while it is still the answer to the question on screen — compared by
 * the situation itself, not by object identity, because `node.value` hands back a reactive
 * proxy that never equals the key that was asked about.
 */
let asked = '';

async function askThePool(key: NodeKey | null): Promise<void> {
  if (key === null) return;
  const id = canonicalNodeKey(key);
  asked = id;
  const [answer, won] = await Promise.all([
    poolApi.frequencies(key).catch(() => null),
    // Empirical EQR (plan F.10) needs `invested_bb`, so this is silent until the mart is
    // rebuilt with it — the same rule as the rest: an unanswerable question shows nothing.
    poolApi.realization(key).catch(() => null),
  ]);
  if (asked !== id) return;
  pool.value = answer;
  realized.value = won;
}

const poolActions = computed(() => Object.entries(pool.value?.frequencies ?? {}).sort((a, b) => b[1] - a[1]));

/**
 * Equity per 169-combo class, for the EQR column: the engine's own per-combo answer for MY
 * range against villain's, averaged inside each class. A class I do not hold has no equity here
 * and its EQR stays blank rather than borrowing one.
 */
const classEquities = computed(() => (equity.value === null ? null : classEquity(equity.value.perComboEquity)));
const REALIZATION_ROWS = 8;
const realizationRows = computed(() => (realized.value?.by_hand_class ?? []).slice(0, REALIZATION_ROWS));

/**
 * The pool's EQR beside a solver's, which is spec §10.4's whole point: the field's own
 * realization at this node, next to the one you typed in from a solution. It needs both halves
 * — the pool's `realized` and an equity from our engine — so it stays empty until the equity
 * lands (`poolEqr` returns null rather than inventing one).
 */
const solverEv = ref<number | null>(null);
const poolRealized = computed(() => {
  const overall = realized.value?.overall ?? null;
  const eqr = poolEqr(overall?.realized ?? null, equity.value?.heroEquity ?? null);
  return eqr === null || overall === null ? null : { eqr, sampleSize: overall.sample_size };
});

const board = computed(() => parseCards((state.value?.board ?? []).join(' ')));
const toCall = computed(() => state.value?.toCall ?? 0);
const potBefore = computed(() => Math.max(0, (state.value?.pot ?? 0) - toCall.value));

function body(range: NodeRanges['mine']): WeightedRange | null {
  return range === null ? null : { ...parseRange(range.weights).range, label: range.name };
}

const mine = computed(() => body(ranges.value.mine));
const villain = computed(() => body(ranges.value.villain));
const both = computed<WeightedRange[]>(() => (mine.value !== null && villain.value !== null ? [mine.value, villain.value] : []));
const watched = computed(() => props.hand.seats.find((s) => s.seat === props.watchSeat) ?? props.hand.seats.find((s) => s.isHero) ?? null);

/**
 * Take this exact situation into the 9-step analyzer (spec §15). A pasted hand carries its own
 * text, because nothing on the server has stored it (ADR-029) and the analysis must reopen.
 */
const starting = ref(false);

async function analyzeThisNode(): Promise<void> {
  const key = node.value;
  if (key === null || starting.value) return;
  starting.value = true;
  try {
    const stored = props.hand.handUid !== '';
    const created = await analysesApi.create({
      title: `${nodeKeyLabel(key)} · ${props.hand.playedAt.slice(0, 10)}`,
      source: stored ? 'stored' : 'pasted',
      hand_uid: stored ? props.hand.handUid : '',
      hand_text: stored ? '' : (props.handText ?? ''),
      node_key: key,
      action_index: state.value?.index ?? 0,
    });
    await navigateTo(`/analyze/${created.id}`);
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <HandReplayer v-model="step" :hand="hand" @node-change="onNode" />

    <section class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div class="flex flex-wrap items-baseline gap-2">
          <h2 class="font-medium">Situation</h2>
          <span class="text-sm text-zinc-500" data-testid="study-node">{{ node ? nodeKeyLabel(node) : 'before the first decision' }}</span>
          <NuxtLink v-if="node" :to="`/ranges/compare?hero=${node.hero_position}&street=${node.street}`" class="ml-auto text-sm underline">Compare here</NuxtLink>
          <button v-if="node" type="button" class="rounded border border-zinc-300 px-2 py-0.5 text-sm dark:border-zinc-700" data-testid="study-analyze" :disabled="starting" @click="analyzeThisNode">Analyze this node</button>
        </div>
        <p v-if="watched" class="text-sm text-zinc-500" data-testid="study-watching">Watching {{ watched.position }} {{ watched.name }}<span v-if="watched.cards.length"> with {{ watched.cards.join(' ') }}</span></p>

        <div v-if="pool" class="space-y-1" data-testid="study-pool">
          <p v-if="pool.enough" class="flex flex-wrap gap-x-3 text-sm">
            <span v-for="[action, share] in poolActions" :key="action" class="tabular-nums" :data-testid="`study-pool-${action}`">
              <span class="text-zinc-500">{{ action }}</span> {{ (share * 100).toFixed(1) }}%
            </span>
          </p>
          <p v-else class="text-sm text-zinc-500">The pool has not played this situation often enough to show frequencies.</p>
          <PoolDataBadge :tier="1" :sample-size="pool.sample_size" :enough="pool.enough" :min-n="pool.min_n" />
        </div>

        <div v-if="mine">
          <p class="mb-1 text-sm">My chart here: <span class="font-medium" data-testid="study-my-range">{{ ranges.mine?.name }}</span></p>
          <RangeMatrix :range="mine" mode="view" :blocked-cards="board" />
        </div>
        <p v-else class="text-sm text-zinc-500" data-testid="study-no-range">
          Nothing stored for this situation.
          <NuxtLink to="/ranges/import" class="underline">Import your charts</NuxtLink> and they will show up here as you step.
        </p>
      </div>

      <div class="space-y-4">
        <div v-if="toCall > 0" class="space-y-4">
          <PotOddsPanel :pot="potBefore" :bet="toCall" :call="toCall" data-testid="study-pot-odds" />
          <MDFPanel :pot="potBefore" :bet="toCall" :range="mine" />
        </div>
        <p v-else class="text-sm text-zinc-500" data-testid="study-nothing-faced">Nothing to call at this step — pot odds and MDF appear when there is a bet in front.</p>

        <ComboDistributionPanel v-if="mine" :range="mine" :board="board" :group-by="['made', 'draw']" />
        <EquityCalculator v-if="both.length === 2" :ranges="both" :board="board" :service="service" @result="equity = $event" />
        <p v-else-if="mine && ranges.villainNode" class="text-sm text-zinc-500" data-testid="study-no-villain-range">
          No stored range for {{ nodeKeyLabel(ranges.villainNode) }}, so there is nothing to run the equity against yet.
        </p>

        <p v-if="realized?.needs_rebuild" class="text-sm text-zinc-500" data-testid="study-eqr-rebuild">
          Empirical EQR needs <code>invested_bb</code> on <code>marts.decisions</code>; the mart gains it
          on the next chain rebuild (POKER_PLAN.md F.10).
        </p>
        <div v-else-if="realized?.enough" class="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="study-realization">
          <h2 class="font-medium">What the field won from here</h2>
          <EQRPanel
            v-if="equity && potBefore > 0"
            :equity="equity.heroEquity"
            :pot="potBefore"
            :ev="solverEv"
            :pool-eqr="poolRealized"
            @update:ev="solverEv = $event"
          />
          <PoolRealizationPanel
            :action="realized.action"
            :overall="realized.overall"
            :rows="realizationRows"
            :covers="realized.covers"
            :min-bucket-n="realized.min_bucket_n"
            :equity="classEquities"
            :overall-equity="equity?.heroEquity ?? null"
          />
        </div>
      </div>
    </section>
  </div>
</template>
