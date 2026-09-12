<script setup lang="ts">
/**
 * Which slice of the field a report is about (plan D.6).
 *
 * Two selects rather than one, because "regs vs fish" is the question the pool is actually asked:
 * the engine answers a single cohort per request (`ReportRequest.cohort`) and refuses a pool
 * baseline (`compare_to` is hero-only), so a comparison is two runs and the second select is what
 * asks for the second one.
 *
 * The cohorts offered are the server's. The two the pool area ships — `regs` and `fish` — arrive
 * with every page load on `GET /v1/pool/presets`, and a saved cohort is a row the founder created.
 * Neither is authored here: `reports/api.ts` records why ("*inventing one here would put a report
 * in the client that the engine had never agreed to answer*"), and a VPIP threshold retyped in the
 * client is exactly that.
 */
import type { CohortChoice } from '~/pool/stats';

const props = defineProps<{
  choices: readonly CohortChoice[];
  /** The key of the cohort the report is scoped to, or `null` for the whole field. */
  primary: string | null;
  /** The key of a second cohort to run beside it, or `null` for no comparison. */
  against: string | null;
  busy: boolean;
}>();

const emit = defineEmits<{ 'update:primary': [key: string | null]; 'update:against': [key: string | null] }>();

const WHOLE_FIELD = '';

/** A cohort cannot be compared with itself, and the whole field is not a cohort to compare against. */
const opposing = computed(() => props.choices.filter((choice) => choice.key !== props.primary));

const chosen = computed(() => props.choices.find((choice) => choice.key === props.primary) ?? null);
const opposed = computed(() => props.choices.find((choice) => choice.key === props.against) ?? null);

function chosenKey(event: Event): string | null {
  const value = (event.target as HTMLSelectElement).value;
  return value === WHOLE_FIELD ? null : value;
}

/**
 * A cohort's rule as one sentence.
 *
 * The two sources punctuate differently — the server's shipped description is a full sentence
 * ending in a period, while a saved cohort's is `describeRules`' bare "vpip ≥ 35" — so the period
 * is normalised here rather than doubled for one source and missing for the other.
 */
function sentence(choice: CohortChoice): string {
  return `players matching ${choice.description.replace(/\.$/, '')}.`;
}
</script>

<template>
  <section class="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="cohort-picker">
    <h2 class="text-sm font-medium">Which players</h2>

    <div class="flex flex-wrap items-center gap-2 text-sm">
      <label class="flex items-center gap-2">
        <span class="text-zinc-500">measure</span>
        <select
          :value="props.primary ?? WHOLE_FIELD"
          :disabled="props.busy"
          data-testid="cohort-primary"
          class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
          @change="emit('update:primary', chosenKey($event))"
        >
          <option :value="WHOLE_FIELD">the whole field</option>
          <option v-for="choice in props.choices" :key="choice.key" :value="choice.key">{{ choice.label }}</option>
        </select>
      </label>

      <label class="flex items-center gap-2">
        <span class="text-zinc-500">against</span>
        <select
          :value="props.against ?? WHOLE_FIELD"
          :disabled="props.busy"
          data-testid="cohort-against"
          class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
          @change="emit('update:against', chosenKey($event))"
        >
          <option :value="WHOLE_FIELD">nothing — one grid</option>
          <option v-for="choice in opposing" :key="choice.key" :value="choice.key">{{ choice.label }}</option>
        </select>
      </label>
    </div>

    <p v-if="chosen" class="text-xs text-zinc-500" data-testid="cohort-primary-rules">
      <strong>{{ chosen.label }}</strong> — {{ sentence(chosen) }}
    </p>
    <p v-if="opposed" class="text-xs text-zinc-500" data-testid="cohort-against-rules">
      <strong>{{ opposed.label }}</strong> — {{ sentence(opposed) }}
    </p>
    <p v-if="opposed" class="text-xs text-zinc-500" data-testid="cohort-two-runs">
      Two reports, one per cohort, over the same rows. No difference is drawn between them: each
      cell shows its own sample, and a difference between two thin ones measures the samples.
    </p>
  </section>
</template>
