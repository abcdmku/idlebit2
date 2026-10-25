import type { World } from '../../core/world';
import type { RouteStrategyId } from '../../types/catalog';

/**
 * Network strategies under D25 (spec §8.3, §7.7 step 4). A strategy sets the walk order of a
 * router's candidates and each candidate's weight (its share size). `plan` reorders cand / slot
 * (child unit ids and child slots, in slot order on entry, already filtered) into walk order, fills
 * weight[0..n) and returns how many candidates stay (binPack and affinity may keep fewer). Record r
 * is the entry being split, with `units` set to the share at this router. `weighted` strategies give
 * the n shards to the n largest weights (ties in walk order); the others to the first n in walk
 * order. No RNG; a strategy may write only its own router's cursor, and only in `used`, which runs
 * when the split is reserved.
 */
export interface RouteStrategy {
  readonly id: RouteStrategyId;
  readonly weighted: boolean;
  plan(w: World, kind: number, id: number, r: number, cand: Int32Array, slot: Int32Array, weight: Float64Array, n: number): number;
  /** After the split is reserved: `lastSlot` is the last child slot in walk order that got a share. */
  used?(w: World, kind: number, id: number, lastSlot: number): void;
}

/** Equal weights over the first n candidates. */
export function equal(weight: Float64Array, n: number): number {
  weight.fill(1, 0, n);
  return n;
}

/** Stable sort of the first n candidates by key ascending (ties keep their order); weights follow. */
export function sortBy(cand: Int32Array, slot: Int32Array, weight: Float64Array, n: number, key: (i: number) => number): void {
  if (sortKey.length < n) { sortKey = new Float64Array(n * 2); sortC = new Int32Array(n * 2); sortS = new Int32Array(n * 2); sortW = new Float64Array(n * 2); }
  // Insertion sort (stable; n is at most a router's fan-out), entries moved as (key, cand, slot, weight).
  for (let i = 0; i < n; i += 1) {
    const k = key(i), c = cand[i]!, s = slot[i]!, wt = weight[i]!;
    let j = i - 1;
    // NaN keys compare as the old comparator did: never before another entry (k - x is NaN, falsy).
    while (j >= 0 && sortKey[j]! - k > 0) { sortKey[j + 1] = sortKey[j]!; sortC[j + 1] = sortC[j]!; sortS[j + 1] = sortS[j]!; sortW[j + 1] = sortW[j]!; j -= 1; }
    sortKey[j + 1] = k; sortC[j + 1] = c; sortS[j + 1] = s; sortW[j + 1] = wt;
  }
  for (let i = 0; i < n; i += 1) { cand[i] = sortC[i]!; slot[i] = sortS[i]!; weight[i] = sortW[i]!; }
}
let sortKey = new Float64Array(64), sortC = new Int32Array(64), sortS = new Int32Array(64), sortW = new Float64Array(64);

/** Keeps the candidates passing `keep` (in order); when none does, keeps all. Returns the count. */
export function keepIf(cand: Int32Array, slot: Int32Array, n: number, keep: (i: number) => boolean): number {
  const pass: boolean[] = [];
  let k = 0;
  for (let i = 0; i < n; i += 1) { pass.push(keep(i)); if (pass[i]) k += 1; }
  if (k === 0 || k === n) return n;
  let j = 0;
  for (let i = 0; i < n; i += 1) if (pass[i]) { cand[j] = cand[i]!; slot[j] = slot[i]!; j += 1; }
  return j;
}
