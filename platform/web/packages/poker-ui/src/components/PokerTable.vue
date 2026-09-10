<script setup lang="ts">
/**
 * The table at one point in a hand (spec §9.1): seats around an oval with their position,
 * stack and chips committed, the board and pot in the middle, the seat to act ringed and the
 * last action shown as a bubble beside the seat that took it.
 *
 * Pure display — it is handed seats, not a hand, so the same component draws a stored hand, a
 * pool hand and a pasted one. Seats are laid out on an ellipse with hero at the bottom, which
 * is where every poker client puts the player, so the geometry needs no per-format special case.
 */
import { computed } from 'vue';

import type { TableSeat } from '../table';
import { shownCards } from '../table';

const props = withDefaults(
  defineProps<{
    seats: readonly TableSeat[];
    /** Board cards face up right now. */
    board: readonly string[];
    pot: number;
    activeSeat: number | null;
    /** What just happened, e.g. `raises to 6.00`; shown beside `lastSeat`. */
    lastAction?: string;
    lastSeat?: number | null;
    /** Blinds, so stacks can be read in big blinds as well as in money. */
    bigBlind?: number;
    /** Marks the seat with the button. */
    buttonSeat?: number | null;
    /** The hand is over: the seats that won it are named, since awards are not actions. */
    handOver?: boolean;
  }>(),
  { lastAction: '', lastSeat: null, bigBlind: 0, buttonSeat: null, handOver: false },
);
const emit = defineEmits<{ seatClick: [seat: number] }>();

const HERO_ANGLE = 90;
const FULL_TURN = 360;
const RADIUS_X = 42;
const RADIUS_Y = 36;
const CENTRE = 50;
const CHIP_PULL = 0.55;

/** Seats in clockwise draw order starting at the bottom, so hero sits nearest the reader. */
const ordered = computed(() => {
  const seats = [...props.seats];
  const heroAt = seats.findIndex((s) => s.isHero);
  const start = heroAt === -1 ? 0 : heroAt;
  return [...seats.slice(start), ...seats.slice(0, start)];
});

function angleOf(index: number): number {
  return ((HERO_ANGLE + (index * FULL_TURN) / Math.max(1, ordered.value.length)) * Math.PI) / 180;
}

function seatStyle(index: number): Record<string, string> {
  const angle = angleOf(index);
  return { left: `${CENTRE + RADIUS_X * Math.cos(angle)}%`, top: `${CENTRE + RADIUS_Y * Math.sin(angle)}%` };
}

function chipStyle(index: number): Record<string, string> {
  const angle = angleOf(index);
  return { left: `${CENTRE + RADIUS_X * CHIP_PULL * Math.cos(angle)}%`, top: `${CENTRE + RADIUS_Y * CHIP_PULL * Math.sin(angle)}%` };
}

const boardCards = computed(() => shownCards(props.board));

function money(value: number): string {
  return value.toFixed(2);
}

function inBb(value: number): string {
  return props.bigBlind > 0 ? `${Math.round((value / props.bigBlind) * 10) / 10}bb` : money(value);
}
</script>

<template>
  <div class="pk-table" data-testid="poker-table">
    <div class="pk-felt"></div>
    <div class="pk-middle">
      <div class="pk-board" data-testid="table-board">
        <span v-for="card in boardCards" :key="card.text" class="pk-card" :class="`pk-${card.suitName}`">{{ card.rank }}<span aria-hidden="true">{{ card.suit }}</span></span>
        <span v-if="boardCards.length === 0" class="pk-nocards">no board yet</span>
      </div>
      <p class="pk-pot" data-testid="table-pot">pot {{ money(pot) }} <span class="pk-muted">({{ inBb(pot) }})</span></p>
    </div>

    <template v-for="(seat, index) in ordered" :key="seat.seat">
      <button
        type="button"
        class="pk-seat"
        :class="{ 'pk-acting': seat.seat === activeSeat, 'pk-folded': seat.folded, 'pk-hero': seat.isHero, 'pk-won': seat.wonHand }"
        :style="seatStyle(index)"
        :data-testid="`table-seat-${seat.seat}`"
        @click="emit('seatClick', seat.seat)"
      >
        <span class="pk-name">{{ seat.position }} · {{ seat.name }}</span>
        <span class="pk-cards">
          <template v-if="shownCards(seat.cards).length > 0">
            <span v-for="card in shownCards(seat.cards)" :key="card.text" class="pk-card pk-small" :class="`pk-${card.suitName}`">{{ card.rank }}<span aria-hidden="true">{{ card.suit }}</span></span>
          </template>
          <span v-else-if="!seat.folded" class="pk-back" aria-label="face down">🂠🂠</span>
        </span>
        <span class="pk-stack">{{ inBb(seat.stack) }}<span v-if="seat.allIn" class="pk-allin"> all in</span><span v-if="handOver && seat.wonHand" class="pk-wins" :data-testid="`table-wins-${seat.seat}`"> wins the pot</span></span>
        <span v-if="seat.seat === buttonSeat" class="pk-button" aria-label="dealer button">D</span>
      </button>
      <span v-if="seat.committed > 0" class="pk-chips" :style="chipStyle(index)" :data-testid="`table-chips-${seat.seat}`">{{ money(seat.committed) }}</span>
      <span v-if="lastAction !== '' && seat.seat === lastSeat" class="pk-bubble" :style="chipStyle(index)" data-testid="table-last-action">{{ lastAction }}</span>
    </template>
  </div>
