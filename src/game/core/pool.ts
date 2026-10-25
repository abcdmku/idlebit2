import { G, LOC, PARENT, RECORD, type HotBuffers } from './buffers';
import { copyRow, growTable, resetRow } from './table';
import { unlinkDeadline } from './deadlines';

/**
 * Record and parent pools with free lists (architecture §1.4, D25), and doubly linked list ops over
 * rec.prev / rec.next. Only call on a World's cloned hot buffers.
 */

export function allocRecord(hot: HotBuffers): number {
  const rec = hot.rec;
  let r = hot.g[G.recFree]!;
  if (r >= 0) {
    hot.g[G.recFree] = rec.next[r]!;
  } else {
    if (rec.len >= rec.cap) growTable(RECORD, rec, rec.len + 1);
    r = rec.len;
    rec.len += 1;
  }
  resetRow(RECORD, rec, r);
  hot.g[G.recUsed] = hot.g[G.recUsed]! + 1;
  return r;
}

/** The record must already be unlinked from every list and have released its resource holds. */
/**
 * Test and dev hook: freeRecord checks that a record is freed once and, once freed, is in no parent's
 * sibling list. O(siblings) per free; never on in play.
 */
export const poolDebug = { verify: false };

export function freeRecord(hot: HotBuffers, r: number): void {
  const rec = hot.rec;
  // LOC.free also marks a record taken off every list before its free; count 0 marks a freed one.
  if (poolDebug.verify && rec.count[r] === 0) throw new Error(`pool: record ${r} freed twice`);
  const p = rec.parent[r]!;
  if (p >= 0) dropSibling(hot, r);
  if (poolDebug.verify && p >= 0) {
    for (let q = hot.parent.head[p]!, n = 0; q >= 0 && n <= 256; q = rec.sib[q]!, n += 1) {
      if (q === r) throw new Error(`pool: freed record ${r} is still in parent ${p}'s sibling list`);
    }
  }
  rec.loc[r] = LOC.free;
  rec.accelDomain[r] = -1;
  rec.count[r] = 0;
  rec.next[r] = hot.g[G.recFree]!;
  hot.g[G.recFree] = r;
  hot.g[G.recUsed] = hot.g[G.recUsed]! - 1;
}

/**
 * Splits k tasks off record r into a new unlinked record (same family, size, take tick, stage,
 * progress and accelerator domain). A running split retains its domain in both pieces;
 * aggregate VRAM and holder counts stay unchanged. Each piece releases its own count.
 * Returns the new record. Records never merge.
 */
export function splitRecord(hot: HotBuffers, r: number, k: number): number {
  const count = hot.rec.count[r]!;
  if (!(k > 0 && k < count)) throw new Error(`splitRecord: cannot take ${k} of ${count}`);
  const s = allocRecord(hot);
  copyRow(RECORD, hot.rec, r, s);
  const rec = hot.rec;
  rec.count[r] = count - k;
  rec.count[s] = k;
  // The extracted prefix keeps the oldest IDs; the remaining cohort starts after that prefix.
  rec.taskId[r] = rec.taskId[r]! + k;
  rec.prev[s] = -1; rec.next[s] = -1;
  return s;
}

/** A parent row (D25) for a task split into several shards. Live rows have placed + pending > 0. */
export function allocParent(hot: HotBuffers): number {
  const p = hot.parent;
  let i = hot.g[G.parentFree]!;
  if (i >= 0) {
    hot.g[G.parentFree] = p.next[i]!;
  } else {
    if (p.len >= p.cap) growTable(PARENT, p, p.len + 1);
    i = p.len;
    p.len += 1;
  }
  resetRow(PARENT, p, i);
  hot.g[G.parentUsed] = hot.g[G.parentUsed]! + 1;
  return i;
}

