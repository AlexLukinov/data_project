import type { RakeConfig } from '@poker/core';
import { NO_RAKE } from '@poker/core';
import { sameDecimal } from '@poker/ui';
import type { ComputedRef, Ref } from 'vue';
import { computed, ref, watch } from 'vue';

/** The numbers a spot or a hand step puts in front of the reader. */
export interface OddsSource {
  pot: number;
  bet: number;
  /** The amount to call; absent or `null` means it equals the bet. */
  call?: number | null;
  rakeConfig?: RakeConfig;
}

/** The pot-odds panels' numbers, editable, with the way back to the source's. */
export interface EditableOdds {
  pot: Ref<number>;
  bet: Ref<number>;
  call: Ref<number | null>;
  rakeConfig: Ref<RakeConfig>;
  impliedExtra: Ref<number>;
  /** True while any number differs from the source's. */
  edited: ComputedRef<boolean>;
  /** Put every number back to the source's. */
  reset(): void;
}

/** No source has an implied extra: it is the reader's own estimate of what is won later. */
const NO_IMPLIED_EXTRA = 0;

function sameOrBothNull(a: number | null, b: number | null): boolean {
  return a === null || b === null ? a === b : sameDecimal(a, b);
}

function sameRake(a: RakeConfig, b: RakeConfig): boolean {
  return sameDecimal(a.rakePct, b.rakePct) && sameOrBothNull(a.rakeCapBB, b.rakeCapBB);
}

/**
 * `PotOddsPanel` and `MDFPanel` render their numbers as inputs, and a panel mounted on someone
 * else's numbers — a hand's step, a trainer's spot — used to accept typing and change nothing
 * (POKER_UX_AUDIT.md §2.1). These are the refs to bind them to: seeded from `source`,
 * re-seeded whenever what `source` reads changes (a new step, a new spot), with `edited` to say
 * the screen no longer shows the source's numbers and `reset` to bring them back.
 *
 * Numbers compare as the screen writes them, so a pot of `0.35 - 0.1` typed back as `0.25` is
 * not an edit.
 */
export function useEditableOdds(source: () => OddsSource): EditableOdds {
  const pot = ref(0);
  const bet = ref(0);
  const call = ref<number | null>(null);
  const rakeConfig = ref<RakeConfig>(NO_RAKE);
  const impliedExtra = ref(NO_IMPLIED_EXTRA);

  function seed(from: OddsSource): void {
    pot.value = from.pot;
    bet.value = from.bet;
    call.value = from.call ?? null;
    rakeConfig.value = from.rakeConfig ?? NO_RAKE;
    impliedExtra.value = NO_IMPLIED_EXTRA;
  }

  const edited = computed(() => {
    const from = source();
    return (
      !sameDecimal(pot.value, from.pot) ||
      !sameDecimal(bet.value, from.bet) ||
      !sameOrBothNull(call.value, from.call ?? null) ||
      !sameRake(rakeConfig.value, from.rakeConfig ?? NO_RAKE) ||
      impliedExtra.value !== NO_IMPLIED_EXTRA
    );
  });

  watch(source, seed, { immediate: true });
  return { pot, bet, call, rakeConfig, impliedExtra, edited, reset: () => seed(source()) };
}
