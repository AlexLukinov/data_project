<script setup lang="ts">
// The leaks, worst first, each one a door into the hands behind it (plan D.7, ADR-040).
//
// The row itself is arithmetic the server did: `value` against `baseline`, their `delta`, and
// `|delta| * sqrt(n)` as the score that ranks them. What this component adds is the drill —
// `leakDrill` reads the situation out of the stat's own registry entry, so the link opens the
// same question the leak was scored on. Where it cannot, the row says why in place of a link:
// no leak is ever shown with a door that leads to a 400.
//
// Six column headings and thirty-nine stat labels, and until F.12c not one of them said what it
// meant. `leakRows` pairs each leak with its registry entry and `RegistryTerm` shows it; the four
// headings that are the app's own words — you, the field, gap, spots — come from `APP_TERMS`,
// because "gap" is in percentage points and "spots" is a sample, and neither is guessable.
import { computed } from 'vue';

import RegistryTerm from '~/components/reports/RegistryTerm.vue';
import type { DrillDates } from '~/hero/leaks';
import { leakRows } from '~/hero/leaks';
import type { Leak } from '~/hero/api';
import { APP_TERMS } from '~/stats/vocabulary';
import { useDefinitionsStore } from '~/stores/definitions';

const props = defineProps<{ leaks: readonly Leak[]; dates?: DrillDates }>();

const definitions = useDefinitionsStore();
const byCode = computed(() => new Map(definitions.stats.map((stat) => [stat.code, stat])));

const rows = computed(() => leakRows(props.leaks, byCode.value, definitions.byCode, props.dates));

const TERMS = APP_TERMS;

/** A percentage as the rest of the UI writes one. */
function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** The gap, signed, so "+14.0" reads as "more often than the field". */
function gap(delta: number): string {
  return `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`;
}

function sample(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Whether a gap is the wrong direction, where the registry commits to one. `higher_is_better`
 * is `null` for most stats on purpose — frequency stats have no good end — and an unknown
 * direction is left uncoloured rather than guessed at.
 */
function worse(leak: Leak): boolean | null {
  if (leak.higher_is_better === null || leak.higher_is_better === undefined) return null;
  return leak.higher_is_better ? leak.delta < 0 : leak.delta > 0;
}
</script>

<template>
  <div v-if="rows.length === 0" class="text-sm text-zinc-500" data-testid="leaks-empty">
    Nothing stands out yet. A leak needs enough opportunities to be a leak rather than noise — play more hands, or widen the dates.
  </div>

  <div v-else class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
    <table class="w-full text-sm">
      <thead class="text-left text-xs text-zinc-500">
        <tr>
          <th class="p-2">stat</th>
          <th class="p-2 text-right">you</th>
          <th class="p-2 text-right"><RegistryTerm :entry="TERMS.field" /></th>
          <th class="p-2 text-right"><RegistryTerm :entry="TERMS.gap" /></th>
          <th class="p-2 text-right"><RegistryTerm :entry="TERMS.spots" /></th>
          <th class="p-2">the hands</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.leak.code" class="border-t border-zinc-200 align-top dark:border-zinc-800" :data-testid="`leak-row-${row.leak.code}`">
          <td class="p-2">
            <RegistryTerm class="font-medium" :entry="row.term" :label="row.leak.label" :name="row.leak.code" />
            <span class="ml-2 text-xs text-zinc-500">{{ row.category }}</span>
            <span v-if="row.leak.typical" class="ml-2 text-xs text-zinc-400">usually {{ row.leak.typical[0] }}–{{ row.leak.typical[1] }}%</span>
          </td>
          <td class="p-2 text-right tabular-nums font-medium">{{ pct(row.leak.value) }}</td>
          <td class="p-2 text-right tabular-nums text-zinc-500">{{ pct(row.leak.baseline) }}</td>
          <td
            class="p-2 text-right tabular-nums"
            :class="worse(row.leak) === true ? 'text-red-600 dark:text-red-400' : worse(row.leak) === false ? 'text-emerald-600 dark:text-emerald-400' : ''"
            :data-testid="`leak-gap-${row.leak.code}`"
          >
            {{ gap(row.leak.delta) }}
          </td>
          <td class="p-2 text-right tabular-nums text-zinc-500">{{ sample(row.leak.n) }}</td>
          <td class="p-2">
            <template v-if="row.drill.blocked === ''">
              <NuxtLink v-if="row.takenQuery" :to="{ path: '/hands', query: row.takenQuery }" class="underline underline-offset-4 hover:no-underline" :data-testid="`leak-hands-${row.leak.code}`">the hands where you did it</NuxtLink>
              <NuxtLink v-if="row.spotQuery" :to="{ path: '/hands', query: row.spotQuery }" class="ml-3 text-xs text-zinc-500 underline underline-offset-4 hover:no-underline" :data-testid="`leak-spot-${row.leak.code}`">all {{ sample(row.leak.n) }} spots</NuxtLink>
            </template>
            <span v-else class="text-xs text-zinc-500" :data-testid="`leak-blocked-${row.leak.code}`">{{ row.drill.blocked }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
