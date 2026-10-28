const STEPS = [1, 1.5, 2, 3, 5, 7.5];
/** Report rung i, starting with 10 at i=1. First rewards begin at i=5, or 50. */
export const tierValue = (i: number): number => STEPS[(i - 1) % STEPS.length]! * 10 ** (1 + Math.floor((i - 1) / STEPS.length));
export function tierOf(met: number): number {
  let i = 0;
  while (tierValue(i + 1) <= met) i += 1;
  return i;
}
