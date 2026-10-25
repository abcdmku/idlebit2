import type { World } from './world';

/**
 * Change signals inside one advance call (contract R34). Derived, never state: a log lives on one
 * advance call's World, so nothing outside that call (an action, a test editing columns between
 * ticks) can write anything the log has not seen. A World without a log (tests driving phases by
 * hand) makes every reader fall back to its full scan, as does the first tick of each call.
 *
 * - Power (phys/powerCache.ts): systems whose power inputs moved without dirtying their rack
 *   (reservations and queue length in exec slots, wake timers, PSU failures) and the racks the run
 *   phase visited. Rack dirty flags, rack contexts and phys's own unstable and timer-due systems
 *   cover the rest.
 * - Free-slot summaries (exec/slots.ts): racks with an unseen can-admit change.
 * - Per-system skip (exec/run.ts): the system behind every rack-dirty write.
 * - Link watts (phys/energy.ts): the links the links phase served or reset.
 */
export interface TouchLog {
  /** Systems raised since the last drain, unordered; `sysMark` 1 while listed. */
  sysList: Int32Array;
  sysMark: Uint8Array;
  sysN: number;
  /** Racks visited by the run phase since the last drain; `rackMark` 1 while listed. */
  rackList: Int32Array;
  rackMark: Uint8Array;
  rackN: number;
  /**
   * Racks whose free-slot summary may have moved unseen since the route phase last recounted
   * (a mode change, or a take whose per-tick limit resets next tick); exec/slots recounts them.
   */
  sumList: Int32Array;
  sumMark: Uint8Array;
  sumN: number;
  /**
   * Systems whose rack was dirtied for them since the run phase last read the list (exec/run.ts
   * skips a clean system of a visited rack only when it is not listed); `allDirty` for all.
   */
  dirtyList: Int32Array;
  dirtyMark: Uint8Array;
  dirtyN: number;
  allDirty: boolean;
  /** Links the links phase of tick `linkTick` served or reset: the only links whose busyS moved (phys/energy.ts). */
  linkList: Int32Array;
  linkN: number;
  linkTick: number;
}

const fresh = (): TouchLog => ({
  sysList: new Int32Array(64), sysMark: new Uint8Array(64), sysN: 0,
  rackList: new Int32Array(16), rackMark: new Uint8Array(16), rackN: 0,
  sumList: new Int32Array(16), sumMark: new Uint8Array(16), sumN: 0,
  dirtyList: new Int32Array(64), dirtyMark: new Uint8Array(64), dirtyN: 0, allDirty: false,
  linkList: new Int32Array(64), linkN: 0, linkTick: -1,
});

/** The arrays of the last retired log, cleared, for the next one (an advance call per frame). */
let spare: TouchLog | null = null;

/** A log for one advance call: a new identity (caches key on it), with recycled arrays. */
export function newTouchLog(): TouchLog {
  const s = spare;
  spare = null;
  if (!s) return fresh();
  return {
    sysList: s.sysList, sysMark: s.sysMark, sysN: 0, rackList: s.rackList, rackMark: s.rackMark, rackN: 0,
    sumList: s.sumList, sumMark: s.sumMark, sumN: 0, dirtyList: s.dirtyList, dirtyMark: s.dirtyMark, dirtyN: 0, allDirty: false,
    linkList: s.linkList, linkN: 0, linkTick: -1,
  };
}

/** Ends a log's advance call: clears its marks and keeps its arrays for the next log. */
export function retireTouchLog(log: TouchLog): void {
  drainTouches(log);
  drainSummaries(log);
  for (let i = 0; i < log.dirtyN; i += 1) log.dirtyMark[log.dirtyList[i]!] = 0;
  log.dirtyN = 0;
  spare = { ...log };
  // The retired log keeps no arrays: a stale reader writes nowhere (out-of-range typed-array writes are dropped).
  log.sysList = NO_I32; log.sysMark = NO_U8; log.rackList = NO_I32; log.rackMark = NO_U8;
  log.sumList = NO_I32; log.sumMark = NO_U8; log.dirtyList = NO_I32; log.dirtyMark = NO_U8; log.linkList = NO_I32;
  log.sysN = 0; log.rackN = 0; log.sumN = 0; log.dirtyN = 0; log.linkN = 0;
}
const NO_I32 = new Int32Array(0), NO_U8 = new Uint8Array(0);

