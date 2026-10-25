import type { World } from '../core/world';
import { accelNeed, chooseAccel, readAccelDomain } from '../core/accelerators';
import { accelClockAt, recordAccelClock } from './accelerators';
import { diskRate, freeHierarchy, staticFractions, unifiedRoom as unifiedRoomOf } from './memory';
import { CPU, GPU, RAM, shapeOf, stageWorkAt, wantThreads, workingSetOf } from './shape';

/** Hardware threads, at least 1. */
export const hwThreads = (w: World, s: number): number => Math.max(1, w.compiled.sys.threads[s]!);

const frac = new Float64Array(2);

/**
 * est(task) (η_cfg × e(T) scale compute and GPU, D7.5) (spec §8.1): the remaining duration of one task of record r on system s at the system's
 * current uncontended rates, compute at min(max(1, floor(units / grain)), hardware threads) threads (D25.3). Infinity if a stage's
 * resource has no rate. Stages from `fromStage` on. A mem stage costs its RAM and disk parts (D26.2) at the traffic fractions
 * `fr`, `fd` (a running shard's frozen ones; otherwise its working set placed in the empty hierarchy).
 */
export function estOn(w: World, s: number, family: number, scale: number, fromStage: number, gpuRate?: number, firstWork?: number, fr?: number, fd?: number): number {
  const shape = shapeOf(family);
  const c = w.compiled.sys;
  const eff = w.hot.rack.eff[c.rack[s]!]! * c.etaCfg[s]!;
  const clock = c.threadRate[s]! * w.hot.sys.clockFactor[s]! * eff;
  const accel = gpuRate ?? chooseAccel(w.compiled, null, s, accelNeed(shape.def, scale), 1)?.opsPerS ?? 0;
  if (fr === undefined || fd === undefined) { staticFractions(w.compiled, s, workingSetOf(shape, scale), frac); fr = frac[0]!; fd = frac[1]!; }
  let secs = 0;
  for (let i = fromStage; i < shape.stages; i += 1) {
    const work = i === fromStage && firstWork !== undefined ? firstWork : stageWorkAt(shape, i, scale);
    if (!(work > 0)) continue;
    switch (shape.res[i]) {
      case CPU: { const rate = Math.min(wantThreads(shape, scale), hwThreads(w, s)) * clock; secs += rate > 0 ? work / rate : Infinity; break; }
      case GPU: { const rate = accel * eff; secs += rate > 0 ? work / rate : Infinity; break; }
      case RAM: {
        if (fr > 0) secs += c.ramBw[s]! > 0 ? work * fr / c.ramBw[s]! : Infinity;
        if (fd > 0) { const io = diskRate(w, s); secs += io > 0 ? work * fd / io : Infinity; }
        break;
      }
    }
  }
  return secs;
}

export function estRecord(w: World, s: number, r: number): number {
  const rec = w.hot.rec, shape = shapeOf(rec.family[r]!), domain = rec.accelDomain[r]!;
  const d = domain < 0 ? null : readAccelDomain(w.compiled, s, domain);
  const gpuRate = d ? shape.tensor ? d.tensorOpsPerS : d.opsPerS : undefined;
  const stage = rec.stage[r]!;
  const remaining = domain >= 0 && shape.res[stage] === GPU && rec.part[r] === 0
    ? Math.max(0, rec.finish[r]! - accelClockAt(w, recordAccelClock(w, s, r), w.hot.rack.effClock[w.compiled.sys.rack[s]!]!)) : undefined;
  const placed = rec.memC[r]! + rec.memR[r]! + rec.memD[r]! > 0;
  return estOn(w, s, rec.family[r]!, rec.units[r]!, stage, gpuRate, remaining, placed ? rec.trafR[r]! : undefined, placed ? rec.trafD[r]! : undefined);
}

/** True when one more task of record r fits next to the running tasks (the free hierarchy D1.1, D26.1, a free thread). */
export function startable(w: World, s: number, r: number, timeSlice: boolean): boolean {
  const h = w.hot.sys;
  if (!timeSlice && h.busyThreads[s]! >= hwThreads(w, s)) return false;
  const shape = shapeOf(w.hot.rec.family[r]!), size = w.hot.rec.units[r]!;
  const ws = workingSetOf(shape, size);
  if (ws > freeHierarchy(w, s)) return false;
  return chooseAccel(w.compiled, w.hot, s, accelNeed(shape.def, size), 1, unifiedRoomOf(w, s, ws)) !== null;
}