/** Frees parent row i; its records must already be gone (their sib links are not followed). */
export function freeParent(hot: HotBuffers, i: number): void {
  const p = hot.parent;
  unlinkDeadline(hot, i);
  p.deadline[i] = -1; p.tier[i] = 0; p.ramBits[i] = 0; p.diskBits[i] = 0;
  p.placed[i] = 0; p.pending[i] = 0; p.done[i] = 0; p.head[i] = -1;
  p.next[i] = hot.g[G.parentFree]!;
  hot.g[G.parentFree] = i;
  hot.g[G.parentUsed] = hot.g[G.parentUsed]! - 1;
}

/** Links record r into parent p's sibling list (rec.sib), at the front. */
export function addSibling(hot: HotBuffers, p: number, r: number): void {
  hot.rec.parent[r] = p;
  hot.rec.sib[r] = hot.parent.head[p]!;
  hot.parent.head[p] = r;
}

/** Unlinks record r from its parent's sibling list (at most 256 siblings). */
export function dropSibling(hot: HotBuffers, r: number): void {
  const p = hot.rec.parent[r]!;
  if (p < 0) return;
  const rec = hot.rec;
  if (hot.parent.head[p] === r) hot.parent.head[p] = rec.sib[r]!;
  else for (let q = hot.parent.head[p]!; q >= 0; q = rec.sib[q]!) if (rec.sib[q] === r) { rec.sib[q] = rec.sib[r]!; break; }
  rec.sib[r] = -1;
  rec.parent[r] = -1;
}

/* ---------- lists ---------- */

type Slots = { [i: number]: number };
/** Where a list keeps its head, tail and length. */
export interface ListHandle {
  readonly head: Slots; readonly hi: number;
  readonly tail: Slots; readonly ti: number;
  readonly len: Slots; readonly li: number;
}
export const frontList = (hot: HotBuffers): ListHandle => ({ head: hot.g, hi: G.frontHead, tail: hot.g, ti: G.frontTail, len: hot.g, li: G.frontLen });
export const queueList = (hot: HotBuffers, sys: number): ListHandle => ({ head: hot.sys.queueHead, hi: sys, tail: hot.sys.queueTail, ti: sys, len: hot.sys.queueLen, li: sys });
export const linkList = (hot: HotBuffers, link: number): ListHandle => ({ head: hot.link.head, hi: link, tail: hot.link.tail, ti: link, len: hot.link.qlen, li: link });

export function pushBack(hot: HotBuffers, list: ListHandle, r: number): void {
  const { prev, next } = hot.rec;
  const tail = list.tail[list.ti]!;
  prev[r] = tail;
  next[r] = -1;
  if (tail >= 0) next[tail] = r; else list.head[list.hi] = r;
  list.tail[list.ti] = r;
  list.len[list.li] = list.len[list.li]! + 1;
}

/** Inserts r before `before` (-1 = at the back). Used for ordered queues (QoS, SJF). */
export function insertBefore(hot: HotBuffers, list: ListHandle, r: number, before: number): void {
  if (before < 0) { pushBack(hot, list, r); return; }
  const { prev, next } = hot.rec;
  const p = prev[before]!;
  prev[r] = p;
  next[r] = before;
  prev[before] = r;
  if (p >= 0) next[p] = r; else list.head[list.hi] = r;
  list.len[list.li] = list.len[list.li]! + 1;
}

export function unlink(hot: HotBuffers, list: ListHandle, r: number): void {
  const { prev, next } = hot.rec;
  const p = prev[r]!, n = next[r]!;
  if (p >= 0) next[p] = n; else list.head[list.hi] = n;
  if (n >= 0) prev[n] = p; else list.tail[list.ti] = p;
  prev[r] = -1;
  next[r] = -1;
  list.len[list.li] = list.len[list.li]! - 1;
}

/** Visits a list front to back. The callback may unlink the current record. */
export function forEachInList(hot: HotBuffers, list: ListHandle, visit: (r: number) => void): void {
  let r = list.head[list.hi]!;
  while (r >= 0) {
    const n = hot.rec.next[r]!;
    visit(r);
    r = n;
  }
}
