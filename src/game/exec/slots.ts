import { SERVERS_PER_RACK } from '../core/constants';
import { MODE } from '../core/timers';
import { noteAdmitChange, noteBacklog, noteRackAdmits } from './backlog';
import { drainSummaries, touchSummary, touchSystem, type TouchLog } from '../core/touch';
import type { CompiledBuffers, HotBuffers } from '../core/buffers';
import type { World } from '../core/world';
import { wakeRouters } from '../core/routerQueue';

/**
 * Room and free-slot summaries (spec §4.3, architecture §1.3). A system **can admit now** when it
 * is a live server in `onMarket`, has a link (a switch port once its rack is opened)
 * and `admitted + reserved < slots`. rack/room/site `freeSlots` count the systems below that can
 * admit now, so routers never scan the fleet. rack `admitted` sums admitted + reserved tasks.
 */

/** compiled sys.kind of a storage node: drives only, never a routing target (spec §6.10). */
export const STORAGE_NODE = 1;

const ADMIT_MODE = new Uint8Array(32);
ADMIT_MODE[MODE.onMarket] = 1;
// D31.1: asleep and standby systems are never split targets; they wake by demand (phys/start.ts).

/** Modes in which a system runs its admitted tasks (spec §4.3). */
const RUN_MODE = new Uint8Array(32);
RUN_MODE[MODE.onMarket] = 1;
RUN_MODE[MODE.draining] = 1;
export const runsTasks = (mode: number): boolean => RUN_MODE[mode] === 1;
export const admitsInMode = (mode: number): boolean => ADMIT_MODE[mode] === 1;

/** Running limit Keff (spec §6.2), at least 1. */
export const keffOf = (w: World, s: number): number => Math.max(1, w.compiled.sys.keff[s]!);
/** Keff + Q, at least 1. */
export const slotsOf = (w: World, s: number): number => Math.max(1, w.compiled.sys.slots[s]!, w.compiled.sys.keff[s]!);

export const admittedOf = (w: World, s: number): number => {
  const h = w.hot.sys;
  // D27: a research holder uses one slot.
  return h.running[s]! + h.queueLen[s]! + h.reserved[s]! + (h.researchThreads[s]! > 0 ? 1 : 0);
};

/**
 * D26 (spec §6.4): while a task waits in the queue with a running slot free (memory or threads hold it
 * back), the system admits only while queued + reserved < Q, so the queue never holds more than Q.
 * Derived from live counts, never stored.
 */
export function queueCapped(w: World, s: number): boolean {
  const h = w.hot.sys, q = w.compiled.sys.Q[s]!;
  return q > 0 && h.queueLen[s]! > 0 && h.running[s]! < keffOf(w, s) && h.queueLen[s]! + h.reserved[s]! >= q;
}

/** Without a rack switch port a system has no link and gets no tasks (spec §7.2). Before Rack the link is integrated. */
export const hasLink = (w: World, s: number): boolean =>
  w.compiled.rack.opened[w.compiled.sys.rack[s]!] !== 1 || w.compiled.sys.port[s]! >= 0;

/**
 * Room to take now (spec §6.4) apart from the first link: a live server that admits in its mode,
 * with a link, a free slot and a take left this tick. Take counters reset with the tick; the route
 * phase recounts the summaries first, so they stay exact within it.
 */
export function canAdmit(w: World, s: number): boolean {
  const c = w.compiled.sys, h = w.hot.sys;
  if (c.alive[s] !== 1 || c.kind[s] === STORAGE_NODE || ADMIT_MODE[h.mode[s]!] !== 1) return false;
  // hasLink, admittedOf, slotsOf and takesLeft, inlined for the routing scans.
  if (w.compiled.rack.opened[c.rack[s]!] === 1 && c.port[s]! < 0) return false;
  const slots = Math.max(1, c.slots[s]!, c.keff[s]!);
  if (queueCapped(w, s)) return false;
  return h.running[s]! + h.queueLen[s]! + h.reserved[s]! + (h.researchThreads[s]! > 0 ? 1 : 0) < slots && slots - (h.takeTick[s] === w.tick ? h.takes[s]! : 0) > 0;
}

