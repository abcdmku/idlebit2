import { G } from '../core/buffers';
import { ACCEL_CLOCKS } from '../core/constants';
import type { World } from '../core/world';
import { executionBoundary } from './boundary';
import { axisAt, clockAt, type Span } from './clocks';
import { CPU, NRES, shapeOf, workingSetOf } from './shape';
import { activeLoaders, stopLoader, syncPreload } from './preloadState';
import { evictWorkspace, retainWorkspace, useWorkspace } from './residentWorkspace';

function freeThread(w: World, s: number): number {
  const h = w.hot.sys, rec = w.hot.rec, used = new Uint8Array(w.compiled.sys.threads[s]!);
  const mark = (r: number) => {
    const first = rec.thread0[r]!;
    if (first >= 0) for (let t = first; t < Math.min(used.length, first + rec.threads[r]! * rec.count[r]!); t++) used[t] = 1;
  };
  for (let res = 0; res < NRES; res++) if (res !== 2)
    for (let r = h.head[s * NRES + res]!; r >= 0; r = rec.next[r]!) mark(r);
  for (let a = 0; a < ACCEL_CLOCKS; a++) for (let r = h.accelHead[s * ACCEL_CLOCKS + a]!; r >= 0; r = rec.next[r]!) mark(r);
  for (let r = h.queueHead[s]!; r >= 0; r = rec.next[r]!) if (rec.loaderThread[r]! >= 0) used[rec.loaderThread[r]!] = 1;
  let research = h.researchThreads[s]!;
  for (let t = 0; t < used.length; t++) if (!used[t]) { if (research > 0) research--; else return t; }
  return -1;
}

export function stopPreload(w: World, s: number, at: number): void {
  for (let r = w.hot.sys.queueHead[s]!; r >= 0; r = w.hot.rec.next[r]!) stopLoader(w, s, r, at);
  syncPreload(w, s);
}

export function releaseQueuedPreload(w: World, s: number, r: number): void {
  const rec = w.hot.rec;
  if (rec.preloadBits[r] === 0 && rec.loaderThread[r]! < 0) return;
  stopLoader(w, s, r, clockAt(w, s, CPU, executionBoundary(w, s)));
  w.hot.sys.usedCache[s] = Math.max(0, w.hot.sys.usedCache[s]! - rec.preloadBits[r]! * rec.count[r]!);
  rec.preloadBits[r] = 0; rec.preloadDone[r] = 0; rec.batchBits[r] = 0;
  syncPreload(w, s);
}

export function takePreload(w: World, s: number, r: number, tau: number, span: Span): void {
  const h = w.hot.sys, rec = w.hot.rec;
  useWorkspace(w, s, r);
  stopLoader(w, s, r, clockAt(w, s, CPU, axisAt(span, CPU, tau)));
  h.usedCache[s] = Math.max(0, h.usedCache[s]! - rec.preloadBits[r]! * rec.count[r]!);
  rec.preloadBits[r] = 0;
  h.batchSavedBits[s] = h.batchSavedBits[s]! + rec.batchBits[r]! * rec.count[r]!;
  syncPreload(w, s);
}

