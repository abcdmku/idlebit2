import type { FamilyDef } from '../types/catalog';

/** Task-count difficulty and seeded variation (docs/tasks.md §3, D30/D53). */
export const CURVE = {
  /**
   * D30: every round starts at I = 0 and each task drawn advances I by 1 / k(I): k tasks per unit of I,
   * The recipe market uses a shorter opening quadratic. Beyond I14, the cubic term supplies more
   * fleet work. Hardware never changes this curve, only how fast a round moves along it.
   */
  k0: 7, k1: 0.25, k2: 0.025,
  fleetFrom: 14, fleetK: 0.25,
  deadlineJit: 0.2, weightJit: 0.3, dataJit: 0.1,
  ramp: 1,
  sizeExp: 0.85,
  sizeCeiling: 8, minimumSizeChoices: 2,
  legacyWeight: 0.03,
} as const;

/** Tasks per unit of I at I (D30). */
export const tasksPerUnit = (I: number): number => CURVE.k0 + CURVE.k1 * I + CURVE.k2 * I * I
  + CURVE.fleetK * Math.max(0, I - CURVE.fleetFrom) ** 3;
/** The intensity after one more task is drawn at I (D30). */
export const nextIntensity = (I: number): number => I + 1 / tasksPerUnit(I);
export const sizeScale = (I: number): number => 2 ** (CURVE.sizeExp * I);

/**
 * Sample whole recipe repetitions across a logarithmic range, including small jobs at every I.
 * Each doubling has comparable probability. Minimum-split tasks still hold a grain per member.
 * Give even the smallest recipe multiple quantities instead of clamping most draws to one.
 */
export function taskSize(targetUnits: number, u: number, members: number, grain: number): number {
  const min = members > 1 ? members * grain : 1;
  const max = Math.max(min * CURVE.minimumSizeChoices, Math.floor(targetUnits * CURVE.sizeCeiling));
  const logSize = Math.log(min) + u * (Math.log(max + 1) - Math.log(min));
  return Math.max(min, Math.min(max, Math.floor(Math.exp(logSize))));
}
/** Completion windows retain ±20% variation from the same seeded draw. */
export const deadlineJitter = (u: number): number => 1 + CURVE.deadlineJit * (2 * u - 1);

/** Authored family weight at I, before round jitter. */
export function baseWeight(f: FamilyDef, I: number): number {
  const { from, to } = f.window;
  if (I <= from) return 0;
  const entering = Math.min(1, (I - from) / CURVE.ramp);
  const retiring = Math.max(CURVE.legacyWeight, Math.min(1, (to - I) / CURVE.ramp));
  return f.weight * entering * retiring;
}
