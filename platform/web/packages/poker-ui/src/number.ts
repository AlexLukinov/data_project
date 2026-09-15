/**
 * Numbers a reader types (ADR-053). Everything this app prints writes a number with a dot; a
 * reader on a comma-decimal locale (the founder's Mac is `ru_RU`) types a comma. Both are read,
 * and nothing beyond that is guessed: a comma is always the decimal separator, never a
 * thousands separator, so `1,000` is one.
 */

const DECIMAL = /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
/** Enough digits for any figure on screen, few enough to drop float noise (`0.07 * 100`). */
const SIGNIFICANT_DIGITS = 12;

/**
 * `2.5`, `2,5`, `-0,75`, `.5` and `5.` as numbers; `null` for anything else — empty text,
 * `2..5`, `1,000.5`, `1e3`, `5%`.
 */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  return Number(trimmed.replace(',', '.'));
}

/** The number with float noise removed: `0.07 * 100` is `7`, not `7.000000000000001`. */
export function cleanDecimal(value: number): number {
  return Number(value.toPrecision(SIGNIFICANT_DIGITS));
}

/** A number as this app writes it: a dot, no grouping, no float noise. */
export function formatDecimal(value: number): string {
  return String(cleanDecimal(value));
}

/** Whether two numbers read the same once float noise is gone (`28` and `0.28 * 100`). */
export function sameDecimal(a: number, b: number): boolean {
  return cleanDecimal(a) === cleanDecimal(b);
}
