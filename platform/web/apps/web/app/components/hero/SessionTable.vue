<script setup lang="ts">
/**
 * The sessions table of My game (plan D.4): every sitting in the range, newest first.
 *
 * Each number here is the server's; `hero/sessions.ts` only words them. The one judgement the
 * table makes is about the **rate column**: a sitting of eleven hands has an arithmetically
 * correct −131.82 bb/100 that means nothing, and a column of rates invites reading down it, so
 * under the engine's own per-100 floor the rate is withheld and the row says why. The big
 * blinds beside it stay, because a sum is exact at any sample.
 *
 * **The three money headings are registry words** (ADR-057), which is why this table reads the
 * definitions store at all: `bb`, `EV bb` and `bb/100` were bare abbreviations, and the middle
 * one is the app's worst ambiguity — the EV here is the all-in adjusted total, not a solver's.
 * The reason a rate is withheld moved off the cell's `title` onto the same affordance, because a
 * `title` on a `<td>` reaches a mouse and nothing else.
 */
import { computed } from 'vue';

import RegistryTerm from '~/components/reports/RegistryTerm.vue';
import type { SessionsResult } from '~/hero/api';
import { sessionsReading } from '~/hero/readings';
import { sessionHeaders, sessionRows, sessionTotals, thinRateTerm } from '~/hero/sessions';
import { useDefinitionsStore } from '~/stores/definitions';

const props = withDefaults(defineProps<{ result: SessionsResult; limit?: number }>(), { limit: 12 });

const definitions = useDefinitionsStore();

const all = computed(() => sessionRows(props.result.sessions));
const rows = computed(() => all.value.slice(0, props.limit));
const totals = computed(() => sessionTotals(props.result));
const headers = computed(() => sessionHeaders(definitions.stats, definitions.byCode));
/**
 * What the sittings mean rather than what they add up to (plan F.12, `hero/readings.ts`): the
 * widest swing either way, and whether it is wider than the whole run. The totals line above is
 * arithmetic; only twelve rows are on screen, and the spread is read off every one of them.
 */
const reading = computed(() => sessionsReading(props.result));
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
            <th class="p-2 text-right"><RegistryTerm :entry="headers.net" label="bb" name="net_won_bb" /></th>
            <th class="p-2 text-right"><RegistryTerm :entry="headers.ev" label="EV bb" name="ev_won_bb" /></th>
            <th class="p-2 text-right"><RegistryTerm :entry="headers.rate" label="bb/100" name="bb_per_100" /></th>
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
            <td class="p-2 text-right tabular-nums text-zinc-500" :data-testid="`session-rate-${row.key}`">
              <template v-if="row.rateText !== ''">{{ row.rateText }}</template>
              <RegistryTerm v-else class="text-zinc-400 dark:text-zinc-600" :entry="thinRateTerm(row.note)" name="too-few-hands" />
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

    <p v-if="reading !== ''" class="max-w-prose text-sm text-zinc-600 dark:text-zinc-400" data-testid="sessions-reading">{{ reading }}</p>
  </div>
</template>
