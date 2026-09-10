<script setup lang="ts">
/**
 * The equity distribution graph (spec §8, acceptance 3): each range from its strongest combo
 * to its weakest against the share of the range that is at least that strong. Plain SVG: it
 * scales with its container, reads the theme tokens and needs no chart library. Moving the
 * pointer across the plot reads both curves at that share.
 */
import type { CurvePoint } from '@poker/core';
import { equityAtShare, equityCurve, weightedMeanEquity } from '@poker/core';
import { computed, ref } from 'vue';

import { percent } from '../format';
import MetricLabel from './MetricLabel.vue';

const props = withDefaults(
  defineProps<{
    heroEquities: Float32Array;
    villainEquities: Float32Array;
    heroWeights: ArrayLike<number>;
    villainWeights: ArrayLike<number>;
    heroLabel?: string;
    villainLabel?: string;
    /** A dashed line at this equity (the nut threshold). */
    threshold?: number | null;
  }>(),
  { heroLabel: 'Hero', villainLabel: 'Villain', threshold: null },
);

const WIDTH = 320;
const HEIGHT = 200;
const LEFT = 34;
const RIGHT = 8;
const TOP = 8;
const BOTTOM = 22;
const PLOT_W = WIDTH - LEFT - RIGHT;
const PLOT_H = HEIGHT - TOP - BOTTOM;
const TICKS = [0, 0.25, 0.5, 0.75, 1];
const PERCENT = 100;

const hero = computed(() => ({ equities: props.heroEquities, weights: props.heroWeights }));
const villain = computed(() => ({ equities: props.villainEquities, weights: props.villainWeights }));
const heroCurve = computed(() => equityCurve(hero.value));
const villainCurve = computed(() => equityCurve(villain.value));

function x(share: number): number {
  return LEFT + PLOT_W * share;
}
function y(equity: number): number {
  return TOP + PLOT_H * (1 - equity);
}
function path(curve: readonly CurvePoint[]): string {
  return curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.share).toFixed(1)} ${y(p.equity).toFixed(1)}`).join(' ');
}
const heroPath = computed(() => path(heroCurve.value));
const villainPath = computed(() => path(villainCurve.value));

const hover = ref<number | null>(null);
function onMove(event: PointerEvent): void {
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
  if (rect.width === 0) return;
  const share = (((event.clientX - rect.left) / rect.width) * WIDTH - LEFT) / PLOT_W;
  hover.value = Math.min(1, Math.max(0, share));
}
const readout = computed(() => (hover.value === null ? null : { share: hover.value, hero: equityAtShare(heroCurve.value, hover.value), villain: equityAtShare(villainCurve.value, hover.value) }));
const summary = computed(() => `${props.heroLabel} averages ${percent(weightedMeanEquity(hero.value))}, ${props.villainLabel} ${percent(weightedMeanEquity(villain.value))}`);
</script>

<template>
  <figure class="pk-chart">
    <figcaption><MetricLabel term="equityDistribution" /> <span class="pk-muted">· {{ summary }}</span></figcaption>
    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" role="img" :aria-label="`Equity distribution: ${summary}`" @pointermove="onMove" @pointerleave="hover = null">
      <g class="pk-grid">
        <template v-for="t in TICKS" :key="t">
          <line :x1="LEFT" :x2="LEFT + PLOT_W" :y1="y(t)" :y2="y(t)" />
          <text :x="LEFT - 4" :y="y(t) + 3" text-anchor="end">{{ Math.round(PERCENT * t) }}%</text>
          <text :x="x(t)" :y="HEIGHT - 6" text-anchor="middle">{{ Math.round(PERCENT * t) }}%</text>
        </template>
      </g>
      <line v-if="threshold !== null" class="pk-threshold" :x1="LEFT" :x2="LEFT + PLOT_W" :y1="y(threshold)" :y2="y(threshold)" data-testid="chart-threshold" />
      <path class="pk-line pk-hero" :d="heroPath" data-testid="chart-hero" />
      <path class="pk-line pk-villain" :d="villainPath" data-testid="chart-villain" />
      <line v-if="readout" class="pk-cursor" :x1="x(readout.share)" :x2="x(readout.share)" :y1="TOP" :y2="TOP + PLOT_H" />
    </svg>
    <p class="pk-legend">
      <span class="pk-swatch pk-hero" /> {{ heroLabel }} <span class="pk-swatch pk-villain" /> {{ villainLabel }}
      <span v-if="readout" data-testid="chart-readout">· the top {{ percent(readout.share, 0) }} of the range: {{ heroLabel }} ≥ {{ percent(readout.hero) }}, {{ villainLabel }} ≥ {{ percent(readout.villain) }}</span>
      <span v-else class="pk-muted">· across: share of the range from its strongest combo · up: equity</span>
    </p>
  </figure>
</template>

<style scoped>
.pk-chart {
  margin: 0;
  display: grid;
  gap: 0.3rem;
  color: var(--pk-fg, #18181b);
}
figcaption {
  font-size: 0.85rem;
  font-weight: 500;
}
svg {
  display: block;
  width: 100%;
  height: auto;
  touch-action: none;
}
.pk-grid line {
  stroke: var(--pk-border, #d4d4d8);
  stroke-width: 0.5;
}
.pk-grid text {
  fill: var(--pk-muted, #71717a);
  font-size: 8px;
}
.pk-line {
  fill: none;
  stroke-width: 1.8;
  stroke-linejoin: round;
}
.pk-line.pk-hero {
  stroke: var(--pk-hero, #2563eb);
}
.pk-line.pk-villain {
  stroke: var(--pk-villain, #c2410c);
}
.pk-threshold {
  stroke: var(--pk-highlight, #f59e0b);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.pk-cursor {
  stroke: var(--pk-muted, #71717a);
  stroke-width: 0.8;
}
.pk-legend {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
}
.pk-swatch {
  display: inline-block;
  width: 0.9rem;
  height: 3px;
}
.pk-swatch.pk-hero {
  background: var(--pk-hero, #2563eb);
}
.pk-swatch.pk-villain {
  background: var(--pk-villain, #c2410c);
}
.pk-muted {
  font-weight: 400;
  color: var(--pk-muted, #71717a);
}
</style>
