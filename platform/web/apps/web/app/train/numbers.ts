/**
 * How a training answer is spelled.
 *
 * `PredictionGate` compares answers as strings and parses numeric ones with `Number()`, so an
 * answer must be a bare number — "33.5", never "33.5%". The gate adds the unit itself.
 */
const PERCENT = 100;
const PLACES = 1;

/** A share in 0..1 as percentage points, to one decimal: `0.3348` → `"33.5"`. */
export function pct(share: number): string {
  if (!Number.isFinite(share)) return '';
  return dp(share * PERCENT);
}

/** A number to at most `places` decimals, with no trailing zero: `24` stays `"24"`. */
export function dp(value: number, places = PLACES): string {
  if (!Number.isFinite(value)) return '';
  return String(Number(value.toFixed(places)));
}
