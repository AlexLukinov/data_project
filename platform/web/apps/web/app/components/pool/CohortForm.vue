<script setup lang="ts">
/**
 * Make or change one cohort (plan D.6b): a name and up to ten rules, each a cached stat, a
 * comparison and a number. The vocabulary and the checks are `pool/rules.ts`; this binds them to
 * inputs. The server has the last word — a save it refuses is shown in its own sentence, which the
 * page passes in as `failure`.
 *
 * Every stat the registry knows is listed, and only a cached one can be chosen: a cohort is
 * evaluated on the daily rollup, so the rest are shown greyed rather than hidden, which is how a
 * person learns *why* aggression factor is not on offer instead of wondering whether it exists.
 */
import { NumberInput, formatDecimal, parseDecimal } from '@poker/ui';
import { computed, ref, watch } from 'vue';

import type { RuleDraft } from '~/pool/rules';
import { MAX_RULES, NAME_MAX, OPS, draftProblems, draftsOf, emptyRule, splitByCached, toSpec } from '~/pool/rules';
import type { CohortIn } from '~/pool/stats';
import type { CohortOp, Stat } from '~/stats/api';

const props = defineProps<{
  stats: readonly Stat[];
  /** What the form opens with — the cohort being edited or a shipped one being copied — or nothing. */
  initial: CohortIn | null;
  /** True when the save replaces a saved cohort rather than making a new one. */
  replacing: boolean;
  busy: boolean;
  /** The server's sentence for a refused save, or empty. */
  failure: string;
}>();

const emit = defineEmits<{ save: [body: CohortIn]; cancel: [] }>();

const name = ref('');
const rules = ref<RuleDraft[]>([]);
const showProblems = ref(false);

const stats = computed(() => splitByCached(props.stats));
const problems = computed(() => draftProblems(name.value, rules.value));
const full = computed(() => rules.value.length >= MAX_RULES);

watch(
  () => props.initial,
  (initial) => {
    name.value = initial?.name ?? '';
    rules.value = initial === null ? [emptyRule(stats.value.cached)] : draftsOf(initial.criteria);
    showProblems.value = false;
  },
  { immediate: true },
);

function addRule(): void {
  if (full.value) return;
  rules.value = [...rules.value, emptyRule(stats.value.cached)];
}

function removeRule(index: number): void {
  rules.value = rules.value.filter((_, i) => i !== index);
}

/** Replace one row; a draft is never mutated in place. */
function setRule(index: number, patch: Partial<RuleDraft>): void {
  rules.value = rules.value.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
}

function typed(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

/** True for a stat the registry no longer names, so the select can say so rather than show its first option. */
function unknown(code: string): boolean {
  return code !== '' && !props.stats.some((stat) => stat.code === code);
}

function submit(): void {
  if (props.busy) return;
  if (problems.value.length > 0) {
    showProblems.value = true;
    return;
  }
  emit('save', { name: name.value.trim(), criteria: toSpec(rules.value) });
}
</script>

<template>
  <form class="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="cohort-form" novalidate @submit.prevent="submit">
    <h2 class="text-sm font-medium">{{ props.replacing ? 'Change this cohort' : 'A cohort of your own' }}</h2>

    <label class="block space-y-1 text-sm">
      <span class="text-zinc-500">Name</span>
      <input
        v-model="name"
        type="text"
        :maxlength="NAME_MAX"
        data-testid="cohort-name"
        class="w-full max-w-md rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
      />
    </label>

    <p class="text-xs text-zinc-500">
      Every rule must hold for a player to be in the cohort. A stat that is not answered from the
      daily rollup cannot define one, so it is listed below but cannot be chosen.
    </p>

    <ul class="space-y-2" data-testid="cohort-rules">
      <li v-for="(rule, index) in rules" :key="index" class="flex flex-wrap items-center gap-2 text-sm" :data-testid="`cohort-rule-${index}`">
        <select
          :value="rule.stat"
          data-testid="rule-stat"
          class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          @change="setRule(index, { stat: typed($event) })"
        >
          <option v-if="unknown(rule.stat)" :value="rule.stat" disabled>{{ rule.stat }} — no longer in the registry</option>
          <option v-for="stat in stats.cached" :key="stat.code" :value="stat.code">{{ stat.label }}</option>
          <optgroup v-if="stats.uncached.length > 0" label="Not cached — cannot define a cohort">
            <option v-for="stat in stats.uncached" :key="stat.code" :value="stat.code" disabled>{{ stat.label }}</option>
          </optgroup>
        </select>

        <select
          :value="rule.op"
          data-testid="rule-op"
          class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          @change="setRule(index, { op: typed($event) as CohortOp })"
        >
          <option v-for="choice in OPS" :key="choice.op" :value="choice.op">{{ choice.label }}</option>
        </select>

        <NumberInput
          :model-value="parseDecimal(rule.value)"
          data-testid="rule-value"
          class="w-28 rounded border border-zinc-300 bg-transparent px-2 py-1 tabular-nums dark:border-zinc-700"
          @update:model-value="setRule(index, { value: formatDecimal($event) })"
          @clear="setRule(index, { value: '' })"
        />

        <button type="button" data-testid="rule-remove" class="text-xs underline underline-offset-2" @click="removeRule(index)">Remove</button>
      </li>
    </ul>

    <div class="flex flex-wrap items-center gap-3 text-sm">
      <button
        type="button"
        :disabled="full"
        data-testid="rule-add"
        class="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
        @click="addRule"
      >
        Add a rule
      </button>
      <span class="text-xs text-zinc-500" data-testid="rule-count">
        {{ rules.length }} of {{ MAX_RULES }}<template v-if="full"> — the server allows no more</template>
      </span>
    </div>

    <template v-if="showProblems">
      <p v-for="problem in problems" :key="problem" role="alert" data-testid="cohort-problem" class="text-xs text-amber-700 dark:text-amber-400">{{ problem }}</p>
    </template>
    <p v-if="props.failure" role="alert" data-testid="cohort-form-error" class="text-sm text-red-600 dark:text-red-400">{{ props.failure }}</p>

    <div class="flex items-center gap-2">
      <button
        type="submit"
        :disabled="props.busy"
        data-testid="cohort-save"
        class="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {{ props.busy ? 'Saving…' : props.replacing ? 'Save changes' : 'Save cohort' }}
      </button>
      <button
        type="button"
        data-testid="cohort-cancel"
        class="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        @click="emit('cancel')"
      >
        Cancel
      </button>
    </div>
  </form>
</template>
