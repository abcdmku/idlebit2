import { accelNeed, readAccelDomain, type AccelChoice } from '../core/accelerators';
import { ACCEL_CLOCKS, ACCEL_DOMAINS, MAX_ACCELS, POOL_DOMAIN } from '../core/constants';
import { dirtySystem } from '../core/touch';
import type { World } from '../core/world';
import { sortedInsert, sortedUnlink } from './lists';
import { taskShare } from './research';
import { GPU, NRES, shapeOf } from './shape';
import { runsTasks } from './slots';

/** Free VRAM on domain d of system s. */
function readFree(w: World, s: number, d: number): number {
  const dom = readAccelDomain(w.compiled, s, d);
  return dom ? dom.vramBits - w.hot.sys.accelUsedVram[s * ACCEL_DOMAINS + d]! : 0;
}

export const accelClockIndex = (s: number, domain: number, tensor: boolean): number => s * ACCEL_CLOCKS + 2 * domain + Number(tensor);
export const recordAccelClock = (w: World, s: number, r: number): number =>
  accelClockIndex(s, w.hot.rec.accelDomain[r]!, shapeOf(w.hot.rec.family[r]!).tensor);

export function accelClockAt(w: World, i: number, e: number): number {
  const h = w.hot.sys;
  return h.accelWAnchor[i]! + h.accelRate[i]! * (e - h.accelEAnchor[i]!);
}

export function refreshAccelDue(w: World, i: number): void {
  const h = w.hot.sys, head = h.accelHead[i]!, rate = h.accelRate[i]!;
  h.accelDue[i] = head < 0 || !(rate > 0) || w.hot.rec.finish[head] === Infinity ? Infinity
    : h.accelEAnchor[i]! + (w.hot.rec.finish[head]! - h.accelWAnchor[i]!) / rate;
}

/**
 * Uncontended [ops/s, tensor ops/s] of one domain into `out`: readAccelDomain's rates in the same
 * summation order, without allocating, and 0 for a domain that does not exist.
 */
function domainRates(w: World, s: number, domain: number, out: Float64Array): void {
  const c = w.compiled.sys, linked = c.gpuLinked[s] === 1;
  out[0] = 0; out[1] = 0;
  if (domain === POOL_DOMAIN) {
    if (!linked) return;
    let ops = 0, tensor = 0;
    for (let slot = 0; slot < MAX_ACCELS; slot += 1) {
      const p = s * MAX_ACCELS + slot;
      if (c.accelKind[p] !== 1) continue;
      ops += c.accelOps[p]!; tensor += c.accelTensorOps[p]!;
    }
    out[0] = ops; out[1] = tensor;
    return;
  }
  const p = s * MAX_ACCELS + domain, kind = c.accelKind[p];
  if (kind !== 1 && kind !== 2 || kind === 1 && linked) return;
  out[0] = kind === 1 ? c.accelOps[p]! : 0; out[1] = c.accelTensorOps[p]!;
}
const rates = new Float64Array(2);

/** Re-anchors domain `domain`'s two clocks (from clock index i) at `factor` × its uncontended rates. */
function anchorPair(w: World, s: number, domain: number, i: number, factor: number, e: number): void {
  const h = w.hot.sys;
  domainRates(w, s, domain, rates);
  for (let t = 0; t < 2; t += 1) {
    const j = i + t;
    const rate = rates[t]! * factor;
    if (h.accelRate[j] !== rate) {
      h.accelWAnchor[j] = accelClockAt(w, j, e);
      h.accelEAnchor[j] = e;
      h.accelRate[j] = rate;
    }
    refreshAccelDue(w, j);
  }
}

const runShareOf = (w: World, s: number, share: number): number =>
  runsTasks(w.hot.sys.mode[s]!) && w.round.phase === 'running' ? share : 0;

/** Settle both work modes before changing their shared contention denominator. */
export function anchorAccelDomain(w: World, s: number, domain: number, e: number, share = taskShare(w)): void {
  const h = w.hot.sys, i = accelClockIndex(s, domain, false);
  const n = h.accelActive[i]! + h.accelActive[i + 1]!;
  anchorPair(w, s, domain, i, n > 0 ? w.compiled.sys.etaCfg[s]! * runShareOf(w, s, share) / n : 0, e);
  dirtySystem(w, s);
}

/**
 * anchorAccelDomain for every domain of system s, as a visit does at the start of its tick. A
 * domain with no work, zero rates and no due time would be re-anchored to exactly that, so it
 * is passed over.
 */
