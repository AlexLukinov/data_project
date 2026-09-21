<script setup lang="ts">
/**
 * One empty state, rendered (audit §2.4, plan F.12c).
 *
 * It carries no wording of its own: `reports/emptyState.ts` and `hands/emptyState.ts` build the
 * view, so every sentence this shows is asserted as text rather than fished out of a mounted
 * component. The `testid` is a required prop because an empty state nothing can select is one no
 * browser check can prove is on screen; each way out gets `<testid>-<key>` of its own.
 *
 * An action with a `to` is a link and navigates by itself; anything else is a button and comes
 * back as `act(key)`, because clearing a filter, widening a cohort or running a report is the
 * page's business, not this component's.
 */
import type { EmptyStateView } from '~/reports/emptyState';

const props = defineProps<{ view: EmptyStateView; testid: string }>();
const emit = defineEmits<{ act: [key: string] }>();

const ACTION_CLASS = 'rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900';
</script>

<template>
  <div class="space-y-2 text-left text-sm" :data-testid="props.testid">
    <p class="font-medium text-zinc-700 dark:text-zinc-200">{{ props.view.lead }}</p>
    <p class="max-w-2xl text-zinc-500">{{ props.view.body }}</p>
    <div v-if="props.view.actions.length" class="flex flex-wrap gap-2 pt-1">
      <template v-for="action in props.view.actions" :key="action.key">
        <NuxtLink v-if="action.to" :to="action.to" :data-testid="`${props.testid}-${action.key}`" :class="ACTION_CLASS">{{ action.label }}</NuxtLink>
        <button v-else type="button" :data-testid="`${props.testid}-${action.key}`" :class="ACTION_CLASS" @click="emit('act', action.key)">{{ action.label }}</button>
      </template>
    </div>
  </div>
</template>
