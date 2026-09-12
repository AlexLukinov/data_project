<script setup lang="ts">
/**
 * The sessions table of My game (plan D.4): every sitting in the range, newest first.
 *
 * Each number here is the server's; `hero/sessions.ts` only words them. The one judgement the
 * table makes is about the **rate column**: a sitting of eleven hands has an arithmetically
 * correct −131.82 bb/100 that means nothing, and a column of rates invites reading down it, so
 * under the engine's own per-100 floor the rate is withheld and the row says why. The big
 * blinds beside it stay, because a sum is exact at any sample.
 */
import { computed } from 'vue';

import type { SessionsResult } from '~/hero/api';
import { sessionRows, sessionTotals } from '~/hero/sessions';

const props = withDefaults(defineProps<{ result: SessionsResult; limit?: number }>(), { limit: 12 });

const all = computed(() => sessionRows(props.result.sessions));
const rows = computed(() => all.value.slice(0, props.limit));
const totals = computed(() => sessionTotals(props.result));
</script>

<template>
  <div v-if="all.length === 0" class="text-sm text-zinc-500" data-testid="sessions-empty">
    No sittings in this range yet.
  </div>

  <div v-else class="space-y-2">
    <div class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-zinc-500">
          <tr>
            <th class="p-2">when</th>
            <th class="p-2">for</th>
            <th class="p-2 text-right">hands</th>
            <th class="p-2 text-right">bb</th>
            <th class="p-2 text-right">EV bb</th>
            <th class="p-2 text-right">bb/100</th>
            <th class="p-2">where</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" class="border-t border-zinc-200 dark:border-zinc-800" :data-testid="`session-${row.key}`">
            <td class="p-2 whitespace-nowrap">{{ row.when }}</td>
            <td class="p-2 whitespace-nowrap text-zinc-500">{{ row.duration }}</td>
            <td class="p-2 text-right tabular-nums text-zinc-500">{{ row.handsText }}</td>
            <td
              class="p-2 text-right tabular-nums font-medium"
              :class="row.sense === 'good' ? 'text-emerald-600 dark:text-emerald-400' : row.sense === 'bad' ? 'text-red-600 dark:text-red-400' : ''"
            >
              {{ row.netText }}
            </td>
            <td class="p-2 text-right tabular-nums text-zinc-500">{{ row.evText }}</td>
            <td class="p-2 text-right tabular-nums text-zinc-500" :title="row.note" :data-testid="`session-rate-${row.key}`">
              <template v-if="row.rateText !== ''">{{ row.rateText }}</template>
              <span v-else class="text-zinc-400 dark:text-zinc-600">too few hands</span>
            </td>
            <td class="p-2 whitespace-nowrap text-xs text-zinc-500">{{ row.where }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-sm text-zinc-500" data-testid="sessions-totals">
      <span v-if="all.length > rows.length">{{ rows.length }} of {{ totals.sessions }} sittings shown · </span>
      <span v-else>{{ totals.sessions }} sittings · </span>
      {{ totals.handsText }} hands · {{ totals.netText }} bb · {{ totals.winningText }} finished up ·
      {{ totals.gapText }}
    </p>
  </div>
</template>
