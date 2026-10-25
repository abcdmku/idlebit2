import { G } from '../core/buffers';
import type { World } from '../core/world';
import { clockAt, refreshDue, type Span } from './clocks';
import { hwThreads } from './est';
import { runInsert, runUnlink } from './lists';
import { hasRule } from './rules';
import { strategyOf } from './schedulers';
import { CPU, NRES, shapeOf } from './shape';

/**
 * workStealing (spec §6.5, §8.2): at allocation, free threads join running compute-stage tasks
 * that hold fewer than their `threads`, oldest first. A task's remaining work is preserved: its
 * finish moves to W + (finish − W) × old / new threads.
 */
export function stealThreads(w: World, s: number, span: Span): boolean {
  if (!hasRule(w, 'workStealing') || strategyOf(w, s).timeSlice) return false;
  const h = w.hot.sys, rec = w.hot.rec;
  const H = hwThreads(w, s);
  let changed = false;
  for (;;) {
    const free = H - h.busyThreads[s]!;
    if (free <= 0) return changed;
    let best = -1;
    for (let r = h.head[s * NRES + CPU]!; r >= 0; r = rec.next[r]!) {
      if (rec.threads[r]! >= Math.min(shapeOf(rec.family[r]!).threads, H) || rec.count[r]! > free) continue;
      if (best < 0 || rec.taken[r]! < rec.taken[best]! || (rec.taken[r] === rec.taken[best] && rec.taskId[r]! < rec.taskId[best]!)) best = r;
    }
    if (best < 0) return changed;
    const k = rec.count[best]!, have = rec.threads[best]!;
    const add = Math.min(Math.min(shapeOf(rec.family[best]!).threads, H) - have, Math.floor(free / k));
    const W = clockAt(w, s, CPU, span.x0[CPU]!);
    runUnlink(w.hot, s, CPU, best);
    rec.finish[best] = W + ((rec.finish[best]! - W) * have) / (have + add);
    rec.threads[best] = have + add;
    runInsert(w.hot, s, CPU, best);
    refreshDue(w, s, CPU);
    h.busyThreads[s] = h.busyThreads[s]! + k * add;
    w.hot.g[G.busyThreads] = w.hot.g[G.busyThreads]! + k * add;
    changed = true;
  }
}