function grow(log: TouchLog, systems: number, racks: number): void {
  if (log.sysMark.length < systems) {
    const mark = new Uint8Array(systems * 2); mark.set(log.sysMark); log.sysMark = mark;
    const list = new Int32Array(systems * 2); list.set(log.sysList); log.sysList = list;
  }
  if (log.dirtyMark.length < systems) {
    const mark = new Uint8Array(systems * 2); mark.set(log.dirtyMark); log.dirtyMark = mark;
    const list = new Int32Array(Math.max(systems * 2, log.dirtyList.length)); list.set(log.dirtyList); log.dirtyList = list;
  }
  if (log.rackMark.length < racks) {
    const mark = new Uint8Array(racks * 2); mark.set(log.rackMark); log.rackMark = mark;
    const list = new Int32Array(racks * 2); list.set(log.rackList); log.rackList = list;
  }
  if (log.sumMark.length < racks) {
    const mark = new Uint8Array(racks * 2); mark.set(log.sumMark); log.sumMark = mark;
    const list = new Int32Array(racks * 2); list.set(log.sumList); log.sumList = list;
  }
}

/** System s changed a power input outside a rack visit. */
export function touchSystem(w: World, s: number): void {
  const log = w.touch;
  if (!log) return;
  if (s >= log.sysMark.length) grow(log, s + 1, 0);
  if (log.sysMark[s] === 1) return;
  log.sysMark[s] = 1;
  log.sysList[log.sysN] = s;
  log.sysN += 1;
}

/** The run phase visited rack r. */
export function touchRack(w: World, r: number): void {
  const log = w.touch;
  if (!log) return;
  if (r >= log.rackMark.length) grow(log, 0, r + 1);
  if (log.rackMark[r] === 1) return;
  log.rackMark[r] = 1;
  log.rackList[log.rackN] = r;
  log.rackN += 1;
}

/** Dirties system s's rack for the run phase (rack skip), and lists s for the per-system skip. */
export function dirtySystem(w: World, s: number): void {
  w.hot.rack.dirty[w.compiled.sys.rack[s]!] = 1;
  const log = w.touch;
  if (!log) return;
  if (s >= log.dirtyMark.length) grow(log, s + 1, 0);
  if (log.dirtyMark[s] === 1) return;
  log.dirtyMark[s] = 1;
  // The run phase unmarks a system it visits, so a system can be listed again within one phase.
  if (log.dirtyN === log.dirtyList.length) { const list = new Int32Array(log.dirtyN * 2); list.set(log.dirtyList); log.dirtyList = list; }
  log.dirtyList[log.dirtyN] = s;
  log.dirtyN += 1;
}

/** Every rack and system is dirty (round end). */
export function dirtyAll(w: World): void {
  w.hot.rack.dirty.fill(1);
  if (w.touch) w.touch.allDirty = true;
}

/** Rack r's free-slot summary may have moved without a noteAdmit (exec/slots). */
export function touchSummary(w: World, r: number): void {
  const log = w.touch;
  if (!log || r < 0) return;
  if (r >= log.sumMark.length) grow(log, 0, r + 1);
  if (log.sumMark[r] === 1) return;
  log.sumMark[r] = 1;
  log.sumList[log.sumN] = r;
  log.sumN += 1;
}

/** Empties the summary list (exec/slots, after recounting). */
export function drainSummaries(log: TouchLog): void {
  for (let i = 0; i < log.sumN; i += 1) log.sumMark[log.sumList[i]!] = 0;
  log.sumN = 0;
}

/** Empties the power lists (phys, after reading them). */
export function drainTouches(log: TouchLog): void {
  for (let i = 0; i < log.sysN; i += 1) log.sysMark[log.sysList[i]!] = 0;
  for (let i = 0; i < log.rackN; i += 1) log.rackMark[log.rackList[i]!] = 0;
  log.sysN = 0; log.rackN = 0;
}