/** Applies a system's can-admit flip to the rack, room and site summaries. */
export function noteAdmit(w: World, s: number, before: boolean): void {
  const after = canAdmit(w, s);
  if (after === before) return;
  noteAdmitChange(w, w.compiled.sys.rack[s]!);
  if (after) wakeRouters(w, 0, w.compiled.sys.rack[s]!);
  const d = after ? 1 : -1;
  const c = w.compiled.sys, h = w.hot;
  const rack = c.rack[s]!, room = c.room[s]!, site = c.site[s]!;
  h.rack.freeSlots[rack] = h.rack.freeSlots[rack]! + d;
  h.room.freeSlots[room] = h.room.freeSlots[room]! + d;
  h.site.freeSlots[site] = h.site.freeSlots[site]! + d;
}

/**
 * Adds `delta` tasks of record r, admitted or reserved on system s, to its rack's sum and its
 * routing backlog (D24); raises s for phys (R34). Without r the backlog is rebuilt on next use.
 */
export function noteAdmitted(w: World, s: number, delta: number, r = -1): void {
  touchSystem(w, s);
  noteBacklog(w, s, delta, r);
  const rack = w.compiled.sys.rack[s]!;
  w.hot.rack.admitted[rack] = w.hot.rack.admitted[rack]! + delta;
}

/** Recomputes every summary from scratch. Cost O(systems); run when modes may have changed unseen. */
export function recountSummaries(w: World): void {
  const h = w.hot, c = w.compiled;
  h.rack.freeSlots.fill(0);
  h.rack.admitted.fill(0);
  h.room.freeSlots.fill(0);
  h.site.freeSlots.fill(0);
  // canAdmit and admittedOf over flat columns: the same reads and sums, once per system.
  const cs = c.sys, hs = h.sys, tick = w.tick, servers = c.rack.servers, rackOpened = c.rack.opened;
  const alive = cs.alive, kind = cs.kind, sysRack = cs.rack, port = cs.port, slotCap = cs.slots, keff = cs.keff;
  const mode = hs.mode, running = hs.running, queueLen = hs.queueLen, reserved = hs.reserved, takeTick = hs.takeTick, takes = hs.takes, research = hs.researchThreads;
  for (let rack = 0; rack < c.rack.len; rack += 1) {
    if (c.rack.alive[rack] !== 1) continue;
    let free = 0, admitted = 0, mask = 0;
    for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
      const s = servers[rack * SERVERS_PER_RACK + k]!;
      if (s < 0 || alive[s] !== 1) continue;
      const busy = running[s]! + queueLen[s]! + reserved[s]! + (research[s]! > 0 ? 1 : 0);
      admitted += busy;
      if (kind[s] === STORAGE_NODE || ADMIT_MODE[mode[s]!] !== 1) continue;
      if (rackOpened[sysRack[s]!] === 1 && port[s]! < 0) continue;
      const slots = Math.max(1, slotCap[s]!, keff[s]!);
      // D26 queue cap, as canAdmit: a queue held back by memory or threads admits only while queued + reserved < Q.
      if (queueCapped(w, s)) continue;
      if (busy < slots && slots - (takeTick[s] === tick ? takes[s]! : 0) > 0) { free += 1; mask |= 1 << k; }
    }
    noteRackAdmits(w, rack, mask);
    h.rack.freeSlots[rack] = free;
    h.rack.admitted[rack] = admitted;
    const room = c.rack.room[rack]!;
    h.room.freeSlots[room] = h.room.freeSlots[room]! + free;
    const site = c.room.site[room]!;
    h.site.freeSlots[site] = h.site.freeSlots[site]! + free;
  }
}

/**
 * One rack's recount, with the room and site sums moved by its change: what recountSummaries
 * gives when only this rack's systems may differ from the incremental sums.
 */