/** Bounded preparation. Every loader pays one CPU op per cache bit on its own physical core. */
export function prepareQueued(w: World, s: number, tau: number, span: Span): boolean {
  const c = w.compiled.sys, h = w.hot.sys, rec = w.hot.rec;
  if (c.Q[s] === 0) return false;
  const limit = Math.min(c.preloadLoaders[s]!, w.build.systems[s]?.spec.settings.queueLoaderLimit ?? 4);
  if (activeLoaders(w, s) > limit) stopPreload(w, s, clockAt(w, s, CPU, axisAt(span, CPU, tau)));
  if (h.busyThreads[s]! >= c.threads[s]!) return false;
  let active = activeLoaders(w, s), prepared = 0, changed = false;
  for (let r = h.queueHead[s]!; r >= 0; r = rec.next[r]!) if (rec.preloadBits[r]! > 0) prepared++;
  for (let r = h.queueHead[s]!; r >= 0 && active < limit; r = rec.next[r]!) {
    if (rec.count[r] !== 1 || rec.loaderThread[r]! >= 0) continue;
    if (rec.preloadBits[r] === 0 && prepared >= c.preloadTargets[s]!) continue;
    const goal = Math.min(c.cacheBits[s]!, workingSetOf(shapeOf(rec.family[r]!), rec.units[r]!));
    if (goal <= rec.preloadDone[r]!) continue;
    const thread = freeThread(w, s);
    if (thread < 0) break;
    const wasEmpty = rec.preloadBits[r] === 0;
    useWorkspace(w, s, r);
    if (goal - rec.preloadBits[r]! > c.cacheBits[s]! - h.usedCache[s]!) evictWorkspace(w, s);
    const extra = Math.min(Math.max(0, goal - rec.preloadBits[r]!), Math.max(0, c.cacheBits[s]! - h.usedCache[s]!));
    if (rec.preloadBits[r]! + extra <= rec.preloadDone[r]!) { if (wasEmpty && rec.preloadBits[r]! > 0) prepared++; continue; }
    rec.preloadBits[r] = rec.preloadBits[r]! + extra;
    h.usedCache[s] = h.usedCache[s]! + extra;
    rec.loaderThread[r] = thread;
    rec.loaderStart[r] = clockAt(w, s, CPU, axisAt(span, CPU, tau));
    rec.loaderFinish[r] = rec.loaderStart[r]! + rec.preloadBits[r]! - rec.preloadDone[r]!;
    h.busyThreads[s] = h.busyThreads[s]! + 1;
    w.hot.g[G.busyThreads] = w.hot.g[G.busyThreads]! + 1;
    active++; if (wasEmpty) prepared++; changed = true;
  }
  syncPreload(w, s);
  return changed;
}

export function finishPreload(w: World, s: number): void {
  const at = w.hot.sys.preloadFinish[s]!;
  for (let r = w.hot.sys.queueHead[s]!; r >= 0; r = w.hot.rec.next[r]!)
    if (w.hot.rec.loaderThread[r]! >= 0 && w.hot.rec.loaderFinish[r]! <= at) stopLoader(w, s, r, at);
  syncPreload(w, s);
}

export function handoffBatch(w: World, s: number, from: number, tau: number, span: Span): void {
  const h = w.hot.sys, rec = w.hot.rec;
  if (w.compiled.sys.queueBatching[s] !== 1 || rec.count[from] !== 1) return;
  const bits = Math.min(shapeOf(rec.family[from]!).def.workingSet.fixed, rec.memC[from]!);
  if (!(bits > 0)) return;
  let next = -1, prepared = 0;
  for (let r = h.queueHead[s]!; r >= 0; r = rec.next[r]!) {
    if (rec.preloadBits[r]! > 0) prepared++;
    if (next < 0 && rec.family[r] === rec.family[from] && rec.count[r] === 1) next = r;
  }
  if (next < 0 || rec.preloadBits[next] === 0 && prepared >= w.compiled.sys.preloadTargets[s]!) { retainWorkspace(w, s, from); return; }
  if (rec.preloadDone[next]! >= bits) return;
  stopLoader(w, s, next, clockAt(w, s, CPU, axisAt(span, CPU, tau)));
  // The loader may have passed this workspace since its stored prefix was last settled.
  if (rec.preloadDone[next]! >= bits) { syncPreload(w, s); return; }
  const extra = Math.max(0, bits - rec.preloadBits[next]!);
  h.usedCache[s] = h.usedCache[s]! + extra;
  rec.preloadBits[next] = Math.max(bits, rec.preloadBits[next]!);
  rec.batchBits[next] = rec.batchBits[next]! + bits - rec.preloadDone[next]!;
  rec.preloadDone[next] = bits;
  syncPreload(w, s);
}
export { activeLoaders } from './preloadState';
