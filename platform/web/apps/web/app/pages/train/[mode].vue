<script setup lang="ts">
// One training mode (spec §16). The page owns the run and the equity Worker; each mode component
// draws its own spot and the shell does the gating, the scoring and the schedule.
import { computed, onMounted, shallowRef } from 'vue';

import AdvantageTrainer from '~/components/train/AdvantageTrainer.vue';
import BlockersTrainer from '~/components/train/BlockersTrainer.vue';
import CombosTrainer from '~/components/train/CombosTrainer.vue';
import DrawingTrainer from '~/components/train/DrawingTrainer.vue';
import EquityTrainer from '~/components/train/EquityTrainer.vue';
import PotOddsTrainer from '~/components/train/PotOddsTrainer.vue';
import TrainerShell from '~/components/train/TrainerShell.vue';
import { createTrainingCache } from '~/train/cache';
import { MODES, isTrainMode, modeDef } from '~/train/modes';
import { createTrainer } from '~/train/session';
import type {
  AdvantageSpot,
  BlockersSpot,
  CombosSpot,
  DrawingSpot,
  EquitySpot,
  PotOddsSpot,
} from '~/train/types';

// spec §17: pure calculation, so it works with no backend and needs no sign-in.
definePageMeta({ public: true, key: (route) => route.fullPath });

const route = useRoute();
const param = computed(() => String(route.params.mode ?? ''));
const known = computed(() => isTrainMode(param.value));
const def = computed(() => (known.value && isTrainMode(param.value) ? modeDef(param.value) : null));

const { service } = useEquityService();
const trainer = createTrainer(isTrainMode(param.value) ? param.value : 'potodds', {
  cache: createTrainingCache(),
  service,
});

/** The drawing mode scores on total weight error; the shell passes it to the score row. */
const weightError = shallowRef<number | null>(null);

onMounted(() => {
  if (known.value) void trainer.start();
});

const spot = computed(() => trainer.spot.value);
</script>

<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-center gap-3">
      <NuxtLink to="/train" class="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Train
      </NuxtLink>
      <h1 class="text-2xl font-semibold">{{ def?.title ?? 'Unknown mode' }}</h1>
      <NuxtLink
        to="/progress"
        class="ml-auto text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        Progress →
      </NuxtLink>
    </div>

    <p
      v-if="!known"
      class="rounded border border-dashed border-zinc-300 p-6 text-sm dark:border-zinc-700"
      data-testid="train-unknown"
    >
      There is no training mode called “{{ param }}”. The six are
      {{ MODES.map((m) => m.title).join(', ') }} —
      <NuxtLink to="/train" class="underline">pick one</NuxtLink>.
    </p>

    <template v-else>
      <p class="text-sm text-zinc-500">{{ def?.purpose }}</p>

      <p
        v-if="spot === null"
        class="rounded border border-dashed border-zinc-300 p-6 text-sm dark:border-zinc-700"
      >
        Building your first spot…
      </p>

      <TrainerShell v-else :trainer="trainer" :weight-error="weightError">
        <template #default="{ spot: current, revealed }">
          <EquityTrainer v-if="current.mode === 'equity'" :spot="current as EquitySpot" />
          <CombosTrainer
            v-else-if="current.mode === 'combos'"
            :spot="current as CombosSpot"
            :revealed="revealed"
          />
          <DrawingTrainer
            v-else-if="current.mode === 'drawing'"
            :spot="current as DrawingSpot"
            :revealed="revealed"
            @update:weight-error="weightError = $event"
          />
          <BlockersTrainer
            v-else-if="current.mode === 'blockers'"
            :spot="current as BlockersSpot"
            :revealed="revealed"
          />
          <AdvantageTrainer
            v-else-if="current.mode === 'advantage'"
            :spot="current as AdvantageSpot"
            :revealed="revealed"
          />
          <PotOddsTrainer
            v-else
            :spot="current as PotOddsSpot"
            :revealed="revealed"
          />
        </template>
      </TrainerShell>
    </template>
  </section>
</template>
