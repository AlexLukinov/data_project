/**
 * The six training modes of spec §16, as data: what each one drills and why it is worth drilling.
 *
 * The wording lives here rather than inside six components for the same reason the analyzer's
 * nine questions live in `analyze/steps.ts` — so the whole curriculum can be read in one list.
 * The questions themselves belong to the spot, not to the mode, because most of them change with
 * the board (the precedent is `blockerQuestion` in `analyze/steps.ts`).
 */
import type { TrainMode } from './types';

export interface ModeDef {
  readonly mode: TrainMode;
  readonly title: string;
  /** One line under the title: what this mode is for. */
  readonly purpose: string;
  /** Why it is worth the ten minutes. */
  readonly blurb: string;
}

export const MODES: readonly ModeDef[] = [
  {
    mode: 'equity',
    title: 'Equity',
    purpose: 'Guess how much of the pot a hand or a range is worth, then see the exact number.',
    blurb: 'Three tiers in turn: your hand against a range, two ranges preflop, two ranges on a flop.',
  },
  {
    mode: 'combos',
    title: 'Combo counting',
    purpose: 'Count what is actually in a range — before and after the board takes cards away.',
    blurb: 'The arithmetic everything else rests on: 6 pair combos, 4 suited, 12 offsuit, fewer once the board is out.',
  },
  {
    mode: 'drawing',
    title: 'Range drawing',
    purpose: 'Draw a chart from memory and see every cell you got wrong.',
    blurb: 'Scored on total absolute weight error against the reference chart, with a per-cell mistake heatmap.',
  },
  {
    mode: 'blockers',
    title: 'Blockers',
    purpose: 'Pick the best bluff of four candidates against a calling range.',
    blurb: 'A good bluff blocks their calls and unblocks their folds — the part of range thinking hardest to eyeball.',
  },
  {
    mode: 'advantage',
    title: 'Range and nut advantage',
    purpose: 'Say who is ahead on this board, then how the nutted combos split.',
    blurb: 'Range advantage buys frequency, nut advantage buys size. Guess both before you look.',
  },
  {
    mode: 'potodds',
    title: 'Pot odds and MDF',
    purpose: 'Quick-fire arithmetic: MDF, alpha, required equity, bluff break-even, raw and after rake.',
    blurb: 'These are the numbers you need at the table in two seconds, not in two minutes.',
  },
];

export const TRAIN_MODES: readonly TrainMode[] = MODES.map((m) => m.mode);

const BY_MODE = new Map<string, ModeDef>(MODES.map((m) => [m.mode, m]));

/** Whether a route parameter names one of the six modes. */
export function isTrainMode(value: string): value is TrainMode {
  return BY_MODE.has(value);
}

/** The definition of a mode. Throws on an unknown one rather than rendering an empty page. */
export function modeDef(mode: TrainMode): ModeDef {
  const found = BY_MODE.get(mode);
  if (found === undefined) throw new RangeError(`no such training mode: ${mode}`);
  return found;
}
