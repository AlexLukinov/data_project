<script setup lang="ts">
/**
 * A metric's label with its glossary tooltip (spec §13): hover, focus or tap shows the
 * one-sentence definition and the formula. `term` is a `GlossaryKey`, so a label without a
 * glossary entry does not typecheck.
 */
import { computed, useId } from 'vue';

import type { GlossaryKey } from '../glossary';
import { GLOSSARY } from '../glossary';

const props = defineProps<{
  term: GlossaryKey;
  /** The visible text when it should differ from the glossary term (a shorter column header). */
  label?: string;
}>();

const id = useId();
const entry = computed(() => GLOSSARY[props.term]);
</script>

<template>
  <span class="pk-term">
    <span class="pk-term-text" tabindex="0" :aria-describedby="id" :data-term="term">{{ label ?? entry.term }}</span>
    <span :id="id" role="tooltip" class="pk-tip"><strong>{{ entry.term }}</strong> · {{ entry.definition }} <code>{{ entry.formula }}</code></span>
  </span>
</template>

<style scoped>
.pk-term {
  position: relative;
  display: inline-block;
}
.pk-term-text {
  border-bottom: 1px dotted currentColor;
  cursor: help;
}
.pk-term-text:focus-visible {
  outline: 2px solid var(--pk-accent, #2563eb);
  outline-offset: 2px;
}
.pk-tip {
  display: none;
  position: absolute;
  z-index: 10;
  left: 0;
  top: 100%;
  margin-top: 0.3rem;
  width: max-content;
  max-width: 22rem;
  padding: 0.4rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.4;
  text-align: left;
  text-transform: none;
  letter-spacing: 0;
  white-space: normal;
  color: var(--pk-fg, #18181b);
  background: var(--pk-bg, #ffffff);
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
}
.pk-term:hover .pk-tip,
.pk-term:focus-within .pk-tip {
  display: block;
}
.pk-tip code {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.7rem;
  color: var(--pk-muted, #71717a);
}
</style>
