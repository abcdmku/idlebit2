import type { World } from '../core/world';
import { LOC } from '../core/buffers';
import { DT_S } from '../core/constants';
import { accelNeed, chooseAccel, readAccelDomain } from '../core/accelerators';
import { accelClockAt, recordAccelClock } from './accelerators';
import { clockAt, isEAxis } from './clocks';
import { diskRate, freeHierarchy, isLoadingPart, PART_DISK, PART_LOAD_CACHE, PART_LOAD_DISK, PART_MAIN, partClock, partWork, staticFractions, unifiedRoom as unifiedRoomOf } from './memory';
import { hasRule } from './rules';
import { CPU, GPU, RAM, shapeOf, stageWorkAt, wantThreads, workingSetOf } from './shape';

/** Hardware threads, at least 1. */
export const hwThreads = (w: World, s: number): number => Math.max(1, w.compiled.sys.threads[s]!);

const frac = new Float64Array(2);
const seconds = (work: number, rate: number): number => work > 0 ? rate > 0 ? work / rate : Infinity : 0;

const cpuClock = (w: World, s: number): number => w.compiled.sys.threadRate[s]! * w.hot.sys.clockFactor[s]!
  * w.hot.rack.eff[w.compiled.sys.rack[s]!]! * w.compiled.sys.etaCfg[s]!;

/**
 * est(task) (η_cfg × e(T) scale compute and GPU, D7.5) (spec §8.1): the remaining duration of one task of record r on system s at the system's
 * current uncontended rates, compute at min(max(1, floor(units / grain)), hardware threads) threads (D25.3). Infinity if a stage's
 * resource has no rate. Starting at stage 0 includes loading the working set into the empty hierarchy.
 * Cache loads and traffic cost CPU ops; RAM and disk loads and traffic cost bits / bandwidth.
 */
export function estOn(w: World, s: number, family: number, scale: number, fromStage: number): number {
  const shape = shapeOf(family);
  const c = w.compiled.sys;
  const eff = w.hot.rack.eff[c.rack[s]!]! * c.etaCfg[s]!;
  const clock = Math.min(wantThreads(shape, scale), hwThreads(w, s)) * cpuClock(w, s);
  const ws = workingSetOf(shape, scale), need = accelNeed(shape.def, scale);
  staticFractions(w.compiled, s, ws, frac);
  let fr = frac[0]!, fd = frac[1]!;
  const room = hasRule(w, 'unifiedMemory') ? Math.max(0, c.memCap[s]! - c.cacheBits[s]! - Math.max(0, ws - c.cacheBits[s]!)) : 0;
  const choice = chooseAccel(w.compiled, null, s, need, 1, room);
  const accel = (choice?.opsPerS ?? 0) * eff;
  const overflow = Math.max(0, need.vramBits - (choice?.held ?? 0));
  const vr = Math.min(overflow, Math.max(0, c.ramCap[s]! - ws * fr)), vd = overflow - vr;
  const io = diskRate(w, s), ram = c.ramBw[s]!;
  let secs = 0;
  if (fromStage === 0) secs += seconds(ws * Math.max(0, 1 - fr - fd), clock) + seconds(ws * fr + vr, ram) + seconds(ws * fd + vd, io);
  if (fd > 0 && hasRule(w, 'hotPages')) { fr = c.hasRam[s] === 1 ? fr + fd - fd * fd : fr; fd *= fd; }
  for (let i = fromStage; i < shape.stages; i += 1) {
    const work = stageWorkAt(shape, i, scale);
    if (!(work > 0)) continue;
    switch (shape.res[i]) {
      case CPU: secs += seconds(work, clock); break;
      case GPU:
        secs += seconds(work, accel);
        if (need.vramBits > 0) secs += seconds(work * vr / need.vramBits, ram) + seconds(work * vd / need.vramBits, io);
        break;
      case RAM: {
        secs += seconds(work * Math.max(0, 1 - fr - fd), clock) + seconds(work * fr, ram) + seconds(work * fd, io);
        break;
      }
    }
  }
  return secs;
}

export function estRecord(w: World, s: number, r: number): number {
  const rec = w.hot.rec, shape = shapeOf(rec.family[r]!), domain = rec.accelDomain[r]!;
  if (rec.loc[r] !== LOC.running) return estOn(w, s, rec.family[r]!, rec.units[r]!, 0);
  const d = domain < 0 ? null : readAccelDomain(w.compiled, s, domain);
  const eff = w.hot.rack.eff[w.compiled.sys.rack[s]!]! * w.compiled.sys.etaCfg[s]!;
  const rates = [cpuClock(w, s), w.compiled.sys.ramBw[s]!, (d ? shape.tensor ? d.tensorOpsPerS : d.opsPerS : 0) * eff, diskRate(w, s)];
  const stage = rec.stage[r]!, part = rec.part[r]!, loading = isLoadingPart(part);
  const res = partClock(shape, stage, part);
  const e = w.hot.rack.effClock[w.compiled.sys.rack[s]!]!;
  const now = res === GPU ? accelClockAt(w, recordAccelClock(w, s, r), e)
    : clockAt(w, s, res, isEAxis(res) ? e : w.tick * DT_S);
  const duration = (st: number, p: number) => {
    const resource = partClock(shape, st, p);
    const rate = rates[resource]! * (resource === CPU ? Math.max(1, rec.threads[r]!) : 1);
    return seconds(partWork(w, r, shape, st, p), rate);
  };
  let secs = Number.isFinite(rec.finish[r]!) ? seconds(Math.max(0, rec.finish[r]! - now), rates[res]!) : duration(stage, part);
  if (loading) for (let p = Math.max(PART_LOAD_CACHE, part + 1); p <= PART_LOAD_DISK; p += 1) secs += duration(0, p);
  for (let st = stage; st < shape.stages; st += 1) {
    for (let p = st === stage && !loading ? part + 1 : PART_MAIN; p <= PART_DISK; p += 1) secs += duration(st, p);
  }
  return secs;
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
