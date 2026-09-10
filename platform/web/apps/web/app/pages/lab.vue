<script setup lang="ts">
// The Range Lab calculator: two ranges, a board, equity, distribution, blockers (spec §14
// phase 4 — a Flopzilla + Equilab replacement with blockers). Every panel is a @poker/ui
// component; this page only wires state, undo/redo and keyboard shortcuts.
import type { Axis, Card, ComboIndex, DistributionGroup, EquityResult, HandClass, RakeConfig, WeightedRange } from '@poker/core';
import { NO_RAKE, comboCards, comboIndex, createRange, filterByPredicate, parseCards, parseRange } from '@poker/core';
import { BlockerPanel, BoardSelector, CardBlockerHeatmap, CardPicker, CardRemovalPanel, ComboDistributionPanel, ComboDrilldown, EQRPanel, EquityCalculator, MDFPanel, PotOddsPanel, RangeComparisonPanel, RangeDiffView, RangeMatrix, RangeTextIO, useUndoRedo } from '@poker/ui';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';

definePageMeta({ public: true }); // spec §17: pure calculation works without a backend

const HERO_DEFAULT = '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,65s,A8o+,KTo+,QTo+,JTo';
const VILLAIN_DEFAULT = '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,74s+,64s+,53s+,A2o+,K7o+,Q8o+,J8o+,T8o+,98o';
const BRUSHES = [1, 0.75, 0.5, 0.25];

function labelled(range: WeightedRange, label: string): WeightedRange {
  return { weights: range.weights, label };
}

const { service } = useEquityService();
const hero = useUndoRedo<WeightedRange>(labelled(parseRange(HERO_DEFAULT).range, 'Hero'));
const villain = useUndoRedo<WeightedRange>(labelled(parseRange(VILLAIN_DEFAULT).range, 'Villain'));
const lastEdited = ref<'hero' | 'villain'>('hero');
const board = ref<Card[]>(parseCards('Kh 7d 2c'));
const dead = ref<Card[]>([]);
const brush = ref(1);
const customBrush = ref(0.6);
const result = shallowRef<EquityResult | null>(null);
const selected = ref<{ side: 'hero' | 'villain'; cls: HandClass } | null>(null);
const highlight = ref<ComboIndex[] | null>(null);
const axes = ref<Axis[]>(['made', 'draw']);
const showHeat = ref(true);
const continueAt = ref(40);
const valueAt = ref(60);
const pot = ref(100);
const bet = ref(66);
const call = ref<number | null>(null);
const impliedExtra = ref(0);
const rake = ref<RakeConfig>(NO_RAKE);
const ev = ref<number | null>(null);
const highlightSide = ref<'hero' | 'villain'>('hero');
const exported = ref<string | null>(null);
const heroHand = ref<Card[]>([]);
const selectedCombo = computed<ComboIndex | null>(() => (heroHand.value.length === 2 ? comboIndex(heroHand.value[0]!, heroHand.value[1]!) : null));

function toggleHeroCard(card: Card): void {
  const at = heroHand.value.indexOf(card);
  if (at >= 0) heroHand.value = heroHand.value.filter((c) => c !== card);
  else heroHand.value = [...heroHand.value.slice(-1), card];
}

function selectCombo(combo: ComboIndex): void {
  heroHand.value = [...comboCards(combo)];
  highlight.value = [combo];
  highlightSide.value = 'hero';
}

/** The MDF panel names villain's defending set; ring it on villain's matrix. */
function onDefend(combos: ComboIndex[]): void {
  highlight.value = combos;
  highlightSide.value = 'villain';
}

const blockedCards = computed(() => [...board.value, ...dead.value]);
const heroHeat = computed(() => (showHeat.value ? (result.value?.perComboEquity ?? null) : null));
const villainHeat = computed(() => (showHeat.value ? (result.value?.perComboEquityVillain ?? null) : null));

function setHero(next: WeightedRange): void {
  hero.set(labelled(next, 'Hero'));
  lastEdited.value = 'hero';
}

function setVillain(next: WeightedRange): void {
  villain.set(labelled(next, 'Villain'));
  lastEdited.value = 'villain';
}

