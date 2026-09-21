/**
 * Which catalogue entry a path is on.
 *
 * The catalogue spells its routes the way `app/pages/` spells its files — `/hands/[id]`,
 * `/reports/[[id]]` — so that the coverage test can compare the two sets literally rather than
 * guess at Nuxt's route names. That leaves one job for runtime: matching a live path back to a
 * pattern. It is a dozen lines of segment comparison, pure, and tested without a router.
 */

/** `[id]` or `[[id]]`; a trailing `[[…]]` is the one segment a path may leave out. */
const PARAM = /^\[\[(.+)\]\]$|^\[(.+)\]$/;

interface Part {
  readonly literal: string;
  readonly param: boolean;
  readonly optional: boolean;
}

function segments(path: string): string[] {
  return path.split('/').filter((piece) => piece !== '');
}

export function routeParts(route: string): Part[] {
  return segments(route).map((raw) => {
    const found = PARAM.exec(raw);
    if (found === null) return { literal: raw, param: false, optional: false };
    return { literal: raw, param: true, optional: found[1] !== undefined };
  });
}

/**
 * How well a pattern fits a path: the number of literal segments it matched, or `-1` for no fit.
 * The count is the tie-break — `/pool/cohorts` beats nothing else, but `/hands` and `/hands/[id]`
 * are told apart by length, and a literal always outscores a parameter of the same shape.
 */
export function fit(route: string, path: string): number {
  const parts = routeParts(route);
  const given = segments(path);
  const required = parts.filter((part) => !part.optional).length;
  if (given.length < required || given.length > parts.length) return -1;
  let literals = 0;
  for (const [index, part] of parts.entries()) {
    const value = given[index];
    if (value === undefined) continue;
    if (part.param) continue;
    if (part.literal !== value) return -1;
    literals += 1;
  }
  return literals;
}

/**
 * An address a link can actually use. A route with a parameter in it — `/hands/[id]` — names no
 * page on its own, so the link goes to the nearest ancestor that does: the list the row is in.
 */
export function linkFor(route: string): string {
  const kept = routeParts(route).filter((part) => !part.param);
  return kept.length === 0 ? '/' : `/${kept.map((part) => part.literal).join('/')}`;
}

/** The best-fitting route of `routes` for `path`, or `null` when none of them fits. */
export function bestRoute(routes: readonly string[], path: string): string | null {
  let best: string | null = null;
  let score = -1;
  for (const route of routes) {
    const fitted = fit(route, path);
    if (fitted > score) {
      score = fitted;
      best = route;
    }
  }
  return score < 0 ? null : best;
}
