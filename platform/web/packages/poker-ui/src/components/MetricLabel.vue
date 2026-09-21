<script setup lang="ts">
/**
 * A metric's label with its glossary tooltip (spec §13): hover, focus or tap shows the
 * one-sentence definition and the formula. `term` is a `GlossaryKey`, so a label without a
 * glossary entry does not typecheck. The affordance itself is `TermLabel`, shared with the
 * category words of `vocabulary.ts` (ADR-056).
 */
import type { GlossaryKey } from '../glossary';
import { GLOSSARY } from '../glossary';
import TermLabel from './TermLabel.vue';

defineProps<{
  term: GlossaryKey;
  /** The visible text when it should differ from the glossary term (a shorter column header). */
  label?: string;
}>();
</script>

<template>
  <TermLabel :entry="GLOSSARY[term]" :label="label" :name="term" />
</template>