function recountRack(w: World, rack: number): void {
  const h = w.hot, c = w.compiled;
  if (rack >= c.rack.len || c.rack.alive[rack] !== 1) return;
  const cs = c.sys, hs = h.sys, tick = w.tick, servers = c.rack.servers;
  let free = 0, admitted = 0, mask = 0;
  for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
    const s = servers[rack * SERVERS_PER_RACK + k]!;
    if (s < 0 || cs.alive[s] !== 1) continue;
    const busy = hs.running[s]! + hs.queueLen[s]! + hs.reserved[s]! + (hs.researchThreads[s]! > 0 ? 1 : 0);
    admitted += busy;
    if (cs.kind[s] === STORAGE_NODE || ADMIT_MODE[hs.mode[s]!] !== 1) continue;
    if (c.rack.opened[cs.rack[s]!] === 1 && cs.port[s]! < 0) continue;
    const slots = Math.max(1, cs.slots[s]!, cs.keff[s]!);
    if (queueCapped(w, s)) continue;
    if (busy < slots && slots - (hs.takeTick[s] === tick ? hs.takes[s]! : 0) > 0) { free += 1; mask |= 1 << k; }
  }
  const d = free - h.rack.freeSlots[rack]!;
  // The count can hold while members swap: the routing summary compares which systems admit.
  noteRackAdmits(w, rack, mask);
  h.rack.freeSlots[rack] = free;
  h.rack.admitted[rack] = admitted;
  if (d === 0) return;
  const room = c.rack.room[rack]!, site = c.room.site[room]!;
  h.room.freeSlots[room] = h.room.freeSlots[room]! + d;
  h.site.freeSlots[site] = h.site.freeSlots[site]! + d;
}

/** Test and bench hook: after a partial recount, also recount everything and throw on a difference. */
export const summaryDebug = { verify: false };

/** The touch log and compiled buffers of the last recount, per hot buffers (derived, never state). */
const recounted = new WeakMap<HotBuffers, { log: TouchLog; compiled: CompiledBuffers }>();

/**
 * The route phase's summaries, exact (spec §7.7). Exec keeps them exact through every admission,
 * reservation, completion and take (noteAdmit); only mode changes and the per-tick take limit
 * move them unseen, and both raise their rack (core/touch.ts). So inside one advance call, after
 * the call's first recount with the same compiled buffers, recounting the raised racks gives the
 * full recount. Anything else (no log, another call, new compiled buffers) recounts everything.
 */
export function refreshSummaries(w: World): void {
  const log = w.touch;
  const last = recounted.get(w.hot);
  if (!log || !last || last.log !== log || last.compiled !== w.compiled) {
    recountSummaries(w);
    if (log) { drainSummaries(log); recounted.set(w.hot, { log, compiled: w.compiled }); }
    return;
  }
  for (let i = 0; i < log.sumN; i += 1) recountRack(w, log.sumList[i]!);
  drainSummaries(log);
  if (summaryDebug.verify) verifySummaries(w);
}

function verifySummaries(w: World): void {
  const h = w.hot;
  const cols = [h.rack.freeSlots, h.rack.admitted, h.room.freeSlots, h.site.freeSlots] as const;
  const before = cols.map((col) => col.slice());
  recountSummaries(w);
  cols.forEach((col, i) => {
    for (let j = 0; j < col.length; j += 1) {
      if (col[j] !== before[i]![j]) throw new Error(`slots: summary ${i} row ${j} ${before[i]![j]} != ${col[j]} at tick ${w.tick}`);
    }
  });
}

/** Takes left this tick (spec §6.4): each slot takes at most one new task per tick. */
export function takesLeft(w: World, s: number): number {
  const h = w.hot.sys;
  return slotsOf(w, s) - (h.takeTick[s] === w.tick ? h.takes[s]! : 0);
}

/** Counts one take on system s this tick. */
export function noteTake(w: World, s: number): void {
  const h = w.hot.sys;
  const before = canAdmit(w, s);
  if (h.takeTick[s] !== w.tick) { h.takeTick[s] = w.tick; h.takes[s] = 0; }
  h.takes[s] = h.takes[s]! + 1;
  noteAdmit(w, s, before);
  // The take limit resets next tick, which can flip canAdmit with no write: recount the rack then,
  // and try its routers' blocked entries again.
  touchSummary(w, w.compiled.sys.rack[s]!);
  wakeRouters(w, 0, w.compiled.sys.rack[s]!);
}

/** Reserves k slots on system s for taken tasks in transfer (reserved counts as admitted for every room check). */
export function reserve(w: World, s: number, k: number, r: number): void {
  const before = canAdmit(w, s);
  w.hot.sys.reserved[s] = w.hot.sys.reserved[s]! + k;
  noteAdmitted(w, s, k, r);
  noteAdmit(w, s, before);
}
