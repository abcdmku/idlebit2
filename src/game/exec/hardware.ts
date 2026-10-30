import { G, LOC } from '../core/buffers';
import { ACCEL_DOMAINS, POOL_DOMAIN } from '../core/constants';
import { dirtyAll } from '../core/touch';
import type { World } from '../core/world';
import type { GameAction } from '../types/actions';
import { clockAt } from './clocks';
import { hardwareAccelAssignment, rebaseHardwareAccelerators, type HardwareAccelAssignment } from './hardwareAccelerators';
import { reconcileHardwareTransfers } from './hardwareTransfers';
import { CAUSE, failRecord } from './outcome';
import { releaseQueuedPreload, stopPreload } from './preload';
import { evictWorkspace } from './residentWorkspace';
import { recountResearchThreads } from './researchTask';
import { CPU, shapeOf } from './shape';
import { reconcileAccelerators } from './reconcile';

/** Hardware changes retain existing placements and completed work. Only unsupported jobs fail. */
export function reconcileHardware(w: World, old: World, action?: GameAction): void {
  const c = w.compiled.sys, prior = old.compiled.sys, h = w.hot.sys, rec = w.hot.rec;
  reconcileHardwareTransfers(w, old);
  const accelerators = new Set<number>(), rebind = new Set<number>();
  const reduced = (now: Float64Array | Uint16Array | Uint32Array, before: typeof now, s: number) => now[s]! < (before[s] ?? 0);
  for (let s = 0; s < c.len; s++) {
    if (c.alive[s] !== 1) { h.researchThreads[s] = 0; continue; }
    if (w.build.systems[s]?.spec.accels !== old.build.systems[s]?.spec.accels || c.gpuLinked[s] !== prior.gpuLinked[s]) accelerators.add(s);
    if (c.threads[s] !== prior.threads[s] || w.build.systems[s]?.spec.cpu !== old.build.systems[s]?.spec.cpu
      || w.build.systems[s]?.spec.cpuCount !== old.build.systems[s]?.spec.cpuCount) rebind.add(s);
    if (rebind.has(s) || reduced(c.cacheBits, prior.cacheBits, s)) stopPreload(old, s, clockAt(old, s, CPU, w.hot.rack.effClock[c.rack[s]!]!));
    if (reduced(c.cacheBits, prior.cacheBits, s)) {
      evictWorkspace(old, s);
      for (let r = h.queueHead[s]!; r >= 0; r = rec.next[r]!) releaseQueuedPreload(old, s, r);
    }
    if (reduced(c.threads, prior.threads, s)) h.researchThreads[s] = 0;
  }
  let assignments = new Map<number, HardwareAccelAssignment>();
  for (;;) {
    const cache = new Float64Array(c.len), ram = new Float64Array(c.len), disk = new Float64Array(c.len), threads = new Float64Array(c.len);
    const vram = new Float64Array(c.len * ACCEL_DOMAINS);
    assignments = new Map();
    const running: number[] = [];
    for (let r = 0; r < rec.len; r++) if (rec.loc[r] === LOC.running) running.push(r);
    running.sort((a, b) => rec.taken[a]! - rec.taken[b]! || rec.taskId[a]! - rec.taskId[b]! || a - b);
    let failed = false;
    for (const r of running) {
      const s = rec.owner[r]!, k = rec.count[r]!, node = prior.diskNode[s]!;
      const cacheBits = rec.memC[r]! * k, ramBits = (rec.memR[r]! + rec.vramR[r]!) * k;
      const nodeBits = (rec.memN[r]! + rec.vramN[r]!) * k, diskBits = (rec.memD[r]! + rec.vramD[r]!) * k - nodeBits;
      const heldThreads = rec.threads[r]! * k;
      let fits = c.alive[s] === 1 && c.threads[s]! > 0 && c.clockHz[s]! > 0;
      if (shapeOf(rec.family[r]!).def.ecc && c.ecc[s] !== 1) fits = false;
      if (reduced(c.cacheBits, prior.cacheBits, s) && cache[s]! + cacheBits > c.cacheBits[s]!) fits = false;
      if (reduced(c.ramCap, prior.ramCap, s) && ram[s]! + ramBits > c.ramCap[s]!) fits = false;
      if (reduced(c.storageCap, prior.storageCap, s) && disk[s]! + diskBits > c.storageCap[s]!) fits = false;
      if (nodeBits > 0 && (node < 0 || c.diskNode[s] !== node || c.alive[node] !== 1
        || reduced(c.storageCap, prior.storageCap, node) && disk[node]! + nodeBits > c.storageCap[node]!)) fits = false;
      if (reduced(c.threads, prior.threads, s) && c.strategy[s] !== 2 && threads[s]! + heldThreads > c.threads[s]!) fits = false;
      if (reduced(c.threads, prior.threads, s) && rec.threads[r]! > c.threads[s]!) fits = false;
      if (fits && accelerators.has(s)) {
        let preferred = rec.accelDomain[r]!;
        if (action?.type === 'removePart' && action.part.unit.kind === 'system' && action.part.unit.id === s && action.part.slot.kind === 'gpu' && preferred >= 0 && preferred < POOL_DOMAIN) {
          if (preferred === action.part.slot.index) fits = false;
          else if (preferred > action.part.slot.index) preferred--;
        }
        if (fits) {
          const assignment = hardwareAccelAssignment(w, r, vram, preferred);
          if (!assignment) fits = false; else assignments.set(r, assignment);
        }
      }
      if (!fits) { failRecord(old, r, CAUSE.swap); failed = true; break; }
      cache[s] = cache[s]! + cacheBits; ram[s] = ram[s]! + ramBits; disk[s] = disk[s]! + diskBits;
      if (node >= 0) disk[node] = disk[node]! + nodeBits;
      threads[s] = threads[s]! + heldThreads;
    }
    if (!failed) break;
  }
  rebaseHardwareAccelerators(w, old, accelerators, assignments);
  for (const s of rebind) {
    let cursor = 0;
    for (let r = 0; r < rec.len; r++) if (rec.loc[r] === LOC.running && rec.owner[r] === s) {
      rec.thread0[r] = c.threads[s]! > 0 ? cursor % c.threads[s]! : 0;
      cursor += rec.threads[r]! * rec.count[r]!;
    }
  }
  h.busyThreads.fill(0); w.hot.g[G.busyThreads] = 0;
  let holders = 0;
  for (let r = 0; r < rec.len; r++) {
    const s = rec.owner[r]!;
    const threads = rec.loc[r] === LOC.running ? rec.threads[r]! * rec.count[r]!
      : rec.loc[r] === LOC.queue && rec.loaderThread[r]! >= 0 ? 1 : 0;
    if (threads > 0) { h.busyThreads[s] = h.busyThreads[s]! + threads; w.hot.g[G.busyThreads] = w.hot.g[G.busyThreads]! + threads; }
  }
  for (let s = 0; s < c.len; s++) if (h.researchThreads[s]! > 0) holders++;
  w.hot.g[G.researchHolders] = holders;
  recountResearchThreads(w);
  if (!accelerators.size) reconcileAccelerators(w, old.compiled);
  dirtyAll(w);
}
