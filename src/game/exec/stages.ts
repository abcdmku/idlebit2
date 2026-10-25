import { G, LOC } from '../core/buffers';
import { accelNeed, chooseAccel, type AccelChoice } from '../core/accelerators';
import { splitRecord } from '../core/pool';
import type { World } from '../core/world';
import { axisAt, clockAt, refreshDue, type Span } from './clocks';
import { accelClockAt, holdAccel, insertAccelStage, recordAccelClock, releaseAccel, removeAccelStage } from './accelerators';
import { runInsert, runUnlink } from './lists';
import { executionBoundary } from './boundary';
import { canAdmit, noteAdmit, noteAdmitted } from './slots';
import { CPU, GPU, IO, NRES, shapeOf, stageWorkAt, workingSetOf } from './shape';

/**
 * Record mechanics on one system: start, stage entry and exit, release. All at a fraction τ of the
 * tick; `span` holds the tick's axis bounds for the system's rack (clocks.ts).
 */

const ioFree = (w: World, s: number): number => Math.max(1, w.compiled.sys.ioConc[s]!) - w.hot.sys.ioHolds[s]!;

/** Divisor turning a stage's work into clock units for one task of record r. */
function divisorOf(w: World, r: number, res: number): number {
  if (res === CPU) return Math.max(1, w.hot.rec.threads[r]!);
  return 1;
}

/**
 * Puts record r (already loc = running on s) into its current stage at τ. `carryW` is the exact
 * clock value to start from when the previous stage ended on the same resource (in-tick carry,
 * architecture §1.5); pass NaN otherwise. IO needs a drive hold (D1.2): without one the record
 * waits at the tail of the IO list with finish = Infinity.
 */
export function enterStage(w: World, s: number, r: number, tau: number, span: Span, carryRes: number, carryW: number): void {
  const rec = w.hot.rec, h = w.hot.sys;
  const shape = shapeOf(rec.family[r]!);
  const stage = rec.stage[r]!;
  const res = shape.res[stage]!;
  let k = rec.count[r]!;
  if (res === IO) {
    const free = ioFree(w, s);
    if (free <= 0) {
      rec.start[r] = Infinity; rec.finish[r] = Infinity;
      runInsert(w.hot, s, IO, r);
      h.active[s * NRES + IO] = h.active[s * NRES + IO]! + k;
      return;
    }
    if (k > free) {
      const waiting = splitRecord(w.hot, r, k - free);
      rec.loc[waiting] = LOC.running;
      rec.start[waiting] = Infinity; rec.finish[waiting] = Infinity;
      runInsert(w.hot, s, IO, waiting);
      h.active[s * NRES + IO] = h.active[s * NRES + IO]! + (k - free);
      k = free;
    }
    h.ioHolds[s] = h.ioHolds[s]! + k;
  }
  const e = axisAt(span, res, tau);
  const start = carryRes === res && carryW === carryW ? carryW
    : res === GPU ? accelClockAt(w, recordAccelClock(w, s, r), e) : clockAt(w, s, res, e);
  const div = divisorOf(w, r, res);
  const work = stageWorkAt(shape, stage, rec.scale[r]!);
  rec.start[r] = start;
  rec.finish[r] = work <= 0 ? start : div > 0 ? start + work / div : Infinity;
  if (res === GPU) { insertAccelStage(w, s, r, e); return; }
  runInsert(w.hot, s, res, r);
  h.active[s * NRES + res] = h.active[s * NRES + res]! + k;
  refreshDue(w, s, res);
}

/** Moves record r from s's queue bookkeeping into running at τ. The caller unlinked it from the queue. */
export function startRecord(w: World, s: number, r: number, tau: number, span: Span, choice?: AccelChoice): void {
  const rec = w.hot.rec, h = w.hot.sys;
  const k = rec.count[r]!;
  const shape = shapeOf(rec.family[r]!);
  const selected = choice ?? chooseAccel(w.compiled, w.hot, s, accelNeed(shape.def, rec.scale[r]!), k);
  if (!selected || selected.take < k) throw new Error('startRecord: no accelerator capacity');
  holdAccel(w, s, r, selected);
  rec.loc[r] = LOC.running;
  rec.owner[r] = s;
  h.queueLen[s] = h.queueLen[s]! - k;
  w.hot.g[G.queued] = w.hot.g[G.queued]! - k;
  h.running[s] = h.running[s]! + k;
  w.hot.g[G.running] = w.hot.g[G.running]! + k;
  const threads = k * rec.threads[r]!;
  h.busyThreads[s] = h.busyThreads[s]! + threads;
  w.hot.g[G.busyThreads] = w.hot.g[G.busyThreads]! + threads;
  h.usedMem[s] = h.usedMem[s]! + k * workingSetOf(shape, rec.scale[r]!);
  enterStage(w, s, r, tau, span, -1, NaN);
}

/** Takes record r out of its run list, giving back an IO hold. Returns the resource it was on. */
export function leaveStage(w: World, s: number, r: number, e = executionBoundary(w, s)): number {
  const rec = w.hot.rec, h = w.hot.sys;
  const res = shapeOf(rec.family[r]!).res[rec.stage[r]!]!;
  const k = rec.count[r]!;
  if (res === GPU) { removeAccelStage(w, s, r, e); return res; }
  runUnlink(w.hot, s, res, r);
  h.active[s * NRES + res] = h.active[s * NRES + res]! - k;
  if (res === IO && rec.finish[r] !== Infinity) h.ioHolds[s] = h.ioHolds[s]! - k;
  refreshDue(w, s, res);
  return res;
}

/** Gives back everything a running record holds on s except its stage: slot, threads, memory. */
export function releaseRunning(w: World, s: number, r: number): void {
  const rec = w.hot.rec, h = w.hot.sys;
  const k = rec.count[r]!;
  const shape = shapeOf(rec.family[r]!);
  const before = canAdmit(w, s);
  h.running[s] = h.running[s]! - k;
  w.hot.g[G.running] = w.hot.g[G.running]! - k;
  const threads = k * rec.threads[r]!;
  h.busyThreads[s] = h.busyThreads[s]! - threads;
  w.hot.g[G.busyThreads] = w.hot.g[G.busyThreads]! - threads;
  h.usedMem[s] = Math.max(0, h.usedMem[s]! - k * workingSetOf(shape, rec.scale[r]!));
  releaseAccel(w, s, r);
  if (h.running[s] === 0) { h.usedMem[s] = 0; h.usedVram[s] = 0; }
  noteAdmitted(w, s, -k, r);
  noteAdmit(w, s, before);
}

/** Gives waiting IO records a hold at τ, oldest take first (then task id), while holds are free. */
export function promoteIo(w: World, s: number, tau: number, span: Span): void {
  const rec = w.hot.rec;
  while (ioFree(w, s) > 0) {
    let best = -1;
    for (let r = w.hot.sys.head[s * NRES + IO]!; r >= 0; r = rec.next[r]!) {
      if (rec.finish[r] !== Infinity) continue;
      if (best < 0 || rec.taken[r]! < rec.taken[best]! || (rec.taken[r] === rec.taken[best] && rec.taskId[r]! < rec.taskId[best]!)) best = r;
    }
    if (best < 0) return;
    runUnlink(w.hot, s, IO, best);
    w.hot.sys.active[s * NRES + IO] = w.hot.sys.active[s * NRES + IO]! - rec.count[best]!;
    enterStage(w, s, best, tau, span, -1, NaN);
  }
}