</template>

<style scoped>
.pk-table {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  color: var(--pk-fg, #18181b);
  font-size: 0.8rem;
  container-type: inline-size;
}
.pk-felt {
  position: absolute;
  inset: 8% 4%;
  border-radius: 50%;
  background: var(--pk-surface, #f4f4f5);
  border: 2px solid var(--pk-border, #d4d4d8);
}
.pk-middle {
  position: absolute;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  text-align: center;
}
.pk-board {
  display: flex;
  gap: 0.2rem;
  justify-content: center;
  min-height: 1.6rem;
}
.pk-pot {
  margin: 0.35rem 0 0;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.pk-nocards {
  color: var(--pk-muted, #71717a);
}
.pk-card {
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.25rem;
  border-radius: 0.2rem;
  background: var(--pk-bg, #fff);
  border: 1px solid var(--pk-border, #d4d4d8);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pk-small {
  padding: 0 0.15rem;
  font-size: 0.75rem;
}
.pk-club {
  color: var(--pk-club, #16a34a);
}
.pk-diamond {
  color: var(--pk-diamond, #2563eb);
}
.pk-heart {
  color: var(--pk-heart, #dc2626);
}
.pk-spade {
  color: var(--pk-spade, #18181b);
}
.pk-seat {
  position: absolute;
  transform: translate(-50%, -50%);
  display: grid;
  gap: 0.1rem;
  justify-items: center;
  min-width: 6.5rem;
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 0.4rem;
  background: var(--pk-bg, #fff);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.pk-seat:focus-visible {
  outline: 2px solid var(--pk-accent, #2563eb);
  outline-offset: 2px;
}
.pk-acting {
  border-color: var(--pk-accent, #2563eb);
  box-shadow: 0 0 0 2px var(--pk-accent, #2563eb);
}
.pk-hero .pk-name {
  color: var(--pk-hero, #2563eb);
}
.pk-folded {
  opacity: 0.45;
}
.pk-won {
  border-color: var(--pk-fill-strong, #16a34a);
}
.pk-name {
  font-weight: 600;
  max-width: 8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pk-cards {
  display: flex;
  gap: 0.15rem;
  min-height: 1rem;
}
.pk-back {
  color: var(--pk-muted, #71717a);
}
.pk-stack {
  font-variant-numeric: tabular-nums;
  color: var(--pk-muted, #71717a);
}
.pk-allin {
  color: var(--pk-villain, #c2410c);
  font-weight: 600;
}
.pk-wins {
  color: var(--pk-fill-strong, #16a34a);
  font-weight: 600;
}
.pk-button {
  position: absolute;
  right: -0.6rem;
  top: -0.6rem;
  width: 1.15rem;
  height: 1.15rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--pk-fg, #18181b);
  color: var(--pk-bg, #fff);
  font-size: 0.7rem;
  font-weight: 700;
}
.pk-chips,
.pk-bubble {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: 0.05rem 0.3rem;
  border-radius: 0.6rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pk-chips {
  background: var(--pk-highlight, #f59e0b);
  color: #18181b;
  font-weight: 600;
}
.pk-bubble {
  transform: translate(-50%, 0.9rem);
  background: var(--pk-fg, #18181b);
  color: var(--pk-bg, #fff);
}
.pk-muted {
  color: var(--pk-muted, #71717a);
  font-weight: 400;
}
@container (max-width: 34rem) {
  .pk-seat {
    min-width: 4.5rem;
    font-size: 0.7rem;
  }
}
</style>
