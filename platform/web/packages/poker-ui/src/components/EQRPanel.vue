<script setup lang="ts">
/**
 * Equity realization (spec §8): raw equity and the pot give what full realization is worth;
 * an EV typed in from a solver gives EQR; a pool figure (F.10) is shown beside it with its
 * sample size. Every EQR says where its EV came from — this panel never invents one.
 */
import { equityRealization } from '@poker/core';
import { computed } from 'vue';

import { explainEqr, explainPoolEqr } from '../explain';
import { num, percent } from '../format';
import MetricLabel from './MetricLabel.vue';
import NumberInput from './NumberInput.vue';

const props = withDefaults(
  defineProps<{
    /** Raw equity, 0..1. */
    equity: number;
    pot: number;
    /** The EV the user entered from a solver solution, in the pot's unit. */
    ev?: number | null;
    /** The pool's empirical realization for this spot, with its sample size. */
    poolEqr?: { eqr: number; sampleSize: number } | null;
  }>(),
  { ev: null, poolEqr: null },
);
const emit = defineEmits<{ 'update:ev': [ev: number | null] }>();

const valid = computed(() => props.pot > 0 && props.equity > 0 && props.equity <= 1);
const fullValue = computed(() => props.equity * props.pot);
const eqr = computed(() => (props.ev === null || !valid.value ? null : equityRealization(props.ev, props.pot, props.equity)));
</script>

<template>
  <div class="pk-eqr">
    <dl class="pk-figures">
      <div>
        <dt><MetricLabel term="equity" /></dt>
        <dd data-testid="eqr-equity">{{ percent(equity) }}</dd>
      </div>
      <div>
        <dt>worth at full realization</dt>
        <dd data-testid="eqr-full">{{ num(fullValue) }}</dd>
      </div>
      <div>
        <dt><MetricLabel term="ev" label="EV, entered" /></dt>
        <dd><NumberInput :model-value="ev" placeholder="solver EV" aria-label="EV from a solver" @update:model-value="emit('update:ev', $event)" @clear="emit('update:ev', null)" /></dd>
      </div>
      <div>
        <dt><MetricLabel term="eqr" /></dt>
        <dd data-testid="eqr-value">{{ eqr === null ? '—' : num(eqr) }} <span v-if="eqr !== null" class="pk-muted">from the entered EV</span></dd>
      </div>
      <div v-if="poolEqr">
        <dt><MetricLabel term="eqr" label="EQR, pool" /></dt>
        <dd data-testid="eqr-pool">{{ num(poolEqr.eqr) }} <span class="pk-muted">empirical, n = {{ poolEqr.sampleSize.toLocaleString('en-US') }}</span></dd>
      </div>
    </dl>
    <p v-if="!valid" class="pk-error" role="alert">EQR needs a positive pot and an equity above 0.</p>
    <p v-else class="pk-explain" data-testid="eqr-explain">{{ explainEqr(equity, pot, ev, 'entered') }}</p>
    <p v-if="poolEqr" class="pk-explain" data-testid="eqr-pool-explain">{{ explainPoolEqr(poolEqr, eqr) }}</p>
  </div>
</template>

<style scoped>
.pk-eqr {
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
.pk-figures input {
  width: 6rem;
  font: inherit;
  font-size: 1rem;
  padding: 0.1rem 0.3rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-bg, #ffffff);
  color: inherit;
}
.pk-explain {
  margin: 0;
  font-size: 0.9rem;
}
.pk-muted {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--pk-muted, #71717a);
}
.pk-error {
  margin: 0;
  font-size: 0.85rem;
  color: var(--pk-heart, #dc2626);
}
</style>
