<script setup lang="ts">
/**
 * What the field actually won from this node, and the EQR that falls out of it (spec §10.4).
 *
 * The pool supplies one half — how many chips a seat took away from this point, as a share of
 * the pot it was playing for. The other half is equity, which only our own engine can give, so
 * an EQR appears on a row **only** where an equity was handed in: a realized share on its own is
 * not an EQR and is never shown as one.
 *
 * Two samples, and the gap between them is the warning. *Overall* counts every decision that
 * took this action, so nothing selects it. *By hand* can only count hands that were turned over,
 * which means hands that reached showdown — so a holding that usually wins without one is
 * under-counted here, and `covers` says how much of the node was ever seen at all.
 */
import { computed } from 'vue';

import type { RealizationRow } from '../estimate';
import { poolEqr } from '../estimate';
import { num } from '../format';
import MetricLabel from './MetricLabel.vue';

const props = withDefaults(
  defineProps<{
    action: string;
    overall: RealizationRow | null;
    rows: readonly RealizationRow[];
    covers: number;
    minBucketN: number;
    /** Equity per 169-combo class, 0..1, where the caller could work one out. */
    equity?: Readonly<Record<string, number>> | null;
    /** Equity of the whole range taking the action, for the overall row. */
    overallEquity?: number | null;
  }>(),
  { equity: null, overallEquity: null },
);

const PERCENT = 100;
const PLACES = 1;

const listed = computed(() => props.rows.filter((row) => row.sample_size > 0));
const overallEqr = computed(() => poolEqr(props.overall?.realized ?? null, props.overallEquity));
const covered = computed(() => `${(props.covers * PERCENT).toFixed(props.covers < 0.1 ? PLACES : 0)}%`);

function eqrOf(row: RealizationRow): number | null {
  return poolEqr(row.realized, props.equity?.[row.hand_class] ?? null);
}
</script>

<template>
  <div class="pk-realization">
    <dl v-if="overall" class="pk-figures">
      <div>
        <dt><MetricLabel term="poolRealization" :label="`realized after a ${action}`" /></dt>
        <dd data-testid="realization-overall">{{ overall.realized === null ? '—' : `${(overall.realized * PERCENT).toFixed(PLACES)}% of pot` }}</dd>
      </div>
      <div>
        <dt>chips from here</dt>
        <dd data-testid="realization-net">{{ overall.mean_net_bb === null ? '—' : `${num(overall.mean_net_bb)} bb` }}</dd>
      </div>
      <div>
        <dt><MetricLabel term="eqr" label="EQR, pool" /></dt>
        <dd data-testid="realization-eqr">
          {{ overallEqr === null ? '—' : num(overallEqr) }}
          <span class="pk-muted">{{ overallEqr === null ? 'needs an equity to divide by' : `n = ${overall.sample_size.toLocaleString('en-US')}` }}</span>
        </dd>
      </div>
    </dl>
    <p v-else class="pk-muted" data-testid="realization-empty">
      The field has not {{ action }} here often enough to say what it won.
    </p>

    <p v-if="overall" class="pk-muted" data-testid="realization-covers">
      Overall counts every {{ action }} here. The rows below can only count the {{ covered }} that were
      turned over, which favours hands that saw a showdown; under {{ minBucketN }} shown, a hand carries
      its count and no number.
    </p>

    <table v-if="listed.length" class="pk-rows" data-testid="realization-rows">
      <thead>
        <tr>
          <th scope="col">hand</th>
          <th scope="col">n</th>
          <th scope="col">bb from here</th>
          <th scope="col">realized</th>
          <th scope="col">EQR</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in listed" :key="row.hand_class" :class="{ 'pk-thin': row.realized === null }" :data-testid="`realization-${row.hand_class}`">
          <th scope="row">{{ row.hand_class }}</th>
          <td>{{ row.sample_size.toLocaleString('en-US') }}</td>
          <td>{{ row.mean_net_bb === null ? 'too few' : num(row.mean_net_bb) }}</td>
          <td>{{ row.realized === null ? '—' : `${(row.realized * PERCENT).toFixed(PLACES)}%` }}</td>
          <td>{{ eqrOf(row) === null ? '—' : num(eqrOf(row)!) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.pk-realization {
  display: grid;
  gap: 0.6rem;
  color: var(--pk-fg, #18181b);
}
.pk-figures {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  margin: 0;
}
.pk-figures div {
  display: grid;
  gap: 0.1rem;
}
.pk-figures dt {
  font-size: 0.8rem;
}
.pk-figures dd {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pk-muted {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--pk-muted, #71717a);
}
.pk-rows {
  border-collapse: collapse;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
.pk-rows th,
.pk-rows td {
  padding: 0.15rem 0.5rem 0.15rem 0;
  text-align: right;
}
.pk-rows thead th {
  font-weight: 500;
  color: var(--pk-muted, #71717a);
}
.pk-rows tbody th {
  text-align: left;
  font-weight: 600;
}
.pk-thin {
  color: var(--pk-muted, #71717a);
}
</style>
