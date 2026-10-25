import type { HotBuffers } from '../core/buffers';
import { NRES } from './shape';

/**
 * Exec's record lists, linked through rec.prev / rec.next.
 * - Run lists: one per (system, resource), head in sys.head, sorted by `finish` ascending (ties
 *   keep insertion order). Waiting records (no IO hold, no free thread) carry finish = Infinity and
 *   so sit at the tail in FIFO order.
 * - Queue: one per system, head/tail in sys.queueHead / queueTail, insertion order. queueLen holds
 *   the queued *task* count (sum of record counts), not the record count.
 */

export function runInsert(hot: HotBuffers, sys: number, res: number, r: number): void {
  sortedInsert(hot, hot.sys.head, sys * NRES + res, r);
}

/** Shared list mechanics for resource and accelerator work clocks. */
export function sortedInsert(hot: HotBuffers, heads: Int32Array, slot: number, r: number): void {
  const { prev, next, finish } = hot.rec;
  const f = finish[r]!;
  let before = heads[slot]!;
  let after = -1;
  while (before >= 0 && finish[before]! <= f) { after = before; before = next[before]!; }
  prev[r] = after;
  next[r] = before;
  if (after >= 0) next[after] = r; else heads[slot] = r;
  if (before >= 0) prev[before] = r;
}

export function runUnlink(hot: HotBuffers, sys: number, res: number, r: number): void {
  sortedUnlink(hot, hot.sys.head, sys * NRES + res, r);
}

export function sortedUnlink(hot: HotBuffers, heads: Int32Array, slot: number, r: number): void {
  const { prev, next } = hot.rec;
  const p = prev[r]!, n = next[r]!;
  if (p >= 0) next[p] = n; else heads[slot] = n;
  if (n >= 0) prev[n] = p;
  prev[r] = -1;
  next[r] = -1;
}

export function queuePush(hot: HotBuffers, sys: number, r: number): void {
  const { prev, next } = hot.rec;
  const tail = hot.sys.queueTail[sys]!;
  prev[r] = tail;
  next[r] = -1;
  if (tail >= 0) next[tail] = r; else hot.sys.queueHead[sys] = r;
  hot.sys.queueTail[sys] = r;
}

/** Inserts r directly after `after` in the system queue (used when a start splits a record). */
export function queueInsertAfter(hot: HotBuffers, sys: number, after: number, r: number): void {
  const { prev, next } = hot.rec;
  const n = next[after]!;
  prev[r] = after;
  next[r] = n;
  next[after] = r;
  if (n >= 0) prev[n] = r; else hot.sys.queueTail[sys] = r;
}

export function queueUnlink(hot: HotBuffers, sys: number, r: number): void {
  const { prev, next } = hot.rec;
  const p = prev[r]!, n = next[r]!;
  if (p >= 0) next[p] = n; else hot.sys.queueHead[sys] = n;
  if (n >= 0) prev[n] = p; else hot.sys.queueTail[sys] = p;
  prev[r] = -1;
  next[r] = -1;
}
