<script setup lang="ts">
/**
 * The winnings graph (plan D.4): four cumulative lines — actual, EV, showdown, non-showdown —
 * over calendar time, drawn as plain SVG.
 *
 * **No chart library**, for the reason ADR-030 gives and this file demonstrates: it is the axes,
 * four paths and a crosshair, it reads the theme's own surfaces, and every number in it comes
 * out of `hero/winnings.ts`, which is tested without a browser. A library would paint its own
 * colours (so dark mode means resolving tokens at mount), emit a canvas a test can only assert
 * a constructor against, and add a licence to audit.
 *
 * **On the palette.** The four series colours are literal hex rather than the `--pk-*` tokens,
 * and that is deliberate: those tokens were chosen for UI chrome, and as a four-way categorical
 * set three of the four fail a colour-blindness check — `--pk-good` against `--pk-villain` comes
 * out at a deutan ΔE of 7.0, below the floor. These four were picked by running the candidates
 * through a validator and clear every check — lightness, chroma, CVD separation on all six
 * pairs, normal-vision separation and contrast — against the light **and** the dark surface,
 * which is also why there is no dark-mode override: one palette reads on both, so only the
 * ground changes. They stay overridable as custom properties.
 *
 * Colour is never the only encoding anyway: each line has its own dash pattern, each is labelled
 * at its own end, and the legend doubles as the on/off control. Each legend button also carries
 * the sentence saying what its line draws, on a tip that opens to hover, focus **and** tap
 * (ADR-057); it was a `title`, which is only ever the first of those three.
 */
import { computed, ref } from 'vue';

import RegistryTerm from '~/components/reports/RegistryTerm.vue';
import type { WinningsPoint } from '~/hero/api';
import { WINNINGS_EMPTY, seriesTerm } from '~/hero/words';
import type { Plotted, SeriesKey } from '~/hero/winnings';
import { BOX, SERIES, geometry, nearestPoint } from '~/hero/winnings';

const props = defineProps<{ points: readonly WinningsPoint[] }>();

/** All four to begin with: the comparison is the point, and hiding is the reader's choice. */
const visible = ref<SeriesKey[]>(SERIES.map((series) => series.key));
const hovered = ref<Plotted | null>(null);
const svg = ref<SVGSVGElement | null>(null);

const geo = computed(() => geometry(props.points, visible.value));

/** The last visible line cannot be turned off — an empty chart would have no axis to scale to. */
function toggle(key: SeriesKey): void {
  const on = visible.value.includes(key);
  if (on && visible.value.length === 1) return;
  visible.value = on ? visible.value.filter((other) => other !== key) : [...visible.value, key];
}

const shown = computed(() => SERIES.filter((series) => visible.value.includes(series.key)));

/** Client x → viewBox x, so the crosshair snaps correctly at any rendered width. */
function track(event: PointerEvent): void {
  const element = svg.value;
  const plot = geo.value;
  if (element === null || plot === null) return;
  const box = element.getBoundingClientRect();
  if (box.width === 0) return;
  hovered.value = nearestPoint(plot.points, ((event.clientX - box.left) / box.width) * BOX.width);
}

/** The tooltip sits on whichever side of the crosshair has room for it. */
const tipLeft = computed(() => (hovered.value === null ? 0 : (hovered.value.x / BOX.width) * 100));
const tipFlip = computed(() => tipLeft.value > 60);

