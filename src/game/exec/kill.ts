import { G, LOC, RECORD } from '../core/buffers';
import { ACCEL_CLOCKS, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import { allocRecord, freeGang, freeRecord } from '../core/pool';
import { copyRow } from '../core/table';
import { dirtyAll, dirtySystem } from '../core/touch';
import type { World } from '../core/world';
import { dropBacklog } from './backlog';
import { returnToFront } from '../market/queue';
import { leaveLink, addTransit } from '../net/fifo';
import type { FailCause } from '../types/events';
import type { UnitRef } from '../types/ids';
import { resetClocks } from './clocks';
import { abortRecord, CAUSE, failRecord, gangRecords, releaseReservation } from './outcome';
import { recountSummaries } from './slots';
import { NRES } from './shape';

/**
 * Lost work (spec §6.9): every queued and running task on the systems under `unit` fails with
 * `cause` (a distributed task once, with this root cause, D4.1); transfers heading there return to
 * the queue front, still committed (spec §5.2; a distributed task returns as a whole).
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

const members: number[] = [];

/** A distributed task returns as a whole: every member aborted, one logical task back at the front. */
function returnGang(w: World, g: number, from: number): void {
  const rec = w.hot.rec;
  const task = allocRecord(w.hot);
  copyRow(RECORD, rec, from, task);
  rec.count[task] = 1;
  rec.prev[task] = -1; rec.next[task] = -1;
  for (const r of gangRecords(w, g, members)) if (r !== task) abortRecord(w, r);
  freeGang(w.hot, g);
  returnToFront(w, task);
}

/** Cancels a transfer: its slot reservation is released and the task goes back to the queue front. */
function returnTransfer(w: World, r: number): void {
  const rec = w.hot.rec, h = w.hot.sys;
  if (rec.gang[r]! >= 0) { returnGang(w, rec.gang[r]!, r); return; }
  const s = rec.target[r]!;
  if (rec.owner[r]! >= 0) leaveLink(w.hot, r);
  else if (h.pipeRec[s] === r) { h.pipeRec[s] = -1; h.pipeLeft[s] = 0; }
  addTransit(w.hot, -rec.count[r]!);
  releaseReservation(w, s, rec.count[r]!, r);
  returnToFront(w, r);
}

export function killSubtree(w: World, unit: UnitRef, cause: FailCause): void {
  markSystems(w, unit);
  const rec = w.hot.rec, h = w.hot.sys, c = w.compiled;
  const causeIndex = CAUSE[cause];
  for (let s = 0; s < c.sys.len; s += 1) {
    if (mark[s] !== 1) continue;
    for (let res = 0; res < NRES; res += 1) {
      for (let r = h.head[s * NRES + res]!; r >= 0; r = h.head[s * NRES + res]!) failRecord(w, r, causeIndex);
    }
    for (let a = 0; a < ACCEL_CLOCKS; a += 1) {
      for (let r = h.accelHead[s * ACCEL_CLOCKS + a]!; r >= 0; r = h.accelHead[s * ACCEL_CLOCKS + a]!) failRecord(w, r, causeIndex);
    }
    for (let r = h.queueHead[s]!; r >= 0; r = h.queueHead[s]!) failRecord(w, r, causeIndex);
    resetClocks(w, s);
    dirtySystem(w, s);
  }
  for (let r = 0; r < rec.len; r += 1) {
    if (rec.loc[r] === LOC.link && mark[rec.target[r]!] === 1) returnTransfer(w, r);
  }
}

/**
 * Round end (spec §4.1, R19): frees every queued, running and in-transit record and every gang,
 * counting nothing, and resets the exec and net work columns. The market clears the queue front.
 */
export function dropAllWork(w: World): void {
  const rec = w.hot.rec, hot = w.hot;
  for (let r = 0; r < rec.len; r += 1) {
    const loc = rec.loc[r];
    if (loc === LOC.free || loc === LOC.front) continue;
    freeRecord(hot, r);
  }
  for (let g = 0; g < hot.gang.len; g += 1) if (hot.gang.members[g]! > 0) freeGang(hot, g);
  const h = hot.sys;
  h.queueHead.fill(-1); h.queueTail.fill(-1); h.queueLen.fill(0); h.running.fill(0); h.reserved.fill(0);
  h.busyThreads.fill(0); h.usedMem.fill(0); h.usedVram.fill(0); h.usedStorage.fill(0); h.ioHolds.fill(0);
  h.wAnchor.fill(0); h.eAnchor.fill(0); h.rate.fill(0); h.due.fill(Infinity); h.head.fill(-1); h.active.fill(0);
  h.accelUsedVram.fill(0); h.accelHolders.fill(0);
  h.accelWAnchor.fill(0); h.accelEAnchor.fill(0); h.accelRate.fill(0); h.accelDue.fill(Infinity);
  h.accelHead.fill(-1); h.accelActive.fill(0);
  h.pipeRec.fill(-1); h.pipeLeft.fill(0); h.pipeT0.fill(0);
  hot.link.head.fill(-1); hot.link.tail.fill(-1); hot.link.qlen.fill(0); hot.link.backlog.fill(0);
  dirtyAll(w);
  dropBacklog(w);
  hot.g[G.running] = 0; hot.g[G.queued] = 0; hot.g[G.transitCount] = 0; hot.g[G.busyThreads] = 0;
  recountSummaries(w);
}
