/**
 * A small seeded generator (mulberry32) so Monte Carlo runs and tests are reproducible: the
 * same seed always yields the same sequence, and a failure can be replayed.
 */
export type Random = () => number;

export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed for runs that need not be reproducible. */
export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
