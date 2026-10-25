import { DEADLINE_BUCKETS } from './constants';
import type { HotBuffers } from './buffers';

/**
 * The D26.5 deadline ring (architecture §1.4). Every taken task with a completion window owns a parent
 * row (net/hops, exec/alloc), linked into bucket (taken + deadline − 1) % DEADLINE_BUCKETS. The
 * deadlines phase pops this tick's bucket (market/queue); a freed row leaves its bucket (core/pool).
 */

/** Last tick parent row p may be met: takeTick + deadline − 1. */
export const windowEnd = (hot: HotBuffers, p: number): number => hot.parent.taken[p]! + hot.parent.deadline[p]! - 1;

/** Links parent row p (deadline set) into its bucket, at the front. */
export function linkDeadline(hot: HotBuffers, p: number): void {
  const par = hot.parent;
  if (par.deadline[p]! < 0) return;
  const b = windowEnd(hot, p) % DEADLINE_BUCKETS;
  const head = hot.dlHead[b]!;
  par.dlPrev[p] = -1; par.dlNext[p] = head;
  if (head >= 0) par.dlPrev[head] = p;
  hot.dlHead[b] = p;
}

/** Unlinks parent row p from its bucket, if linked. */
export function unlinkDeadline(hot: HotBuffers, p: number): void {
  const par = hot.parent;
  if (par.deadline[p]! < 0) return;
  const b = windowEnd(hot, p) % DEADLINE_BUCKETS;
  const prev = par.dlPrev[p]!, next = par.dlNext[p]!;
  if (prev >= 0) par.dlNext[prev] = next;
  else if (hot.dlHead[b] === p) hot.dlHead[b] = next;
  else return;
  if (next >= 0) par.dlPrev[next] = prev;
  par.dlPrev[p] = -1; par.dlNext[p] = -1;
}

/** Parent rows whose window ends at `tick`, in bucket order, into `out`. */
export function dueAt(hot: HotBuffers, tick: number, out: number[]): number[] {
  out.length = 0;
  for (let p = hot.dlHead[tick % DEADLINE_BUCKETS]!; p >= 0; p = hot.parent.dlNext[p]!) if (windowEnd(hot, p) === tick) out.push(p);
  return out;
}
