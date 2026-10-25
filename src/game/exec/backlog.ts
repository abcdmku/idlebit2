import { LOC, type CompiledBuffers, type HotBuffers } from '../core/buffers';
import { accelNeed, chooseAccel } from '../core/accelerators';
import type { TouchLog } from '../core/touch';
import type { World } from '../core/world';
import { CPU, GPU, RAM, shapeOf, stageWorkAt, wantThreads, workingSetOf } from './shape';
import { staticFractions } from './memory';

const frac = new Float64Array(2);

/*
 * Queued work per system for the site- and global-scope routing summaries (program D24, spec
 * §8.3). A system's backlog is Σ count × units over the tasks it holds: reserved (in transfer to
 * it), queued and running. A task's units are its nominal est on the system (compiled rates, e(T),
 * clock factor and contention at 1, every stage) in whole 2⁻¹⁶ s, capped. Integers sum exactly
 * in any order, so the incrementally kept backlog always equals a recount from the records: it is
 * a pure function of state, as delta invariance and the owned path need.
 *
 * Derived, never state, kept per hot and compiled buffers: exec updates it on every
 * admitted-count change (noteAdmitted). A writer that bypasses exec cannot leave it stale unseen:
 * the first use in each advance call (each route phase without a touch log) checks every system's
 * held count against the one the backlog last saw, and rebuilds from the records on a mismatch.
 */

/** Backlog units per second. */
export const UNITS_PER_S = 65_536;
/** A task's units are capped here (2³⁶ units, about 12 days): any longer backlog ranks as full. */
export const UNITS_MAX = 2 ** 36;

/** est(task) at compiled rates (estOn with e(T), clock factor 1 and the configuration factor). */
export function estNominal(c: CompiledBuffers, s: number, family: number, scale: number): number {
  const shape = shapeOf(family), sys = c.sys;
  const eta = sys.etaCfg[s]!;
  const clock = sys.threadRate[s]! * eta;
  const accel = chooseAccel(c, null, s, accelNeed(shape.def, scale), 1)?.opsPerS ?? 0;
  const threads = Math.max(1, sys.threads[s]!);
  const node = sys.diskNode[s]!, io = sys.ioRate[s]! + (node >= 0 ? sys.ioRate[node]! : 0);
  staticFractions(c, s, workingSetOf(shape, scale), frac);
  let secs = 0;
  for (let i = 0; i < shape.stages; i += 1) {
    const work = stageWorkAt(shape, i, scale);
    if (!(work > 0)) continue;
    switch (shape.res[i]) {
      case CPU: { const rate = Math.min(wantThreads(shape, scale), threads) * clock; secs += rate > 0 ? work / rate : Infinity; break; }
      case GPU: { const rate = accel * eta; secs += rate > 0 ? work / rate : Infinity; break; }
      case RAM: {
        // D26.2: the mem stage's RAM and disk parts, its working set placed in the empty hierarchy.
        if (frac[0]! > 0) secs += sys.ramBw[s]! > 0 ? work * frac[0]! / sys.ramBw[s]! : Infinity;
        if (frac[1]! > 0) secs += io > 0 ? work * frac[1]! / io : Infinity;
        break;
      }
    }
  }
  return secs;
}

/** One task of `family` at `scale` on system s, in backlog units. */
export function taskUnits(c: CompiledBuffers, s: number, family: number, scale: number): number {
  const units = estNominal(c, s, family, scale) * UNITS_PER_S;
  return units >= UNITS_MAX || !(units >= 0) ? UNITS_MAX : Math.round(units);
}

export interface Backlog {
  readonly hot: HotBuffers;
  readonly compiled: CompiledBuffers;
  /** The advance call's log (or the route phase, without one) it was last checked in. */
  log: TouchLog | undefined;
  phase: number;
  /** Per system: Σ count × units of the tasks it holds, and the held count it has seen. */
  readonly units: Float64Array;
  readonly held: Float64Array;
  /** Per rack: 1 when a member's backlog or can-admit may have moved since the summary read it. */
  readonly rackDirty: Uint8Array;
  /** Per rack: which slots could admit when the summary last read it (bit k = slot k), -1 unknown. */
  readonly admitMask: Int32Array;
  readonly dirtyList: Int32Array;
  dirtyN: number;
}

let current: Backlog | null = null;

