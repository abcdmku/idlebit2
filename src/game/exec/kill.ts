import { FAIL_DETAILS, NO_DETAIL, type FailDetail } from '../types/events';
import { G, LOC } from '../core/buffers';
import { ACCEL_CLOCKS, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import { allocRecord, freeRecord } from '../core/pool';
import { rqAt, rqClear, rqLen, rqRemove, rqRow } from '../core/routerQueue';
import { dirtyAll, dirtySystem } from '../core/touch';
import type { World } from '../core/world';
import { dropBacklog } from './backlog';
import { returnToFront } from '../market/queue';
import { payoutAt, FAMILIES } from '../market/families';
import { leaveLink, addTransit } from '../net/fifo';
import type { FailCause } from '../types/events';
import type { UnitRef } from '../types/ids';
import { resetClocks } from './clocks';
import { CAUSE, failRecord, releaseReservation, returnParent, returnTask } from './outcome';
import { recountSummaries } from './slots';
import { recountResearchThreads } from './researchTask';
import { NRES } from './shape';

/**
 * Lost work (spec §6.9, D25.5): every queued and running shard on the systems under `unit` fails
 * its task with `cause` (once, with this root cause, D4.1); transfers heading there return their
 * whole task to the queue front, still committed (spec §5.2), or fail it when a sibling shard
 * already finished. Router-queue entries of the routers in `unit` return to the front too.
 */

let mark = new Uint8Array(0);

function markSystems(w: World, unit: UnitRef): void {
  const c = w.compiled;
  if (mark.length < c.sys.len) mark = new Uint8Array(c.sys.len * 2);
  mark.fill(0);
  const rack = (id: number) => { for (let k = 0; k < SERVERS_PER_RACK; k += 1) { const s = c.rack.servers[id * SERVERS_PER_RACK + k]!; if (s >= 0) mark[s] = 1; } };
  const room = (id: number) => { for (let k = 0; k < RACKS_PER_ROOM; k += 1) { const r = c.room.racks[id * RACKS_PER_ROOM + k]!; if (r >= 0) rack(r); } };
  switch (unit.kind) {
    case 'system': mark[unit.id] = 1; break;
    case 'rack': rack(unit.id); break;
    case 'room': room(unit.id); break;
    case 'site': for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) { const m = c.site.zones[unit.id * MAX_ZONES_PER_SITE + z]!; if (m >= 0) room(m); } break;
  }
}

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

/** Returns every entry of router (kind, id)'s queue to the queue front, oldest first (spec §6.9, D25.7). */
export function returnRouterQueue(w: World, kind: number, id: number, cause: number): void {
  const hot = w.hot, q = hot.rq, row = rqRow(hot, kind, id);
  if (row >= q.len) return;
  while (rqLen(hot, row) > 0) {
    const at = rqAt(hot, row, 0);
    const p = q.rqParent[at]!, task = q.rqTask[at]!, units = q.rqUnits[at]!, family = q.rqFamily[at]!, since = q.rqSince[at]!;
    rqRemove(w, row, 0);
    if (p >= 0) {
      hot.parent.pending[p] = hot.parent.pending[p]! - 1;
      returnParent(w, p, cause);
      continue;
    }
    const t = allocRecord(hot), rec = hot.rec;
    rec.family[t] = family; rec.count[t] = 1; rec.units[t] = units; rec.payout[t] = payoutAt(FAMILIES[family]!, units);
    rec.taskId[t] = task; rec.taken[t] = since;
    returnToFront(w, t);
  }
}

/** The router queues inside `unit`: its rack LBs, room LBs and the site's data plane. */
function returnQueuesUnder(w: World, unit: UnitRef, cause: number): void {
  const c = w.compiled;
  const rack = (id: number) => returnRouterQueue(w, 0, id, cause);
  const room = (id: number) => {
    returnRouterQueue(w, 1, id, cause);
    for (let k = 0; k < RACKS_PER_ROOM; k += 1) { const r = c.room.racks[id * RACKS_PER_ROOM + k]!; if (r >= 0) rack(r); }
  };
  switch (unit.kind) {
    case 'rack': rack(unit.id); break;
    case 'room': room(unit.id); break;
    case 'site':
      returnRouterQueue(w, 2, unit.id, cause);
      for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) { const m = c.site.zones[unit.id * MAX_ZONES_PER_SITE + z]!; if (m >= 0) room(m); }
      break;
  }
}

/** `detail` names what failed (QA-02: a power failure says which supply), shown as "Power · PSU". */
export function killSubtree(w: World, unit: UnitRef, cause: FailCause, detail: FailDetail | null = null): void {
  markSystems(w, unit);
  const rec = w.hot.rec, h = w.hot.sys, c = w.compiled;
  const causeIndex = CAUSE[cause];
  const d = detail === null ? NO_DETAIL : FAIL_DETAILS.indexOf(detail);
  for (let s = 0; s < c.sys.len; s += 1) {
    if (mark[s] !== 1) continue;
    for (let res = 0; res < NRES; res += 1) {
      for (let r = h.head[s * NRES + res]!; r >= 0; r = h.head[s * NRES + res]!) failRecord(w, r, causeIndex, d);
    }
    for (let a = 0; a < ACCEL_CLOCKS; a += 1) {
      for (let r = h.accelHead[s * ACCEL_CLOCKS + a]!; r >= 0; r = h.accelHead[s * ACCEL_CLOCKS + a]!) failRecord(w, r, causeIndex, d);
    }
    for (let r = h.queueHead[s]!; r >= 0; r = h.queueHead[s]!) failRecord(w, r, causeIndex, d);
    resetClocks(w, s);
    dirtySystem(w, s);
  }
  for (let r = 0; r < rec.len; r += 1) {
    if (rec.loc[r] === LOC.link && mark[rec.target[r]!] === 1) returnTransfer(w, r, causeIndex);
  }
  returnQueuesUnder(w, unit, causeIndex);
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
