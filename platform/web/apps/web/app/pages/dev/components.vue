<script setup lang="ts">
// Every @poker/ui component in isolation with fixture props (ADR-024: reviewed on a fixture page).
import type { Card, ComboIndex, EquityResult, HandClass, WeightedRange } from '@poker/core';
import { parseCards, parseCombo, parseRange } from '@poker/core';
import { BlockerPanel, BoardSelector, CardBlockerHeatmap, CardPicker, CardRemovalPanel, ComboDistributionPanel, ComboDrilldown, EquityCalculator, RangeMatrix, RangeTextIO } from '@poker/ui';
import { ref, shallowRef } from 'vue';

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
  </div>
</template>