/** Sums the backlog of every system from the records (the brute-force definition). */
export function recountBacklog(c: CompiledBuffers, hot: HotBuffers, units: Float64Array, held?: Float64Array): void {
  units.fill(0);
  held?.fill(0);
  const rec = hot.rec;
  for (let r = 0; r < rec.len; r += 1) {
    const loc = rec.loc[r];
    const s = loc === LOC.link ? rec.target[r]! : loc === LOC.queue || loc === LOC.running ? rec.owner[r]! : -1;
    if (s < 0 || s >= c.sys.len) continue;
    units[s] = units[s]! + rec.count[r]! * taskUnits(c, s, rec.family[r]!, rec.units[r]!);
    if (held) held[s] = held[s]! + rec.count[r]!;
  }
}

/** The backlog of these hot and compiled buffers, or null. */
const keptFor = (w: World): Backlog | null => {
  const b = current;
  return b !== null && b.hot === w.hot && b.compiled === w.compiled ? b : null;
};

/** Every system holds the count the backlog saw (running + queued + reserved). */
function heldMatches(w: World, b: Backlog): boolean {
  const h = w.hot.sys, held = b.held;
  for (let s = 0; s < w.compiled.sys.len; s += 1) if (h.running[s]! + h.queueLen[s]! + h.reserved[s]! !== held[s]) return false;
  return true;
}

/**
 * The world's backlog: kept while its buffers stay the same, checked once per advance call (per
 * route `phase` without a log), else rebuilt from the records with every rack dirty.
 */
export function backlogFor(w: World, phase: number): Backlog {
  const kept = keptFor(w);
  if (kept) {
    const checked = w.touch !== undefined ? kept.log === w.touch : kept.log === undefined && kept.phase === phase;
    if (checked) return kept;
    if (heldMatches(w, kept)) { kept.log = w.touch; kept.phase = phase; return kept; }
  }
  const c = w.compiled;
  const units = new Float64Array(c.sys.len), held = new Float64Array(c.sys.len);
  recountBacklog(c, w.hot, units, held);
  const next: Backlog = {
    hot: w.hot, compiled: c, log: w.touch, phase, units, held,
    rackDirty: new Uint8Array(c.rack.len).fill(1), admitMask: new Int32Array(c.rack.len).fill(-1),
    dirtyList: new Int32Array(c.rack.len), dirtyN: c.rack.len,
  };
  for (let r = 0; r < c.rack.len; r += 1) next.dirtyList[r] = r;
  current = next;
  return next;
}

/** Rack r's summary must be re-read. */
function markRack(b: Backlog, r: number): void {
  if (r < 0 || r >= b.rackDirty.length || b.rackDirty[r] === 1) return;
  b.rackDirty[r] = 1;
  b.dirtyList[b.dirtyN] = r;
  b.dirtyN += 1;
}

/** Empties the dirty list (net/summary, after re-reading the racks). */
export function clearDirty(b: Backlog): void {
  for (let i = 0; i < b.dirtyN; i += 1) b.rackDirty[b.dirtyList[i]!] = 0;
  b.dirtyN = 0;
}

/**
 * k = delta tasks of record r joined (+) or left (−) system s's held work. Without the record
 * (a test helper) the backlog is dropped and rebuilt on its next use.
 */
export function noteBacklog(w: World, s: number, delta: number, r: number): void {
  const b = keptFor(w);
  if (!b) return;
  if (r < 0) { current = null; return; }
  const rec = w.hot.rec;
  b.units[s] = b.units[s]! + delta * taskUnits(w.compiled, s, rec.family[r]!, rec.units[r]!);
  b.held[s] = b.held[s]! + delta;
  markRack(b, w.compiled.sys.rack[s]!);
}

/** System s's can-admit may have flipped, or its rack was recounted: the rack summary is re-read. */
export function noteAdmitChange(w: World, rack: number): void {
  const b = keptFor(w);
  if (b) markRack(b, rack);
}

/** A recount found rack r's systems that can admit (bit k = slot k): re-read it if they moved. */
export function noteRackAdmits(w: World, rack: number, mask: number): void {
  const b = keptFor(w);
  if (b && rack < b.admitMask.length && b.admitMask[rack] !== mask) markRack(b, rack);
}

/** Round end freed every record without per-record notes: drop the backlog. */
export function dropBacklog(w: World): void {
  if (current && current.hot === w.hot) current = null;
}

