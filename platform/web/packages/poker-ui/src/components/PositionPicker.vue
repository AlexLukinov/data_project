<script setup lang="ts">
/**
 * Pick one or more seats from a ring (plan D.3).
 *
 * The vocabulary arrives as a prop rather than being imported from `@poker/core`, because the
 * two differ on purpose: `NodeKey`'s `POSITIONS` are the ten seats a hand can be played from,
 * while the registry's `position` dimension also carries `UNKNOWN` (an anonymised seat) and its
 * sibling dimensions — `opener_position`, `last_raiser_position` — carry `''` for "nobody has
 * raised yet". A picker that hard-coded either list would make some real hands unfilterable.
 *
 * A row of seats rather than a `<select>`: position is the one filter a player reads spatially,
 * and multi-select from a dropdown needs a modifier key nobody discovers.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** The seats to offer, in the order they should read. Values are the registry's own. */
    seats: readonly string[];
    selected: readonly string[];
    /** Several seats at once (an `in` filter), or exactly one. */
    multiple?: boolean;
    label?: string;
    disabled?: boolean;
  }>(),
  { multiple: false, label: 'position', disabled: false },
);

const emit = defineEmits<{ 'update:selected': [seats: string[]] }>();

const chosen = computed(() => new Set(props.selected));

/** `''` is a real registry value; it needs words, not an empty button. */
function seatLabel(seat: string): string {
  if (seat === '') return 'none';
  if (seat === 'UNKNOWN') return '?';
  return seat;
}

function seatTitle(seat: string): string {
  if (seat === '') return 'Not applicable — nobody in that role';
  if (seat === 'UNKNOWN') return 'An anonymised seat the export does not name';
  return seat;
}

function toggle(seat: string): void {
  if (props.disabled) return;
  if (!props.multiple) {
    emit('update:selected', [seat]);
    return;
  }
  const next = props.seats.filter((s) => (s === seat ? !chosen.value.has(s) : chosen.value.has(s)));
  emit('update:selected', next);
}
</script>

<template>
  <div class="pk-seats" role="group" :aria-label="label" data-testid="position-picker">
    <button
      v-for="seat in seats"
      :key="seat"
      type="button"
      class="pk-seat"
      :class="{ 'pk-on': chosen.has(seat), 'pk-none': seat === '' }"
      :aria-pressed="chosen.has(seat)"
      :disabled="disabled"
      :title="seatTitle(seat)"
      :data-testid="`seat-${seat === '' ? 'none' : seat}`"
      @click="toggle(seat)"
    >
      {{ seatLabel(seat) }}
    </button>
  </div>
</template>

<style scoped>
.pk-seats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.pk-seat {
  min-width: 2.6rem;
  padding: 0.2rem 0.45rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 0.35rem;
  background: var(--pk-bg, #ffffff);
  color: var(--pk-fg, #18181b);
  font: inherit;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.pk-seat:hover:not(:disabled) {
  border-color: var(--pk-accent, #2563eb);
}

.pk-seat:disabled {
  cursor: default;
  opacity: 0.5;
}

.pk-none {
  font-style: italic;
  color: var(--pk-muted, #71717a);
}

.pk-on {
  border-color: var(--pk-accent, #2563eb);
  background: color-mix(in srgb, var(--pk-accent, #2563eb) 18%, transparent);
  font-weight: 600;
}

.pk-seat:focus-visible {
  outline: 2px solid var(--pk-accent, #2563eb);
  outline-offset: 1px;
}
</style>
