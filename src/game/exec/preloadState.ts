import type { World } from '../core/world';
import { G } from '../core/buffers';

export function activeLoaders(w: World, s: number): number {
  let n = 0;
  for (let r = w.hot.sys.queueHead[s]!; r >= 0; r = w.hot.rec.next[r]!) if (w.hot.rec.loaderThread[r]! >= 0) n++;
  return n;
}

/** Compatibility summary: earliest active loader, otherwise the first resident prepared task. */
export function syncPreload(w: World, s: number): void {
  const h = w.hot.sys, rec = w.hot.rec;
  let first = -1, active = -1;
  for (let r = h.queueHead[s]!; r >= 0; r = rec.next[r]!) {
    if (rec.preloadBits[r]! > 0 && first < 0) first = r;
    if (rec.loaderThread[r]! >= 0 && (active < 0 || rec.loaderFinish[r]! < rec.loaderFinish[active]!)) active = r;
  }
  const r = active >= 0 ? active : first;
  h.preloadRec[s] = r;
  h.preloadThread[s] = active >= 0 ? rec.loaderThread[active]! : -1;
  h.preloadStart[s] = active >= 0 ? rec.loaderStart[active]! : 0;
  h.preloadFinish[s] = active >= 0 ? rec.loaderFinish[active]! : Infinity;
}

export function stopLoader(w: World, s: number, r: number, at: number): void {
  const rec = w.hot.rec;
  if (rec.loaderThread[r]! < 0) return;
  // Reaching the scheduled finish settles the exact target. Subtracting large work
  // clocks can leave a fractional remainder that would restart at the same instant.
  rec.preloadDone[r] = at >= rec.loaderFinish[r]! ? rec.preloadBits[r]!
    : Math.min(rec.preloadBits[r]!, rec.preloadDone[r]! + Math.max(0, at - rec.loaderStart[r]!));
  rec.loaderThread[r] = -1; rec.loaderFinish[r] = Infinity;
  w.hot.sys.busyThreads[s] = w.hot.sys.busyThreads[s]! - 1;
  w.hot.g[G.busyThreads] = w.hot.g[G.busyThreads]! - 1;
}
