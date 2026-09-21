/**
 * The tool catalogue: every screen of the app, described once (plan F.13, ADR-058).
 *
 * The entries are split across files by area only because one file of twenty-four of them would
 * pass three hundred lines; `~/help/tools` is still the one import path, and `tools.test.ts` is
 * still the one guard. What the entries may and may not say is in `./types.ts`.
 */
import { ANALYZE_TOOLS } from './analyze';
import { AROUND_TOOLS } from './around';
import { HAND_TOOLS } from './hands';
import { bestRoute } from './match';
import { MY_GAME_TOOLS } from './myGame';
import { POOL_TOOLS } from './pool';
import { RANGE_TOOLS } from './ranges';
import { TRAIN_TOOLS } from './train';
import type { Tool, ToolArea } from './types';
import { AREAS } from './types';

export type { AccountNeed, Tool, ToolArea } from './types';
export { AREAS } from './types';
export { bestRoute, fit, linkFor, routeParts } from './match';

/** Every tool, in the order the areas are read and the nav is laid out. */
export const TOOLS: readonly Tool[] = [
  ...MY_GAME_TOOLS,
  ...POOL_TOOLS,
  ...HAND_TOOLS,
  ...ANALYZE_TOOLS,
  ...RANGE_TOOLS,
  ...TRAIN_TOOLS,
  ...AROUND_TOOLS,
];

const BY_ID = new Map<string, Tool>(TOOLS.map((tool) => [tool.id, tool]));
const BY_ROUTE = new Map<string, Tool>(TOOLS.map((tool) => [tool.route, tool]));
const ROUTES: readonly string[] = TOOLS.map((tool) => tool.route);

/** The tool with this id, or `null` — a caller showing related tools skips what it cannot find. */
export function toolById(id: string): Tool | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The tool a live path is on, or `null` for a path no tool claims — `/dev/*`, `/login`,
 * `/register`, and anything that is not a route at all.
 */
export function toolForPath(path: string): Tool | null {
  const route = bestRoute(ROUTES, path);
  return route === null ? null : (BY_ROUTE.get(route) ?? null);
}

/** The catalogue grouped for reading: the areas in order, each with its tools in order. */
export function toolsByArea(): readonly { readonly area: ToolArea; readonly tools: readonly Tool[] }[] {
  return AREAS.map((area) => ({ area, tools: TOOLS.filter((tool) => tool.area === area) })).filter(
    (group) => group.tools.length > 0,
  );
}
