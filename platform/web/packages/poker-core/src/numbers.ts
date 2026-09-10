/**
 * The shortest decimal that reads back as the same float32. Ranges hold float32 weights, so a
 * weight parsed from `1.005` must print as `1.005` again, not as the double `1.0049999952316284`.
 */
export function formatWeight(weight: number): string {
  const f = Math.fround(weight);
  for (let precision = 1; precision <= 9; precision++) {
    const candidate = Number(f.toPrecision(precision));
    if (Math.fround(candidate) === f) return String(candidate);
  }
  return String(f);
}
