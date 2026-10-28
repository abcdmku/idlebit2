import type { World } from '../core/world';
import { shapeOf } from './shape';

export function evictWorkspace(w: World, s: number): void {
  const h = w.hot.sys;
  h.usedCache[s] = Math.max(0, h.usedCache[s]! - h.residentBits[s]!);
  h.residentBits[s] = 0; h.residentFamily[s] = -1;
}

/** Transfer real fixed workspace into a task. Private inputs are never shared. */
export function useWorkspace(w: World, s: number, r: number): void {
  const h = w.hot.sys, rec = w.hot.rec;
  if (h.residentFamily[s] !== rec.family[r] || rec.count[r] !== 1) return;
  const bits = Math.min(h.residentBits[s]!, shapeOf(rec.family[r]!).def.workingSet.fixed);
  if (bits <= rec.preloadDone[r]!) return;
  const extra = Math.max(0, bits - rec.preloadBits[r]!);
  evictWorkspace(w, s);
  rec.batchBits[r] = rec.batchBits[r]! + bits - rec.preloadDone[r]!;
  rec.preloadBits[r] = Math.max(bits, rec.preloadBits[r]!); rec.preloadDone[r] = bits;
  h.usedCache[s] = h.usedCache[s]! + extra;
}

export function retainWorkspace(w: World, s: number, r: number): void {
  if (w.compiled.sys.residentWorkspace[s] !== 1 || w.compiled.sys.queueBatching[s] !== 1 || w.hot.rec.count[r] !== 1) return;
  const bits = Math.min(shapeOf(w.hot.rec.family[r]!).def.workingSet.fixed, w.hot.rec.memC[r]!);
  if (!(bits > 0)) return;
  evictWorkspace(w, s);
  w.hot.sys.residentFamily[s] = w.hot.rec.family[r]!; w.hot.sys.residentBits[s] = bits;
  w.hot.sys.usedCache[s] = w.hot.sys.usedCache[s]! + bits;
}
