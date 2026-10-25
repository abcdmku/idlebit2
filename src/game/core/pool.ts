import { G, GANG, LOC, RECORD, type HotBuffers } from './buffers';
import { copyRow, growTable, resetRow } from './table';

/**
 * Record and gang pools with free lists (architecture §1.4), and doubly linked list ops over
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
export function freeRecord(hot: HotBuffers, r: number): void {
  const rec = hot.rec;
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
  rec.prev[s] = -1; rec.next[s] = -1;
  return s;
}

export function allocGang(hot: HotBuffers): number {
  const gang = hot.gang;
  let i = hot.g[G.gangFree]!;
  if (i >= 0) {
    hot.g[G.gangFree] = gang.next[i]!;
  } else {
    if (gang.len >= gang.cap) growTable(GANG, gang, gang.len + 1);
    i = gang.len;
    gang.len += 1;
  }
  resetRow(GANG, gang, i);
  hot.g[G.gangUsed] = hot.g[G.gangUsed]! + 1;
  return i;
}

export function freeGang(hot: HotBuffers, i: number): void {
  hot.gang.members[i] = 0;
  hot.gang.next[i] = hot.g[G.gangFree]!;
  hot.g[G.gangFree] = i;
  hot.g[G.gangUsed] = hot.g[G.gangUsed]! - 1;
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