export function anchorAccelDomains(w: World, s: number, e: number, share: number): void {
  const h = w.hot.sys, eta = w.compiled.sys.etaCfg[s]!, runShare = runShareOf(w, s, share);
  for (let domain = 0; domain < ACCEL_DOMAINS; domain += 1) {
    const i = s * ACCEL_CLOCKS + 2 * domain;
    const n = h.accelActive[i]! + h.accelActive[i + 1]!;
    if (n === 0 && h.accelRate[i] === 0 && h.accelRate[i + 1] === 0
      && h.accelDue[i] === Infinity && h.accelDue[i + 1] === Infinity) continue;
    anchorPair(w, s, domain, i, n > 0 ? eta * runShare / n : 0, e);
  }
  dirtySystem(w, s);
}

export function insertAccelStage(w: World, s: number, r: number, e: number): void {
  const h = w.hot.sys, i = recordAccelClock(w, s, r), k = w.hot.rec.count[r]!;
  sortedInsert(w.hot, h.accelHead, i, r);
  h.accelActive[i] = h.accelActive[i]! + k;
  h.active[s * NRES + GPU] = h.active[s * NRES + GPU]! + k;
  anchorAccelDomain(w, s, w.hot.rec.accelDomain[r]!, e);
}

export function removeAccelStage(w: World, s: number, r: number, e: number): void {
  const h = w.hot.sys, i = recordAccelClock(w, s, r), k = w.hot.rec.count[r]!;
  sortedUnlink(w.hot, h.accelHead, i, r);
  h.accelActive[i] = h.accelActive[i]! - k;
  h.active[s * NRES + GPU] = h.active[s * NRES + GPU]! - k;
  anchorAccelDomain(w, s, w.hot.rec.accelDomain[r]!, e);
}

/** VRAM one task of record r holds on its card: its need less any unified-memory overflow (D26.4). */
export const heldVram = (w: World, r: number): number =>
  Math.max(0, accelNeed(shapeOf(w.hot.rec.family[r]!).def, w.hot.rec.units[r]!).vramBits - w.hot.rec.vramR[r]! - w.hot.rec.vramD[r]!);

/** Reserve the selected physical card/pool for the record's entire lifetime (before its memory is placed). */
export function holdAccel(w: World, s: number, r: number, choice: AccelChoice): void {
  const rec = w.hot.rec, h = w.hot.sys, k = rec.count[r]!;
  const need = accelNeed(shapeOf(rec.family[r]!).def, rec.units[r]!);
  if (!need.required) return;
  const free = Math.max(0, readFree(w, s, choice.domain));
  if (rec.accelDomain[r] !== -1 || choice.take < k || choice.held * k > free + 1e-9 || (choice.held < need.vramBits && k !== 1)) {
    throw new Error('holdAccel: invalid accelerator reservation');
  }
  const i = s * ACCEL_DOMAINS + choice.domain;
  rec.accelDomain[r] = choice.domain;
  h.accelHolders[i] = h.accelHolders[i]! + k;
  h.accelUsedVram[i] = h.accelUsedVram[i]! + k * choice.held;
  h.usedVram[s] = h.usedVram[s]! + k * choice.held;
  dirtySystem(w, s);
}

/** Repeated release is harmless; the last holder removes subtraction roundoff. */
export function releaseAccel(w: World, s: number, r: number): void {
  const rec = w.hot.rec, h = w.hot.sys, domain = rec.accelDomain[r]!;
  if (domain < 0) return;
  const i = s * ACCEL_DOMAINS + domain, k = rec.count[r]!;
  const bits = heldVram(w, r) * k;
  h.accelHolders[i] = h.accelHolders[i]! - k;
  h.accelUsedVram[i] = h.accelHolders[i] === 0 ? 0 : h.accelUsedVram[i]! - bits;
  rec.accelDomain[r] = -1;
  let used = 0;
  for (let d = 0; d < ACCEL_DOMAINS; d += 1) used += h.accelUsedVram[s * ACCEL_DOMAINS + d]!;
  h.usedVram[s] = used;
  dirtySystem(w, s);
}

/** Clear execution state only. Completed-tick duty must survive failures until power is billed. */
export function resetAccelerators(w: World, s: number): void {
  const h = w.hot.sys;
  for (let d = 0; d < ACCEL_DOMAINS; d += 1) {
    const i = s * ACCEL_DOMAINS + d;
    h.accelUsedVram[i] = 0; h.accelHolders[i] = 0;
  }
  for (let k = 0; k < ACCEL_CLOCKS; k += 1) {
    const i = s * ACCEL_CLOCKS + k;
    h.accelHead[i] = -1; h.accelActive[i] = 0; h.accelRate[i] = 0;
    h.accelWAnchor[i] = 0; h.accelEAnchor[i] = 0; h.accelDue[i] = Infinity;
  }
  h.usedVram[s] = 0;
}
