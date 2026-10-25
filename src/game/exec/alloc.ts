import { G, LOC } from '../core/buffers';
import { accelNeed, chooseAccel } from '../core/accelerators';
import { splitRecord } from '../core/pool';
import type { World } from '../core/world';
import { dropProbe, probeHead, returnToFront, takeHead } from '../market/queue';
import { canRunOn } from '../market/fleet';
import { addTransit } from '../net/fifo';
import { type Span } from './clocks';
import { hwThreads, memOf } from './est';
import { queueInsertAfter, queuePush, queueUnlink } from './lists';
import { strategyOf } from './schedulers';
import { memberPayload, shapeOf, workingSetOf } from './shape';
import { admittedOf, keffOf, noteAdmit, noteAdmitted, noteTake, reserve, slotsOf, takesLeft, canAdmit } from './slots';
import { startRecord } from './stages';

/**
 * Allocation (spec §6.4, §6.5, §6.7 steps 1 and 3): before Rack the lone system takes the head
 * over its pipe (its default rack-switch port, D13); then queued tasks start while the running
 * limit, a free thread (except time slicing) and memory (D1.1, summed working sets) allow, in
 * strategy order. A task that does not fit is skipped.
 */

/** Admits k tasks of record r (already off every other list) into system s's queue. */
export function enqueue(w: World, s: number, r: number): void {
  const k = w.hot.rec.count[r]!;
  const h = w.hot.sys;
  w.hot.rec.loc[r] = LOC.queue;
  w.hot.rec.owner[r] = s;
  queuePush(w.hot, s, r);
  h.queueLen[s] = h.queueLen[s]! + k;
  w.hot.g[G.queued] = w.hot.g[G.queued]! + k;
}

/** Whether the lone system s may take now (spec §6.4): room, a free pipe, takes left this tick. */
const canTakeLone = (w: World, s: number): boolean =>
  w.hot.sys.pipeRec[s]! < 0 && w.compiled.sys.pipeSpeed[s]! > 0 && admittedOf(w, s) < slotsOf(w, s) && takesLeft(w, s) > 0;

/**
 * Before Rack, at τ: takes the head over s's pipe if s has room and can run it (spec §6.4). The
 * pipe carries one transfer at a time; it lands at τ + work / speed, carried into later ticks if
 * needed (run.ts). A head s cannot run blocks the line.
 */
export function pullLone(w: World, s: number, tau: number): void {
  const rec = w.hot.rec, h = w.hot.sys;
  while (canTakeLone(w, s)) {
    const head = probeHead(w);
    if (head < 0) return;
    if (canRunOn(w, s, head) !== 0) { dropProbe(w, head); return; }
    const r = takeHead(w, head);
    rec.loc[r] = LOC.link;
    rec.owner[r] = -1;
    rec.target[r] = s;
    reserve(w, s, 1, r);
    noteTake(w, s);
    addTransit(w.hot, 1);
    h.pipeRec[s] = r;
    h.pipeT0[s] = tau;
    h.pipeLeft[s] = memberPayload(shapeOf(rec.family[r]!), rec.scale[r]!);
    // A zero-time transfer (an unbounded test pipe) lands at the τ it starts; a real one lands in run.ts.
    if (h.pipeLeft[s]! / w.compiled.sys.pipeSpeed[s]! !== 0) return;
    landPipe(w, s, tau);
  }
}

/** The pipe transfer of s landed at τ: the task takes its reserved slot (admission). */
export function landPipe(w: World, s: number, tau: number): void {
  const h = w.hot.sys;
  const r = h.pipeRec[s]!;
  h.pipeBits[s] = h.pipeBits[s]! + h.pipeLeft[s]!;
  h.pipeRec[s] = -1;
  h.pipeLeft[s] = 0;
  h.pipeT0[s] = tau;
  addTransit(w.hot, -1);
  const before = canAdmit(w, s);
  h.reserved[s] = h.reserved[s]! - 1;
  enqueue(w, s, r);
  noteAdmit(w, s, before);
}

/** Starts queued tasks at τ while they fit. Returns how many tasks started. */
export function startQueued(w: World, s: number, tau: number, span: Span): number {
  const strategy = strategyOf(w, s);
  const h = w.hot.sys, rec = w.hot.rec;
  const keff = keffOf(w, s);
  const threads = hwThreads(w, s);
  let started = 0;
  while (h.running[s]! < keff) {
    const r = strategy.pickQueue(w, s);
    if (r < 0) break;
    const shape = shapeOf(rec.family[r]!);
    const ws = workingSetOf(shape, rec.scale[r]!);
    const freeThreads = threads - h.busyThreads[s]!;
    const perTask = strategy.timeSlice ? Math.min(shape.threads, threads) : Math.max(1, Math.min(shape.threads, freeThreads));
    let k = Math.min(rec.count[r]!, keff - h.running[s]!);
    if (!strategy.timeSlice) k = Math.min(k, Math.floor(freeThreads / perTask));
    if (ws > 0) k = Math.min(k, Math.floor((memOf(w, s) - h.usedMem[s]!) / ws));
    if (k <= 0) break;
    const choice = chooseAccel(w.compiled, w.hot, s, accelNeed(shape.def, rec.scale[r]!), k);
    if (!choice) break;
    k = choice.take;
    if (k < rec.count[r]!) queueInsertAfter(w.hot, s, r, splitRecord(w.hot, r, rec.count[r]! - k));
    queueUnlink(w.hot, s, r);
    rec.threads[r] = perTask;
    startRecord(w, s, r, tau, span, choice);
    started += k;
  }
  return started;
}

/**
 * gracefulDrain (spec §4.4): a draining system admits nothing; its queued tasks return to the
 * queue front, still committed (spec §5.2).
 */
export function drainQueue(w: World, s: number): void {
  const h = w.hot.sys, rec = w.hot.rec;
  for (let r = h.queueHead[s]!; r >= 0; r = h.queueHead[s]!) {
    const k = rec.count[r]!;
    queueUnlink(w.hot, s, r);
    h.queueLen[s] = h.queueLen[s]! - k;
    w.hot.g[G.queued] = w.hot.g[G.queued]! - k;
    noteAdmitted(w, s, -k, r);
    returnToFront(w, r);
  }
}
