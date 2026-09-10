/**
 * Equity realization (spec §8): EQR = (EV / pot) / equity, so EV = equity × EQR × pot. Above 1
 * a hand over-realizes its equity, below 1 it under-realizes. Where EV comes from — a solver
 * solution the user typed in, or the pool's mean result — is the caller's to label.
 */

/** EQR of a hand with expected value `ev` in a pot of `pot` and raw equity `equity` (0..1). */
export function equityRealization(ev: number, pot: number, equity: number): number {
  if (!(pot > 0)) throw new RangeError(`pot must be positive, got ${pot}`);
  if (!(equity > 0 && equity <= 1)) throw new RangeError(`equity must be in (0, 1], got ${equity}`);
  return ev / pot / equity;
}

/** The expected value implied by an equity, a realization factor and a pot. */
export function evFromRealization(equity: number, eqr: number, pot: number): number {
  if (!(pot > 0)) throw new RangeError(`pot must be positive, got ${pot}`);
  if (!(equity >= 0 && equity <= 1)) throw new RangeError(`equity must be in [0, 1], got ${equity}`);
  return equity * eqr * pot;
}
