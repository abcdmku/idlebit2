import type { World } from '../../core/world';
import type { RouteStrategyId } from '../../types/catalog';

/**
 * Network strategies (spec §8.3, architecture §1.6). `choose` picks one of n candidates of router
 * (kind, id) for record r and returns its index in cand. cand holds child unit ids and slot their
 * child slots, both in slot order, already filtered. A strategy may advance only its own router's
 * cursor or weighted counters. No RNG: ties go to the lowest slot.
 */
export interface RouteStrategy {
  readonly id: RouteStrategyId;
  choose(w: World, kind: number, id: number, r: number, cand: Int32Array, slot: Int32Array, n: number): number;
}

/** Index of the candidate with the lowest score; ties to the lowest slot (cand is in slot order). */
export function argmin(n: number, score: (i: number) => number): number {
  let best = 0, bestScore = score(0);
  for (let i = 1; i < n; i += 1) {
    const s = score(i);
    if (s < bestScore) { best = i; bestScore = s; }
  }
  return best;
}
