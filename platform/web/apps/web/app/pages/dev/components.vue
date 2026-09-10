<script setup lang="ts">
// Every @poker/ui component in isolation with fixture props (ADR-024: reviewed on a fixture page).
import type { Card, ComboIndex, EquityResult, HandClass, NodeKey, RakeConfig, WeightedRange } from '@poker/core';
import { equityBuckets, nodeKey, nodeKeyLabel, parseCards, parseCombo, parseRange, replayStates, step } from '@poker/core';
import { BlockerPanel, BoardSelector, CardBlockerHeatmap, CardPicker, CardRemovalPanel, ComboDistributionPanel, ComboDrilldown, EQRPanel, EquityBucketBars, EquityCalculator, EquityDistributionChart, HandReplayer, MDFPanel, MetricLabel, NodeKeyEditor, PokerTable, PotOddsPanel, RangeComparisonPanel, RangeDiffView, RangeDisagreementTable, RangeMatrix, RangeTextIO, tableSeats } from '@poker/ui';
import { ref, shallowRef } from 'vue';

import { GG_HAND as SAMPLE_HAND } from '../../../../../packages/poker-core/test/fixtures/hand';

definePageMeta({ public: true });

const { service } = useEquityService();
const range = ref<WeightedRange>({ ...parseRange('AA,KK,QQ:0.75,JJ,AKs,AKo:0.5,AQs+,A5s-A2s,JTs+,KQo,76s').range, label: 'Fixture' });
const villain = ref<WeightedRange>({ ...parseRange('TT-22,AJs-A2s,KTs+,QTs+,JTs,T9s,98s,AJo-ATo,KQo').range, label: 'Villain' });
const board = ref<Card[]>(parseCards('Kd 9h 4h'));
const dead = ref<Card[]>([]);
const picked = ref<Card[]>([]);
const cls = ref<HandClass | null>(parseCombo('AsKs') !== undefined ? 1 : null);
const result = shallowRef<EquityResult | null>(null);
const hovered = ref<Card | null>(null);
const selectedCombo = ref<ComboIndex | null>(null);
const lastEvent = ref('');
const pot = ref(100);
const bet = ref(66);
const call = ref<number | null>(null);
const extra = ref(0);
const rake = ref<RakeConfig>({ rakePct: 0.05, rakeCapBB: 3 });
const ev = ref<number | null>(38);
const situation = ref<NodeKey>(nodeKey('BB', { villain_position: 'CO', action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call')] }));
// The demo hand is the one the replay engine is tested against, so the page and the tests
// cannot show different behaviour for the same hand.
const sampleStates = replayStates(SAMPLE_HAND);
const replayStep = ref(0);
</script>

<template>
  <div class="space-y-10">
    <h1 class="text-2xl font-semibold">Components</h1>
    <p class="text-sm text-zinc-500">Each @poker/ui component with fixture props. Last event: <code>{{ lastEvent || '—' }}</code></p>

    <section class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-2">
        <h2 class="font-medium">RangeMatrix · edit</h2>
        <RangeMatrix :range="range" :blocked-cards="board" :heatmap="result?.perComboEquity ?? null" heatmap-label="equity" :selected-class="cls" @update:range="range = { ...$event, label: 'Fixture' }" @cell-click="(c) => { cls = c; lastEvent = `cellClick ${c}` }" @cell-hover="(c) => (lastEvent = `cellHover ${c}`)" />
      </div>
      <div class="space-y-2">
        <h2 class="font-medium">RangeMatrix · view, villain</h2>
        <RangeMatrix :range="villain" mode="view" :blocked-cards="board" :heatmap="result?.perComboEquityVillain ?? null" heatmap-label="equity" />
      </div>
    </section>

    <section class="space-y-2">
      <h2 class="font-medium">RangeTextIO</h2>
      <RangeTextIO :range="range" @update:range="range = { ...$event, label: 'Fixture' }" @format-change="(f) => (lastEvent = `formatChange ${f}`)" />
    </section>

    <section class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-2">
        <h2 class="font-medium">BoardSelector</h2>
        <BoardSelector :board="board" :dead-cards="dead" @update:board="board = $event" @update:dead-cards="dead = $event" />
      </div>
      <div class="space-y-2">
        <h2 class="font-medium">CardPicker</h2>
        <CardPicker :selected="picked" :disabled="board" @toggle="(c) => (picked = picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c])" />
      </div>
    </section>

    <section class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-2">
        <h2 class="font-medium">EquityCalculator</h2>
        <EquityCalculator :ranges="[range, villain]" :board="board" :dead-cards="dead" :service="service" @result="result = $event" />
      </div>
      <div class="space-y-2">
        <h2 class="font-medium">ComboDrilldown</h2>
        <ComboDrilldown :hand-class="cls" :range="range" :board="board" @update:range="range = { ...$event, label: 'Fixture' }" />
      </div>
    </section>

    <section class="space-y-2">
      <h2 class="font-medium">ComboDistributionPanel</h2>
      <ComboDistributionPanel :range="range" :compare-range="villain" :board="board" :group-by="['made', 'draw']" :equities="result?.perComboEquity ?? null" :compare-equities="result?.perComboEquityVillain ?? null" @group-click="(g) => (lastEvent = `groupClick ${g.label} (${g.combos})`)" @export="(csv) => (lastEvent = `export ${csv.split('\n').length} lines`)" />
    </section>

    <section class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-2">
        <h2 class="font-medium">BlockerPanel</h2>
        <BlockerPanel :hero-range="range" :villain-call="parseRange('TT-77,AJs-ATs,KTs+').range" :villain-fold="parseRange('66-22,A9s-A2s,QTs+,JTs,T9s,98s,AJo-ATo,KQo').range" :dead-cards="board" :pot="100" :bet="75" :selected-combo="selectedCombo" @combo-select="(c) => { selectedCombo = c; lastEvent = `comboSelect ${c}` }" />
      </div>
      <div class="space-y-2">
        <h2 class="font-medium">CardBlockerHeatmap</h2>
        <CardBlockerHeatmap :villain-range="villain" :board="board" @card-hover="(c) => (hovered = c)" />
        <p class="text-xs text-zinc-500">hovered: {{ hovered ?? '—' }}</p>
        <h2 class="pt-4 font-medium">CardRemovalPanel</h2>
        <CardRemovalPanel :range="range" :dead-cards="dead" @update:dead-cards="dead = $event" />
      </div>
    </section>

    <section class="space-y-2">
      <h2 class="font-medium">MetricLabel</h2>
      <p class="text-sm">Hover, focus or tap a term: <MetricLabel term="mdf" /> · <MetricLabel term="alpha" /> · <MetricLabel term="eqr" /> · <MetricLabel term="nutAdvantage" /> · <MetricLabel term="rangeAdvantage" /> · <MetricLabel term="blockerScore" /></p>
    </section>

    <section class="grid gap-6 lg:grid-cols-3">
      <div class="space-y-2">
        <h2 class="font-medium">PotOddsPanel</h2>
        <PotOddsPanel v-model:pot="pot" v-model:bet="bet" v-model:call="call" v-model:implied-extra="extra" v-model:rake-config="rake" />
      </div>
      <div class="space-y-2">
        <h2 class="font-medium">MDFPanel</h2>
        <MDFPanel v-model:pot="pot" v-model:bet="bet" :rake-config="rake" :range="villain" :equities="result?.perComboEquityVillain ?? null" @defend-click="(c) => (lastEvent = `defendClick ${c.length} combos`)" />
      </div>
      <div class="space-y-2">
        <h2 class="font-medium">EQRPanel</h2>
        <EQRPanel v-model:ev="ev" :equity="result?.heroEquity ?? 0.45" :pot="pot" :pool-eqr="{ eqr: 0.91, sampleSize: 1200 }" />
      </div>
    </section>

    <section class="space-y-2">
      <h2 class="font-medium">RangeComparisonPanel</h2>
      <RangeComparisonPanel :hero="range" :villain="villain" :hero-equities="result?.perComboEquity ?? null" :villain-equities="result?.perComboEquityVillain ?? null" :exact="result?.exact ?? null" />
    </section>

    <section v-if="result" class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-2">
        <h2 class="font-medium">EquityDistributionChart</h2>
        <EquityDistributionChart :hero-equities="result.perComboEquity" :villain-equities="result.perComboEquityVillain" :hero-weights="range.weights" :villain-weights="villain.weights" hero-label="Fixture" :threshold="0.8" />
      </div>
      <div class="space-y-2">
        <h2 class="font-medium">EquityBucketBars</h2>
        <EquityBucketBars :hero-buckets="equityBuckets({ equities: result.perComboEquity, weights: range.weights })" :villain-buckets="equityBuckets({ equities: result.perComboEquityVillain, weights: villain.weights })" hero-label="Fixture" />
      </div>
    </section>

    <section class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-2">
        <h2 class="font-medium">RangeDiffView</h2>
        <div class="max-w-md"><RangeDiffView :ranges="[{ label: 'Fixture', range }, { label: 'Villain', range: villain }]" @cell-click="(c) => (lastEvent = `diff cellClick ${c}`)" /></div>
      </div>
      <div class="space-y-2">
        <h2 class="font-medium">RangeDisagreementTable</h2>
        <RangeDisagreementTable :a="range" :b="villain" a-label="Fixture" b-label="Villain" @cell-click="(c) => (lastEvent = `disagree cellClick ${c}`)" />
      </div>
    </section>

    <section class="space-y-2">
      <h2 class="font-medium">NodeKeyEditor</h2>
      <div class="max-w-2xl rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><NodeKeyEditor v-model="situation" /></div>
    </section>

    <section class="space-y-2">
      <h2 class="font-medium">PokerTable</h2>
      <div class="max-w-3xl"><PokerTable :seats="tableSeats(SAMPLE_HAND, sampleStates[10]!)" :board="sampleStates[10]!.board" :pot="sampleStates[10]!.pot" :active-seat="sampleStates[10]!.actor" last-action="folds" :last-seat="1" :big-blind="SAMPLE_HAND.bigBlind" :button-seat="1" @seat-click="(s) => (lastEvent = `seatClick ${s}`)" /></div>
    </section>

    <section class="space-y-2">
      <h2 class="font-medium">HandReplayer</h2>
      <HandReplayer v-model="replayStep" :hand="SAMPLE_HAND" @node-change="(n) => (lastEvent = `nodeChange ${n ? nodeKeyLabel(n) : 'none'}`)" />
    </section>
  </div>
</template>
