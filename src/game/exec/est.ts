import type { World } from '../core/world';
import { accelNeed, chooseAccel, readAccelDomain } from '../core/accelerators';
import { accelClockAt, recordAccelClock } from './accelerators';
import { CPU, GPU, IO, RAM, shapeOf, stageWorkAt, workingSetOf } from './shape';

/** Usable memory (spec §6.2 memCap): RAM capacity with any RAM module, otherwise cache. */
export const memOf = (w: World, s: number): number => {
  const c = w.compiled.sys;
  return c.hasRam[s] === 1 ? c.memCap[s]! : Math.max(c.memCap[s]!, c.cacheBits[s]!);
};

/** Hardware threads, at least 1. */
export const hwThreads = (w: World, s: number): number => Math.max(1, w.compiled.sys.threads[s]!);

/**
 * est(task) (η_cfg × e(T) scale compute and GPU, D7.5) (spec §8.1): the remaining duration of one task of record r on system s at the system's
 * current uncontended rates, compute at min(threads, hardware threads) threads. Infinity if a stage's
 * resource has no rate. Stages from `fromStage` on.
 */
export function estOn(w: World, s: number, family: number, scale: number, fromStage: number, gpuRate?: number, firstWork?: number): number {
  const shape = shapeOf(family);
  const c = w.compiled.sys;
  const eff = w.hot.rack.eff[c.rack[s]!]! * c.etaCfg[s]!;
  const clock = c.threadRate[s]! * w.hot.sys.clockFactor[s]! * eff;
  const accel = gpuRate ?? chooseAccel(w.compiled, null, s, accelNeed(shape.def, scale), 1)?.opsPerS ?? 0;
  let secs = 0;
  for (let i = fromStage; i < shape.stages; i += 1) {
    const work = i === fromStage && firstWork !== undefined ? firstWork : stageWorkAt(shape, i, scale);
    let rate = 0;
    switch (shape.res[i]) {
      case CPU: rate = Math.min(shape.threads, hwThreads(w, s)) * clock; break;
      case RAM: rate = c.ramBw[s]!; break;
      case GPU: rate = accel * eff; break;
      case IO: rate = c.ioRate[s]!; break;
    }
    if (work > 0) secs += rate > 0 ? work / rate : Infinity;
  }
  return secs;
}

export function estRecord(w: World, s: number, r: number): number {
  const rec = w.hot.rec, shape = shapeOf(rec.family[r]!), domain = rec.accelDomain[r]!;
  const d = domain < 0 ? null : readAccelDomain(w.compiled, s, domain);
  const gpuRate = d ? shape.tensor ? d.tensorOpsPerS : d.opsPerS : undefined;
  const stage = rec.stage[r]!;
  const remaining = domain >= 0 && shape.res[stage] === GPU
    ? Math.max(0, rec.finish[r]! - accelClockAt(w, recordAccelClock(w, s, r), w.hot.rack.effClock[w.compiled.sys.rack[s]!]!)) : undefined;
  return estOn(w, s, rec.family[r]!, rec.scale[r]!, stage, gpuRate, remaining);
}

/** True when one more task of record r fits next to the running tasks (memory D1.1, a free thread). */
export function startable(w: World, s: number, r: number, timeSlice: boolean): boolean {
  const h = w.hot.sys;
  if (!timeSlice && h.busyThreads[s]! >= hwThreads(w, s)) return false;
  const shape = shapeOf(w.hot.rec.family[r]!), size = w.hot.rec.scale[r]!;
  const ws = workingSetOf(shape, size);
  return h.usedMem[s]! + ws <= memOf(w, s) && chooseAccel(w.compiled, w.hot, s, accelNeed(shape.def, size), 1) !== null;
}
