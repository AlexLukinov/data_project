<script setup lang="ts">
/**
 * One reference table of words (ADR-056): term, what it means, and the rule that places something
 * under it — the seats, the hand classes, the draws, the categories, the distribution axes, the
 * situation shorthand, or the pool's tiers. For a help overlay or a reference page to mount; the
 * words themselves live in `vocabulary.ts` and `glossary.ts`, so a tooltip and this table can
 * never say different things.
 */
import { computed } from 'vue';

import type { TermEntry } from '../glossary';
import { GLOSSARY, POOL_TERMS } from '../glossary';
import type { VocabularyName } from '../vocabulary';
import { VOCABULARY } from '../vocabulary';

const props = defineProps<{
  /** Which table; `tiers` is the pool's glossary words (the three tiers, n and showdown coverage). */
  table: VocabularyName | 'tiers';
  caption?: string;
}>();

const rows = computed<readonly TermEntry[]>(() =>
  props.table === 'tiers' ? POOL_TERMS.map((key) => GLOSSARY[key]) : Object.values<TermEntry>(VOCABULARY[props.table]),
);
/** A tier is counted, not placed: its third column is a formula. */
const ruleHeading = computed(() => (props.table === 'tiers' ? 'how it is counted' : 'rule'));
</script>

<template>
  <table class="pk-vocab" :data-testid="`vocabulary-${table}`">
    <caption v-if="caption">{{ caption }}</caption>
    <thead>
      <tr>
        <th scope="col">term</th>
        <th scope="col">meaning</th>
        <th scope="col">{{ ruleHeading }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.term">
        <th scope="row">{{ row.term }}</th>
        <td>{{ row.definition }}</td>
        <td class="pk-rule">{{ row.formula ?? '—' }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.pk-vocab {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  line-height: 1.4;
  color: var(--pk-fg, #18181b);
}
.pk-vocab caption {
  padding-bottom: 0.4rem;
  text-align: left;
  color: var(--pk-muted, #71717a);
}
.pk-vocab th,
.pk-vocab td {
  padding: 0.3rem 0.6rem 0.3rem 0;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
  border-top: 1px solid var(--pk-border, #d4d4d8);
}
.pk-vocab thead th {
  font-weight: 500;
  color: var(--pk-muted, #71717a);
  border-top: 0;
}
.pk-vocab tbody th {
  width: 20%;
  font-weight: 600;
}
.pk-rule {
  width: 35%;
  color: var(--pk-muted, #71717a);
}
</style>
