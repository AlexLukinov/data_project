/**
 * One way in to all six trainers (spec §16): a mode and a seed make a spot, and a spot plus the
 * equity service makes its answers.
 *
 * The dispatch lives here rather than in the components so a trainer component never knows which
 * mode it is rendering the *question* for — it renders a `TrainSpot`, gates it, and scores it.
 * The answer is only ever asked for once a prediction has been committed (ADR-034): the truth is
 * fetched after the commit, not merely hidden.
 */
import type { EquityServiceLike } from '@poker/ui';

import * as advantage from './spot-advantage';
import * as blockers from './spot-blockers';
import * as combos from './spot-combos';
import * as drawing from './spot-drawing';
import * as equity from './spot-equity';
import * as potodds from './spot-potodds';
import type { SpotAnswers, TrainMode, TrainSpot } from './types';

/** What answering a spot may need. Only the two equity modes use the service. */
export interface AnswerDeps {
  readonly service: EquityServiceLike;
}

/** Build the spot a mode and a seed name. Deterministic: the same pair is the same spot. */
export function generateSpot(mode: TrainMode, seed: number): TrainSpot {
  switch (mode) {
    case 'equity':
      return equity.generate(seed);
    case 'combos':
      return combos.generate(seed);
    case 'drawing':
      return drawing.generate(seed);
    case 'blockers':
      return blockers.generate(seed);
    case 'advantage':
      return advantage.generate(seed);
    case 'potodds':
      return potodds.generate(seed);
  }
}

/**
 * What the spot's questions turn out to be, by question key.
 *
 * Four of the six are arithmetic and answer instantly; the two equity modes go through the
 * Worker, which is why this is async for all of them.
 */
export async function answersOf(spot: TrainSpot, deps: AnswerDeps): Promise<SpotAnswers> {
  switch (spot.mode) {
    case 'equity':
      return equity.answers(spot, deps.service);
    case 'advantage':
      return advantage.answers(spot, deps.service);
    case 'combos':
      return combos.answers(spot);
    case 'drawing':
      return drawing.answers(spot);
    case 'blockers':
      return blockers.answers(spot);
    case 'potodds':
      return potodds.answers(spot);
  }
}