const villainCall = computed(() => {
  const eq = result.value?.perComboEquityVillain;
  return eq === undefined ? createRange() : filterByPredicate(villain.state.value, (c) => (eq[c] ?? Number.NaN) >= continueAt.value / 100);
});
const villainFold = computed(() => {
  const eq = result.value?.perComboEquityVillain;
  return eq === undefined ? createRange() : filterByPredicate(villain.state.value, (c) => (eq[c] ?? Number.NaN) < continueAt.value / 100);
});
const isValue = (combo: ComboIndex): boolean => (result.value?.perComboEquity[combo] ?? 0) >= valueAt.value / 100;

function onGroup(group: DistributionGroup): void {
  highlight.value = [...group.comboList];
  highlightSide.value = 'hero';
}

function onKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  (lastEdited.value === 'hero' ? hero : villain).onKeydown(event);
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

const editedSide = computed(() => (lastEdited.value === 'hero' ? hero : villain));
</script>

<template>
  <div class="space-y-8">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">Range Lab</h1>
        <p class="text-sm text-zinc-500">Paint or paste two ranges, set a board, read the equities, the distribution and the blockers. Everything here runs in your browser.</p>
      </div>
      <div class="flex items-center gap-3 text-sm">
        <span class="text-zinc-500">Brush</span>
        <button v-for="b in BRUSHES" :key="b" type="button" class="rounded border px-2 py-1" :class="brush === b ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-zinc-300 dark:border-zinc-700'" @click="brush = b">{{ Math.round(100 * b) }}%</button>
        <label class="flex items-center gap-1">custom <input v-model.number="customBrush" type="number" min="0" max="1" step="0.05" class="w-16 rounded border border-zinc-300 px-1 dark:border-zinc-700 dark:bg-zinc-900" @change="brush = customBrush" /></label>
        <button type="button" class="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700" :disabled="!editedSide.canUndo.value" title="⌘Z" @click="editedSide.undo()">Undo</button>
        <button type="button" class="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700" :disabled="!editedSide.canRedo.value" title="⌘⇧Z" @click="editedSide.redo()">Redo</button>
        <label class="flex items-center gap-1"><input v-model="showHeat" type="checkbox" /> equity overlay</label>
      </div>
    </header>

    <section class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-3">
        <h2 class="font-medium">Hero <span class="text-sm text-zinc-500">· drag to paint, shift-drag to erase</span></h2>
        <RangeMatrix :range="hero.state.value" :brush="brush" :heatmap="heroHeat" heatmap-label="equity" :blocked-cards="blockedCards" :highlight-combos="highlightSide === 'hero' ? highlight : null" :selected-class="selected?.side === 'hero' ? selected.cls : null" @update:range="setHero" @cell-click="selected = { side: 'hero', cls: $event }" />
        <RangeTextIO :range="hero.state.value" @update:range="setHero" />
      </div>
      <div class="space-y-3">
        <h2 class="font-medium">Villain</h2>
        <RangeMatrix :range="villain.state.value" :brush="brush" :heatmap="villainHeat" heatmap-label="equity" :blocked-cards="blockedCards" :highlight-combos="highlightSide === 'villain' ? highlight : null" :selected-class="selected?.side === 'villain' ? selected.cls : null" @update:range="setVillain" @cell-click="selected = { side: 'villain', cls: $event }" />
        <RangeTextIO :range="villain.state.value" @update:range="setVillain" />
      </div>
    </section>

    <details class="text-sm">
      <summary class="cursor-pointer font-medium">Hero against villain, cell by cell</summary>
      <div class="mt-3 max-w-md">
        <RangeDiffView :ranges="[{ label: 'Hero', range: hero.state.value }, { label: 'Villain', range: villain.state.value }]" @cell-click="selected = { side: 'hero', cls: $event }" />
      </div>
    </details>

    <section class="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div class="space-y-3">
        <h2 class="font-medium">Board</h2>
        <BoardSelector :board="board" :dead-cards="dead" @update:board="board = $event" @update:dead-cards="dead = $event" />
      </div>
      <div class="space-y-3">
        <h2 class="font-medium">Equity</h2>
        <EquityCalculator :ranges="[hero.state.value, villain.state.value]" :board="board" :dead-cards="dead" :service="service" @result="result = $event" />
        <h3 class="pt-2 text-sm font-medium">Selected cell</h3>
        <ComboDrilldown :hand-class="selected?.cls ?? null" :range="selected?.side === 'villain' ? villain.state.value : hero.state.value" :board="board" @update:range="selected?.side === 'villain' ? setVillain($event) : setHero($event)" />
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="font-medium">Range against range <span class="text-sm text-zinc-500">· who has the equity, who has the nuts, and the distribution graph</span></h2>
      <RangeComparisonPanel :hero="hero.state.value" :villain="villain.state.value" :hero-equities="result?.perComboEquity ?? null" :villain-equities="result?.perComboEquityVillain ?? null" :exact="result?.exact ?? null" />
    </section>

    <section class="grid gap-6 lg:grid-cols-3">
      <div class="space-y-3">
        <h2 class="font-medium">Pot odds <span class="text-sm text-zinc-500">· hero bets; raw and after rake</span></h2>
        <PotOddsPanel v-model:pot="pot" v-model:bet="bet" v-model:call="call" v-model:implied-extra="impliedExtra" v-model:rake-config="rake" />
      </div>
      <div class="space-y-3">
        <h2 class="font-medium">Villain's defence <span class="text-sm text-zinc-500">· MDF against hero's bet</span></h2>
        <MDFPanel v-model:pot="pot" v-model:bet="bet" :rake-config="rake" :range="villain.state.value" :equities="result?.perComboEquityVillain ?? null" @defend-click="onDefend" />
      </div>
      <div class="space-y-3">
        <h2 class="font-medium">Equity realization <span class="text-sm text-zinc-500">· hero's range</span></h2>
        <EQRPanel v-if="result" v-model:ev="ev" :equity="result.heroEquity" :pot="pot" />
        <p v-else class="text-sm text-zinc-500">Waiting for the equity calculation.</p>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="font-medium">What is in each range <span class="text-sm text-zinc-500">· click a group to highlight its combos on hero's matrix</span></h2>
      <ComboDistributionPanel :range="hero.state.value" :compare-range="villain.state.value" :board="board" :group-by="axes" :equities="result?.perComboEquity ?? null" :compare-equities="result?.perComboEquityVillain ?? null" @update:group-by="axes = $event" @group-click="onGroup" @export="exported = $event" />
      <details v-if="exported" class="text-sm"><summary class="cursor-pointer text-zinc-500">Exported text</summary><pre class="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">{{ exported }}</pre></details>
    </section>

    <section class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-3">
        <h2 class="font-medium">Blockers</h2>
        <div class="flex flex-wrap gap-4 text-sm">
          <label class="flex items-center gap-1">villain continues at ≥ <input v-model.number="continueAt" type="number" min="0" max="100" class="w-16 rounded border border-zinc-300 px-1 dark:border-zinc-700 dark:bg-zinc-900" />% equity</label>
          <label class="flex items-center gap-1">hero value at ≥ <input v-model.number="valueAt" type="number" min="0" max="100" class="w-16 rounded border border-zinc-300 px-1 dark:border-zinc-700 dark:bg-zinc-900" />%</label>
          <label class="flex items-center gap-1">pot <input v-model.number="pot" type="number" min="1" class="w-20 rounded border border-zinc-300 px-1 dark:border-zinc-700 dark:bg-zinc-900" /></label>
          <label class="flex items-center gap-1">bet <input v-model.number="bet" type="number" min="0" class="w-20 rounded border border-zinc-300 px-1 dark:border-zinc-700 dark:bg-zinc-900" /></label>
        </div>
        <div class="space-y-1 text-sm">
          <p class="text-zinc-500">Your hand <span class="text-xs">· pick two cards, or click a row below</span></p>
          <CardPicker :selected="heroHand" :disabled="blockedCards" label="hero's hand" @toggle="toggleHeroCard" />
        </div>
        <p v-if="!result" class="text-sm text-zinc-500">Waiting for equities to split villain's range into calls and folds.</p>
        <BlockerPanel v-else :hero-range="hero.state.value" :villain-call="villainCall" :villain-fold="villainFold" :board="board" :dead-cards="blockedCards" :pot="pot" :bet="bet" :is-value="isValue" :selected-combo="selectedCombo" @combo-select="selectCombo" />
      </div>
      <div class="space-y-3">
        <h2 class="font-medium">What each card removes from villain</h2>
        <CardBlockerHeatmap :villain-range="villain.state.value" :board="board" />
        <h2 class="pt-4 font-medium">Dead cards and hero's range</h2>
        <CardRemovalPanel :range="hero.state.value" :dead-cards="dead" @update:dead-cards="dead = $event" />
      </div>
    </section>
  </div>
</template>
