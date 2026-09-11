<script setup lang="ts">
// The accuracy trend (spec §16, acceptance 11), drawn as plain SVG.
//
// No chart library, for the reason ADR-030 gives: it is sixty lines of SVG, it reads the theme
// tokens, and it mounts under happy-dom in a test. Days with nothing answered are gaps in the
// line rather than a straight segment across them — a trend that closes up over the days you did
// not practise flatters you.
import { computed } from 'vue';

import type { DayPoint } from '~/train/progress';
import { THIN_SAMPLE, practisedRuns } from '~/train/progress';

const props = withDefaults(defineProps<{ points: readonly DayPoint[]; height?: number }>(), {
  height: 80,
});

const WIDTH = 600;
const PAD = 4;
const RADIUS = 2.5;
const PERCENT = 100;

const step = computed(() => (WIDTH - PAD * 2) / Math.max(1, props.points.length - 1));

function x(at: number): number {
  return PAD + at * step.value;
}

function y(accuracy: number): number {
  return PAD + (1 - accuracy) * (props.height - PAD * 2);
}

interface Dot {
  readonly key: string;
  readonly cx: number;
  readonly cy: number;
  readonly thin: boolean;
  readonly title: string;
}

const dots = computed<Dot[]>(() =>
  props.points.flatMap((point, at) =>
    point.accuracy === null
      ? []
      : [
          {
            key: point.date,
            cx: x(at),
            cy: y(point.accuracy),
            thin: point.served < THIN_SAMPLE,
            title: `${point.date}: ${point.right} of ${point.served} right`,
          },
        ],
  ),
);

/** One path per unbroken run of practised days; `practisedRuns` is what keeps a gap a gap. */
const segments = computed<string[]>(() =>
  practisedRuns(props.points).map(
    (run) =>
      `M ${run
        .map((at) => `${x(at).toFixed(1)},${y(props.points[at]!.accuracy ?? 0).toFixed(1)}`)
        .join(' L ')}`,
  ),
);

const practised = computed(() => props.points.filter((point) => point.served > 0).length);
</script>

<template>
  <div class="space-y-1">
    <svg
      :viewBox="`0 0 ${WIDTH} ${height}`"
      class="w-full"
      role="img"
      :aria-label="`Accuracy over the last ${points.length} days`"
      data-testid="accuracy-trend"
    >
      <line :x1="PAD" :y1="y(0.5)" :x2="WIDTH - PAD" :y2="y(0.5)" class="pk-half" />
      <path v-for="(d, at) in segments" :key="at" :d="d" class="pk-line" />
      <circle
        v-for="dot in dots"
        :key="dot.key"
        :cx="dot.cx"
        :cy="dot.cy"
        :r="RADIUS"
        :class="dot.thin ? 'pk-dot pk-thin' : 'pk-dot'"
      >
        <title>{{ dot.title }}</title>
      </circle>
    </svg>
    <p class="text-xs text-zinc-500">
      <template v-if="practised === 0">No answers in this window yet.</template>
      <template v-else>
        {{ practised }} {{ practised === 1 ? 'day' : 'days' }} practised · the line breaks over the
        days you did not · the rule is {{ 0.5 * PERCENT }}% · a hollow point is fewer than
        {{ THIN_SAMPLE }} answers
      </template>
    </p>
  </div>
</template>

<style scoped>
.pk-half {
  stroke: var(--pk-border, #d4d4d8);
  stroke-dasharray: 3 4;
  stroke-width: 1;
}
.pk-line {
  fill: none;
  stroke: var(--pk-accent, #2563eb);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.pk-dot {
  fill: var(--pk-accent, #2563eb);
}
.pk-thin {
  fill: var(--pk-bg, #ffffff);
  stroke: var(--pk-accent, #2563eb);
  stroke-width: 1.5;
}
</style>
