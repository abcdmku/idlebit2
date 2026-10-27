import type { FamilyDef } from '../types/catalog';

/** Task-count difficulty and seeded variation (docs/tasks.md §3, D30). */
export const CURVE = {
  /**
   * D30: every round starts at I = 0 and each task drawn advances I by 1 / k(I): k tasks per unit of I,
   * The recipe market uses a shorter opening quadratic. Beyond I14, the cubic term supplies more
   * fleet work. Hardware never changes this curve, only how fast a round moves along it.
   */
  k0: 7, k1: 0.25, k2: 0.025,
  fleetFrom: 14, fleetK: 0.25,
  sizeJit: 0.2, weightJit: 0.3, dataJit: 0.1,
  ramp: 1,
  sizeExp: 0.85,
} as const;

/** Tasks per unit of I at I (D30). */
export const tasksPerUnit = (I: number): number => CURVE.k0 + CURVE.k1 * I + CURVE.k2 * I * I
  + CURVE.fleetK * Math.max(0, I - CURVE.fleetFrom) ** 3;
/** The intensity after one more task is drawn at I (D30). */
export const nextIntensity = (I: number): number => I + 1 / tasksPerUnit(I);
export const sizeScale = (I: number): number => 2 ** (CURVE.sizeExp * I);

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
