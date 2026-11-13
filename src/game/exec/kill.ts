import { NO_DETAIL } from '../types/events';
import { G, LOC } from '../core/buffers';
import { ACCEL_CLOCKS } from '../core/constants';
import { freeRecord } from '../core/pool';
import { rqClear } from '../core/routerQueue';
import { dirtyAll, dirtySystem } from '../core/touch';
import type { World } from '../core/world';
import { dropBacklog } from './backlog';
import { returnToFront } from '../market/queue';
import { leaveLink, addTransit } from '../net/fifo';
import type { FailCause } from '../types/events';
import { resetClocks } from './clocks';
import { CAUSE, failRecord, releaseReservation, returnTask } from './outcome';
import { noteRelease, recountSummaries } from './slots';
import { recountResearchThreads } from './researchTask';
import { NRES } from './shape';

/**
 * Lost work (spec §6.9, D25.5): every queued and running shard on system `s` fails its task with
 * `cause` (once, with this root cause, D4.1); transfers heading there return their whole task to
 * the queue front, still committed (spec §5.2), or fail it when a sibling shard already finished.
 */

/** Cancels a transfer: its slot reservation is released and the task goes back to the queue front. */
function returnTransfer(w: World, r: number, cause: number): void {
  const rec = w.hot.rec, h = w.hot.sys;
  if (rec.parent[r]! >= 0) { returnTask(w, r, cause); return; }
  const s = rec.target[r]!;
  if (rec.owner[r]! >= 0) leaveLink(w.hot, r);
  else if (h.pipeRec[s] === r) { h.pipeRec[s] = -1; h.pipeLeft[s] = 0; }
  addTransit(w.hot, -rec.count[r]!);
  releaseReservation(w, s, rec.count[r]!, r);
  returnToFront(w, r);
}

export function killSystem(w: World, s: number, cause: FailCause): void {
  const rec = w.hot.rec, h = w.hot.sys;
  const causeIndex = CAUSE[cause];
  for (let res = 0; res < NRES; res += 1) {
    for (let r = h.head[s * NRES + res]!; r >= 0; r = h.head[s * NRES + res]!) failRecord(w, r, causeIndex, NO_DETAIL);
  }
  for (let a = 0; a < ACCEL_CLOCKS; a += 1) {
    for (let r = h.accelHead[s * ACCEL_CLOCKS + a]!; r >= 0; r = h.accelHead[s * ACCEL_CLOCKS + a]!) failRecord(w, r, causeIndex, NO_DETAIL);
  }
  for (let r = h.queueHead[s]!; r >= 0; r = h.queueHead[s]!) failRecord(w, r, causeIndex, NO_DETAIL);
  resetClocks(w, s);
  dirtySystem(w, s);
  for (let r = 0; r < rec.len; r += 1) {
    if (rec.loc[r] === LOC.link && rec.target[r] === s) returnTransfer(w, r, causeIndex);
  }
}

/**
 * Round end (spec §4.1, R19, D25.5): frees every queued, running and in-transit record, every
 * parent row and every router-queue entry, counting nothing, and resets the exec and net work
 * columns. A task with finished shards pays nothing. The market clears the queue front.
 */
export function dropAllWork(w: World): void {
  const rec = w.hot.rec, hot = w.hot;
  for (let r = 0; r < rec.len; r += 1) {
    const loc = rec.loc[r];
    if (loc === LOC.free || loc === LOC.front) continue;
    freeRecord(hot, r);
  }
  for (let r = 0; r < rec.len; r += 1) { rec.parent[r] = -1; rec.sib[r] = -1; }
  hot.parent.len = 0; hot.dlHead.fill(-1); hot.g[G.parentFree] = -1; hot.g[G.parentUsed] = 0; hot.g[G.replacing] = 0;
  rqClear(hot);
  const h = hot.sys;
  h.preloadRec.fill(-1); h.preloadThread.fill(-1); h.preloadStart.fill(0); h.preloadFinish.fill(Infinity); h.batchSavedBits.fill(0);
  h.residentFamily.fill(-1); h.residentBits.fill(0);
  h.queueHead.fill(-1); h.queueTail.fill(-1); h.queueLen.fill(0); h.running.fill(0); h.reserved.fill(0);
  noteRelease();
  h.busyThreads.fill(0); h.usedCache.fill(0); h.usedRam.fill(0); h.usedDisk.fill(0); h.usedVram.fill(0); h.ioHolds.fill(0);
  h.wAnchor.fill(0); h.eAnchor.fill(0); h.rate.fill(0); h.due.fill(Infinity); h.head.fill(-1); h.active.fill(0);
  h.accelUsedVram.fill(0); h.accelHolders.fill(0);
  h.accelWAnchor.fill(0); h.accelEAnchor.fill(0); h.accelRate.fill(0); h.accelDue.fill(Infinity);
  h.accelHead.fill(-1); h.accelActive.fill(0);
  h.pipeRec.fill(-1); h.pipeLeft.fill(0); h.pipeT0.fill(0);
  hot.link.head.fill(-1); hot.link.tail.fill(-1); hot.link.qlen.fill(0); hot.link.backlog.fill(0);
  dirtyAll(w);
  dropBacklog(w);
  hot.g[G.running] = 0; hot.g[G.queued] = 0; hot.g[G.transitCount] = 0; hot.g[G.busyThreads] = 0;
  recountResearchThreads(w);
  recountSummaries(w);
}
