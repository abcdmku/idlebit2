/**
 * Per-tick accumulators for the power and thermal passes. Not state: every slot is zeroed before
 * use, and nothing reads them across ticks, so reusing the arrays keeps the tick allocation-free.
 */
const pool = new Map<string, Float64Array>();

/** A zeroed Float64Array of at least `n` entries, reused under `key`. */
export function scratch(key: string, n: number): Float64Array {
  let a = pool.get(key);
  if (!a || a.length < n) {
    a = new Float64Array(Math.max(8, n * 2));
    pool.set(key, a);
  } else {
    a.fill(0, 0, n);
  }
  return a;
}
