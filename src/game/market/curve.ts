import type { FamilyDef } from '../types/catalog';

/** Round-age difficulty and seeded variation (docs/tasks.md §3, program D12.1). */
export const CURVE = {
  /** Ramp: one unit of I takes T(I) = min(Tmax, T0 × 2^(I / H)) seconds. D20: steep early, so an un-upgraded round 1 ends near 60 s. */
  T0: 7, H: 5, Tmax: 250,
  /** A round opens at max(0, previous peak I − startBack). */
  startBack: 6,
  sizeJit: 0.2, weightJit: 0.3, dataJit: 0.1,
  ramp: 1,
  sizeExp: 0.85,
} as const;

/** dI/dt in units of I per second. */
export const baseRate = (I: number): number => 1 / Math.min(CURVE.T0 * 2 ** (I / CURVE.H), CURVE.Tmax);
export const sizeScale = (I: number): number => 2 ** (CURVE.sizeExp * I);
/** The next round's opening intensity (D12.1). */
export const startIntensity = (peak: number): number => Math.max(0, peak - CURVE.startBack);

/**
 * Frozen task size s in whole units (D25.1, docs/tasks.md §2): round(U(I) × j), and at least
 * members × grain for a minimum-split task so every one of its shards holds a grain. An ordinary
 * task may be smaller than its grain: it is then one shard.
 */
export const taskSize = (I: number, jitter: number, members: number, grain: number): number =>
  Math.max(members > 1 ? members * grain : 1, Math.round(sizeScale(I) * jitter));
export const sizeJitter = (u: number): number => 1 + CURVE.sizeJit * (2 * u - 1);

/** Authored family weight at I, before round jitter. */
export function baseWeight(f: FamilyDef, I: number): number {
  const { from, to } = f.window;
  if (I <= from || I >= to) return 0;
  return f.weight * Math.min(1, (I - from) / CURVE.ramp, (to - I) / CURVE.ramp);
}
