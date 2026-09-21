<script setup lang="ts">
/**
 * A word with its explanation (spec §13, ADR-056): a dotted underline whose hover, focus or tap
 * shows what the word means — one sentence, and the formula or the rule when there is one.
 *
 * The one affordance for both vocabularies: `MetricLabel` hands it a glossary entry (how a number
 * was obtained), the reference tables in `vocabulary.ts` hand it a category row (a hand class, a
 * seat, a piece of the situation shorthand). A caller whose word is already a control — a group
 * button, a checkbox's label — passes that control as the default slot, binds `describedby` to
 * it, and keeps its own click; the tooltip still opens on hover and on focus inside it.
 */
import { useId } from 'vue';

import type { TermEntry } from '../glossary';

defineProps<{
  entry: TermEntry;
  /** The visible text when it should differ from the entry's term (a shorter column header). */
  label?: string;
  /** Written as `data-term` on the fallback trigger; defaults to the entry's term. */
  name?: string;
}>();

defineSlots<{
  /** The trigger, when it is not plain text; bind `describedby` to its `aria-describedby`. */
  default?: (props: { describedby: string }) => unknown;
  /** The tooltip's body, when one sentence and a formula are not the shape of it. */
  tip?: () => unknown;
}>();

const id = useId();
</script>

<template>
  <span class="pk-term">
    <slot :describedby="id">
      <span class="pk-term-text" tabindex="0" :aria-describedby="id" :data-term="name ?? entry.term">{{ label ?? entry.term }}</span>
    </slot>
    <span :id="id" role="tooltip" class="pk-tip">
      <slot name="tip"><strong>{{ entry.term }}</strong> · {{ entry.definition }} <code v-if="entry.formula">{{ entry.formula }}</code></slot>
    </span>
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
