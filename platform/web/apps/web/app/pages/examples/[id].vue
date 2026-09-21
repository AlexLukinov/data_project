<script setup lang="ts">
// One example (ADR-050): a spot that ships with the app, worked in the analyzer's own step
// components over a copy that lives in this tab. Only the steps answered by poker-core are offered,
// so no gate here ever waits for a pool that does not exist.
import { StepperNav } from '@poker/ui';
import type { Component } from 'vue';

import Step3Buckets from '~/components/analyze/Step3Buckets.vue';
import Step4Nuts from '~/components/analyze/Step4Nuts.vue';
import Step5Blockers from '~/components/analyze/Step5Blockers.vue';
import Step7Placement from '~/components/analyze/Step7Placement.vue';
import Step8ValueBluffs from '~/components/analyze/Step8ValueBluffs.vue';
import { STEP_LABELS } from '~/analyze/steps';
import ExampleSpot from '~/components/help/ExampleSpot.vue';
import { createExampleSession } from '~/help/exampleSession';
import { EXAMPLES, EXAMPLE_STEPS, exampleById } from '~/help/examples';

// Public: an example needs no account and no backend. Keyed by path, so moving between examples
// starts the next one afresh rather than carrying the last one's answers.
definePageMeta({ public: true, key: (route) => route.fullPath });

const STEP_COMPONENTS: Readonly<Record<number, Component>> = {
  3: Step3Buckets,
  4: Step4Nuts,
  5: Step5Blockers,
  7: Step7Placement,
  8: Step8ValueBluffs,
};

const LABELS = STEP_LABELS.filter((label) => EXAMPLE_STEPS.includes(label.step));

const route = useRoute();
const example = exampleById(String(route.params.id ?? ''));
const session = example === null ? null : createExampleSession(example);
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <NuxtLink to="/examples" class="text-sm text-zinc-500 hover:underline" data-testid="example-back">← examples</NuxtLink>
      <h1 class="text-xl font-semibold" data-testid="example-title">{{ example?.title ?? 'No such example' }}</h1>
    </div>

    <p v-if="!example || !session" class="rounded border border-dashed border-zinc-300 p-6 text-sm dark:border-zinc-700" data-testid="example-unknown">
      There is no example called “{{ route.params.id }}”. The {{ EXAMPLES.length }} there are:
      <template v-for="(known, i) in EXAMPLES" :key="known.id">
        <span v-if="i > 0">, </span><NuxtLink :to="`/examples/${known.id}`" class="underline">{{ known.title }}</NuxtLink>
      </template>.
    </p>

    <template v-else>
      <ExampleSpot :example="example" />

      <div class="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside>
          <StepperNav :steps="LABELS" :current="session.current.value" :completed="session.completed.value" @navigate="session.goTo" />
        </aside>

        <div class="space-y-4">
          <component :is="STEP_COMPONENTS[session.current.value]" :key="session.current.value" :ctx="session.context" @patch="session.patch" />

          <nav class="flex items-center gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <button type="button" class="rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700" :disabled="session.neighbour(-1) === null" data-testid="example-prev" @click="session.goTo(session.neighbour(-1) ?? 0)">← previous</button>
            <button type="button" class="rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700" :disabled="session.neighbour(1) === null" data-testid="example-next" @click="session.goTo(session.neighbour(1) ?? 0)">next step →</button>
            <span class="text-sm text-zinc-500">{{ session.completed.value.length }} of {{ LABELS.length }} predictions committed</span>
          </nav>
        </div>
      </div>
    </template>
  </section>
</template>
