export interface SampleStats {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly mean: number;
}

/** Nearest-rank percentiles over wall-clock milliseconds. */
export function summarize(samples: ArrayLike<number>): SampleStats {
  const sorted = Float64Array.from(samples).sort();
  const count = sorted.length;
  if (count === 0) return { count: 0, p50: 0, p95: 0, max: 0, mean: 0 };
  const rank = (p: number) => sorted[Math.min(count - 1, Math.max(0, Math.ceil(p * count) - 1))];
  let total = 0;
  for (const value of sorted) total += value;
  return { count, p50: rank(0.5), p95: rank(0.95), max: sorted[count - 1], mean: total / count };
}

/** Runs `warmup` untimed iterations, then times `iterations` calls one by one. */
export function sampleLoop(iterations: number, warmup: number, body: () => void): SampleStats {
  for (let i = 0; i < warmup; i++) body();
  const samples = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    body();
    samples[i] = performance.now() - start;
  }
  return summarize(samples);
}

export const round3 = (value: number) => Math.round(value * 1000) / 1000;
