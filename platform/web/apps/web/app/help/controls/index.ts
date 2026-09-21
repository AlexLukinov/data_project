/**
 * Every control the app explains, in one list (plan F.13, ADR-058). What may be said here, and
 * what belongs to the registry or to the vocabulary instead, is in `./types.ts`.
 */
import { DOING_CONTROLS } from './doing';
import { READING_CONTROLS } from './reading';
import type { ControlHelp } from './types';

export type { ControlHelp } from './types';
export { tipId } from './types';

export const CONTROLS: readonly ControlHelp[] = [...READING_CONTROLS, ...DOING_CONTROLS];

const BY_ID = new Map<string, ControlHelp>(CONTROLS.map((control) => [control.id, control]));

export function controlById(id: string): ControlHelp | null {
  return BY_ID.get(id) ?? null;
}
