import { accelNeed, readAccelDomain } from '../core/accelerators';
import { LOC } from '../core/buffers';
import { ACCEL_CLOCKS, ACCEL_DOMAINS, MAX_ACCELS, POOL_DOMAIN } from '../core/constants';
import type { World } from '../core/world';
import { accelClockAt, accelClockIndex, anchorAccelDomain } from './accelerators';
import { sortedInsert } from './lists';
import { partClock } from './memory';
import { GPU, shapeOf } from './shape';

export interface HardwareAccelAssignment { readonly domain: number; readonly held: number }

/** Prefer the same device; linked/unlinked configurations can retain compatible jobs. */
export function hardwareAccelAssignment(w: World, r: number, used: Float64Array, preferred: number): HardwareAccelAssignment | null {
  const rec = w.hot.rec, s = rec.owner[r]!, shape = shapeOf(rec.family[r]!), need = accelNeed(shape.def, rec.units[r]!);
  if (!need.required) return { domain: -1, held: 0 };
  const held = Math.max(0, need.vramBits - rec.vramR[r]! - rec.vramD[r]!);
  const choices = [preferred, ...Array.from({ length: ACCEL_DOMAINS }, (_, d) => d).filter(d => d !== preferred)];
  for (const d of choices) {
    const hardware = readAccelDomain(w.compiled, s, d);
    if (!hardware || hardware.kind === 'npu' && !need.tensor || hardware.gpuCores < need.gpuCores
      || (need.tensor ? hardware.tensorOpsPerS : hardware.opsPerS) <= 0) continue;
    const at = s * ACCEL_DOMAINS + d;
    if (held * rec.count[r]! > hardware.vramBits - used[at]!) continue;
    used[at] = used[at]! + held * rec.count[r]!;
    return { domain: d, held };
  }
  return null;
}

/** Rebind device holds and GPU work clocks without losing the work already performed. */
export function rebaseHardwareAccelerators(w: World, old: World, systems: ReadonlySet<number>, assignments: ReadonlyMap<number, HardwareAccelAssignment>): void {
  const h = w.hot.sys, rec = w.hot.rec;
  for (const s of systems) {
    const e = w.hot.rack.effClock[w.compiled.sys.rack[s]!]!;
    const stages: { r: number; remaining: number; done: number }[] = [];
    let base = 0;
    for (const [r] of assignments) {
      if (rec.loc[r] !== LOC.running || rec.owner[r] !== s || rec.accelDomain[r]! < 0) continue;
      const shape = shapeOf(rec.family[r]!);
      if (partClock(shape, rec.stage[r]!, rec.part[r]!) !== GPU) continue;
      const index = accelClockIndex(s, rec.accelDomain[r]!, shape.tensor);
      const remaining = Math.max(0, rec.finish[r]! - accelClockAt(old, index, e));
      const done = Math.max(0, rec.finish[r]! - rec.start[r]! - remaining);
      stages.push({ r, remaining, done }); base = Math.max(base, done);
    }
    for (let d = 0; d < ACCEL_DOMAINS; d++) {
      h.accelUsedVram[s * ACCEL_DOMAINS + d] = 0; h.accelHolders[s * ACCEL_DOMAINS + d] = 0;
    }
    for (let a = 0; a < ACCEL_CLOCKS; a++) {
      const i = s * ACCEL_CLOCKS + a;
      h.accelHead[i] = -1; h.accelActive[i] = 0; h.accelWAnchor[i] = base; h.accelEAnchor[i] = e; h.accelRate[i] = 0; h.accelDue[i] = Infinity;
    }
    for (let slot = 0; slot < MAX_ACCELS; slot++) { h.accelTaskS[s * MAX_ACCELS + slot] = 0; h.accelResearchS[s * MAX_ACCELS + slot] = 0; }
    h.usedVram[s] = 0;
    for (const [r, assignment] of assignments) {
      if (rec.loc[r] !== LOC.running || rec.owner[r] !== s || assignment.domain < 0) continue;
      rec.accelDomain[r] = assignment.domain;
      const i = s * ACCEL_DOMAINS + assignment.domain, k = rec.count[r]!;
      h.accelUsedVram[i] = h.accelUsedVram[i]! + assignment.held * k;
      h.accelHolders[i] = h.accelHolders[i]! + k; h.usedVram[s] = h.usedVram[s]! + assignment.held * k;
    }
    for (const { r, remaining, done } of stages) {
      const i = accelClockIndex(s, rec.accelDomain[r]!, shapeOf(rec.family[r]!).tensor);
      rec.start[r] = base - done; rec.finish[r] = base + remaining;
      sortedInsert(w.hot, h.accelHead, i, r); h.accelActive[i] = h.accelActive[i]! + rec.count[r]!;
    }
    for (let d = 0; d <= POOL_DOMAIN; d++) anchorAccelDomain(w, s, d, e);
  }
}