function money(value: number): string {
  const text = Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return value < 0 ? `−${text}` : value > 0 ? `+${text}` : '0';
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label="Which lines are drawn">
      <RegistryTerm v-for="series in SERIES" :key="series.key" :entry="seriesTerm(series)">
        <template #default="{ describedby }">
          <button
            type="button"
            class="flex items-center gap-1.5 text-xs"
            :class="visible.includes(series.key) ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400 line-through dark:text-zinc-600'"
            :aria-describedby="describedby"
            :aria-pressed="visible.includes(series.key)"
            :data-testid="`winnings-toggle-${series.key}`"
            @click="toggle(series.key)"
          >
            <svg width="18" height="8" aria-hidden="true" class="shrink-0">
              <line
                x1="1" y1="4" x2="17" y2="4"
                :data-series="series.key"
                :stroke-dasharray="series.dash || undefined"
                :stroke-width="series.width"
                :opacity="visible.includes(series.key) ? 1 : 0.35"
              />
            </svg>
            {{ series.label }}
          </button>
        </template>
      </RegistryTerm>
    </div>

    <p v-if="geo === null" class="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700" data-testid="winnings-empty">
      {{ WINNINGS_EMPTY }}
    </p>

    <div v-else class="relative">
      <svg
        ref="svg"
        :viewBox="`0 0 ${BOX.width} ${BOX.height}`"
        class="w-full touch-none"
        role="img"
        :aria-label="`Cumulative winnings over ${geo.points.length} days: ${shown.map((s) => s.label).join(', ')}`"
        data-testid="winnings-chart"
        @pointermove="track"
        @pointerleave="hovered = null"
      >
        <!-- Grid and axis first, so every line is drawn over them. -->
        <g class="pk-axis">
          <template v-for="tick in geo.yTicks" :key="`y${tick.value}`">
            <line :x1="BOX.left" :y1="tick.offset" :x2="BOX.width - BOX.right" :y2="tick.offset" class="pk-grid" />
            <text :x="BOX.left - 8" :y="tick.offset + 3" text-anchor="end" class="pk-tick">{{ tick.label }}</text>
          </template>
          <text v-for="tick in geo.xTicks" :key="`x${tick.value}`" :x="tick.offset" :y="BOX.height - 8" text-anchor="middle" class="pk-tick">{{ tick.label }}</text>
          <!-- Break-even. Named in the caption rather than on the plot: the right margin is
               where the four end labels live, and a word there collided with them. -->
          <line :x1="BOX.left" :y1="geo.zeroY" :x2="BOX.width - BOX.right" :y2="geo.zeroY" class="pk-zero" data-testid="winnings-breakeven" />
        </g>

        <path v-for="path in geo.paths" :key="path.key" :d="path.d" :data-series="path.key" class="pk-line" :stroke-dasharray="SERIES.find((s) => s.key === path.key)!.dash || undefined" :stroke-width="SERIES.find((s) => s.key === path.key)!.width" />

        <!-- Direct labels: identity without reading the legend, and the relief a low-contrast
             hue owes the reader. -->
        <text v-for="end in geo.ends" :key="`end${end.key}`" :x="end.x + 5" :y="end.y + 3" :data-series="end.key" class="pk-end" :data-testid="`winnings-end-${end.key}`">{{ end.label }}</text>

        <g v-if="hovered !== null" data-testid="winnings-crosshair">
          <line :x1="hovered.x" :y1="BOX.top" :x2="hovered.x" :y2="BOX.height - BOX.bottom" class="pk-cross" />
          <circle v-for="series in shown" :key="series.key" :cx="hovered.x" :cy="hovered.y[series.key]" r="3.5" :data-series="series.key" class="pk-dot" />
        </g>
      </svg>

      <div
        v-if="hovered !== null"
        class="pointer-events-none absolute top-1 rounded border border-zinc-200 bg-white/95 p-2 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95"
        :style="{ left: tipFlip ? 'auto' : `calc(${tipLeft}% + 10px)`, right: tipFlip ? `calc(${100 - tipLeft}% + 10px)` : 'auto' }"
        data-testid="winnings-tooltip"
      >
        <p class="font-medium">{{ hovered.label }}</p>
        <p class="text-zinc-500">{{ hovered.hands.toLocaleString('en-US') }} hands that day</p>
        <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
          <template v-for="series in shown" :key="series.key">
            <dt class="flex items-center gap-1.5 text-zinc-500">
              <span class="inline-block h-2 w-2 rounded-full" :data-series="series.key" />
              {{ series.label }}
            </dt>
            <dd class="text-right tabular-nums">{{ money(hovered.values[series.key]) }} bb</dd>
          </template>
        </dl>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * One palette for both themes. Every value clears the six checks — lightness band, chroma
 * floor, CVD separation across all six pairs, normal-vision separation, contrast — on the light
 * surface and the dark one, so a theme switch changes the ground and nothing else.
 */
.pk-line,
.pk-end,
.pk-dot,
[data-series] {
  --series-net: #2563eb;
  --series-ev: #f43f5e;
  --series-showdown: #a16207;
  --series-nonShowdown: #059669;
}

[data-series='net'] {
  stroke: var(--series-net);
  color: var(--series-net);
}
[data-series='ev'] {
  stroke: var(--series-ev);
  color: var(--series-ev);
}
[data-series='showdown'] {
  stroke: var(--series-showdown);
  color: var(--series-showdown);
}
[data-series='nonShowdown'] {
  stroke: var(--series-nonShowdown);
  color: var(--series-nonShowdown);
}

/* The legend swatch and the tooltip dot are filled shapes, not strokes. */
span[data-series] {
  background: currentColor;
}

.pk-line {
  fill: none;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.pk-dot {
  fill: currentColor;
  stroke: var(--pk-bg, #ffffff);
  stroke-width: 1.5;
}
.pk-end {
  fill: currentColor;
  stroke: none;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
/* Grid and axis recede: they are the ruler, not the reading. */
.pk-grid {
  stroke: var(--pk-border, #d4d4d8);
  stroke-width: 0.5;
  opacity: 0.5;
}
.pk-zero {
  stroke: var(--pk-muted, #71717a);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}
.pk-cross {
  stroke: var(--pk-muted, #71717a);
  stroke-width: 1;
}
.pk-tick {
  fill: var(--pk-muted, #71717a);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
</style>
