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
 * and multi-select from a dropdown needs a modifier key nobody discovers. Each real seat's hover
 * says what its abbreviation means, from the same table the rest of the app explains seats with.
 */
import { computed } from 'vue';

import { POSITION_WORDS, isPosition } from '../vocabulary';

const props = withDefaults(
  defineProps<{
    /** The seats to offer, in the order they should read. Values are the registry's own. */
    seats: readonly string[];
    selected: readonly string[];
    /**
     * What each seat is called on screen, when the caller has words for it (ADR-067). The registry
     * names every enum value where it declares it, and `''` means something different on each
     * dimension that carries it — "Nobody has raised yet" on `opener_position`, "No bet or raise
     * yet" on `last_raiser_position`. Without this the picker invented one phrase for both, which
     * is the rewrite ADR-062 removed from the rest of the client. Optional, because a caller with
     * no registry to hand (a `NodeKey` editor, a story) still gets readable seats.
     */
    labels?: Readonly<Record<string, string>>;
    /** Several seats at once (an `in` filter), or exactly one. */
    multiple?: boolean;
    label?: string;
    disabled?: boolean;
  }>(),
  { multiple: false, label: 'position', disabled: false, labels: undefined },
);

const emit = defineEmits<{ 'update:selected': [seats: string[]] }>();

const chosen = computed(() => new Set(props.selected));

/** The caller's word for a value, when it has one. Own properties only: a value may be `toString`. */
function given(seat: string): string | undefined {
  const labels = props.labels;
  return labels !== undefined && Object.hasOwn(labels, seat) ? labels[seat] : undefined;
}

/**
 * `''` is a real registry value; it needs something on the button, not an empty one.
 *
 * One rule, and it is a layout rule rather than a vocabulary one: a seat chip is 2.6rem wide and
 * sits in a ring of them, so the button carries the short form and the *meaning* goes on the hover,
 * which is where every other seat's meaning already is. "Nobody has raised yet" does not go on a
 * chip. So `seatLabel` stays this component's, `seatTitle` becomes the caller's wherever the
 * caller has a word — and the phrase the client used to invent for `''` is gone from both.
 */
function seatLabel(seat: string): string {
  if (seat === '') return 'none';
  if (seat === 'UNKNOWN') return '?';
  return seat;
}

/**
 * The hover is where a reader asks what a seat *means*, so it carries a definition — and the
 * caller's word wins exactly where this component would otherwise be **guessing**.
 *
 * That is `''` and nothing else. `''` is the only value whose meaning depends on which dimension
 * it sits on ("Nobody has raised yet" on `opener_position`, "No bet or raise yet" on
 * `last_raiser_position`), so any single phrase here is wrong on at least one of them — which is
 * what the deleted one was. Every other value already has something better than a label: the ten
 * real seats have `POSITION_WORDS`, and `UNKNOWN` has a sentence saying why it is unknown, where
 * the registry has only the word "Unknown". Binding a label over a definition would have made the
 * hover less useful, which the browser showed and the unit test could not.
 */
function seatTitle(seat: string): string {
  if (seat === '') return given(seat) ?? 'Not applicable — nobody in that role';
  if (seat === 'UNKNOWN') return 'An anonymised seat the export does not name';
  return isPosition(seat) ? POSITION_WORDS[seat].definition : (given(seat) ?? seat);
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
