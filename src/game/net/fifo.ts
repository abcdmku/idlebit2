import { G, LOC, type HotBuffers } from '../core/buffers';
import { insertBefore, linkList, pushBack, unlink } from '../core/pool';

/**
 * Link transfer FIFOs (spec §7.4). A record in transit has loc = link, owner = its current link,
 * target = its reserved system. While queued or sending, `finish` holds the bits still to send on
 * this link (link backlog sums them); once sent, `start` holds the tick from which it may move on
 * (latency), else -1;
 * `threads` is 1 once it has begun sending on this link.
 * G.transitCount counts tasks in links. No exec imports, so exec may use these to cancel.
 */

/** Joins link `link`'s FIFO with `bits` to send. With QoS, smaller payloads go first (ties FIFO). */
export function joinLink(hot: HotBuffers, link: number, r: number, bits: number, qos: boolean): void {
  const rec = hot.rec;
  rec.loc[r] = LOC.link;
  rec.owner[r] = link;
  rec.finish[r] = bits;
  rec.start[r] = -1;
  rec.threads[r] = 0;
  hot.link.backlog[link] = hot.link.backlog[link]! + bits;
  noteActive(hot, link);
  const list = linkList(hot, link);
  if (!qos) {
    const tail = hot.link.tail[link]!;
    if (tail >= 0 && isWaiting(hot, tail) && rec.finish[tail]! > bits) markUnsorted(hot, link);
    pushBack(hot, list, r); dropJoinHint(hot, link);
    return;
  }
  // Sending and sent transfers lead the FIFO; the waiting rest is sorted by bits. Scanning back from
  // the tail finds the same place as the forward scan, in O(1) when sizes arrive in order.
  let after = sameSizeSpot(hot, link, bits);
  if (after === NO_HINT) after = isSorted(hot, link) ? meetSpot(hot, link, bits) : backSpot(hot, link, bits);
  insertBefore(hot, list, r, after >= 0 ? rec.next[after]! : hot.link.head[link]!);
  noteJoin(hot, link, r, bits);
  if (orderHot === hot && link < finger.length) finger[link] = r;
}

const isWaiting = (hot: HotBuffers, r: number): boolean => hot.rec.start[r]! < 0 && !isSending(hot, r);

/** The QoS spot by the backward scan: after the last record that has started or is no larger. */
function backSpot(hot: HotBuffers, link: number, bits: number): number {
  const rec = hot.rec;
  let after = hot.link.tail[link]!;
  while (after >= 0 && isWaiting(hot, after) && rec.finish[after]! > bits) after = rec.prev[after]!;
  return after;
}

/**
 * backSpot on a link whose waiting transfers are sorted by bits: the backward scan and a forward
 * scan from the head (past the started ones, to the first waiting transfer larger than bits) meet
 * at the same place, so stepping both and stopping at the first to arrive costs the shorter side.
 */
function meetSpot(hot: HotBuffers, link: number, bits: number): number {
  const rec = hot.rec;
  // A third cursor starts at the link's last join (any waiting transfer of the link marks a point
  // of the sorted run), walking toward the spot: consecutive joins are usually close in size.
  let f = link < finger.length && orderHot === hot ? finger[link]! : -1;
  if (f >= 0 && !(rec.loc[f] === LOC.link && rec.owner[f] === link && isWaiting(hot, f))) f = -1;
  const up = f >= 0 && rec.finish[f]! <= bits;
  let back = hot.link.tail[link]!, fwd = hot.link.head[link]!;
  for (;;) {
    if (!(back >= 0 && isWaiting(hot, back) && rec.finish[back]! > bits)) return back;
    // The forward side stops at the first waiting transfer larger than bits: the spot is before it.
    if (fwd < 0) return hot.link.tail[link]!;
    if (isWaiting(hot, fwd) && rec.finish[fwd]! > bits) return rec.prev[fwd]!;
    if (f >= 0 || up) {
      if (up) {
        if (f < 0) return hot.link.tail[link]!;
        if (isWaiting(hot, f) && rec.finish[f]! > bits) return rec.prev[f]!;
        f = rec.next[f]!;
      } else {
        if (!(isWaiting(hot, f) && rec.finish[f]! > bits)) return f;
        f = rec.prev[f]!;
        if (f < 0) return -1;
      }
    }
    back = rec.prev[back]!; fwd = rec.next[fwd]!;
  }
}

/*
 * Per link: whether its waiting transfers are known sorted by bits (1), known not (0) or unknown
 * (-1, checked once by a scan). Derived, kept per hot buffers object. QoS joins keep a sorted link
 * sorted, serving starts transfers only from the front of the waiting run, and leaving removes one;
 * only a plain (non-QoS) join behind a larger waiting transfer unsorts it, until the link empties.
 */
let orderHot: HotBuffers | null = null;
let order = new Int8Array(0);
/** Per link: the record of its last QoS join (meetSpot's third cursor), -1 none; checked before use. */
let finger = new Int32Array(0);
function orderOf(hot: HotBuffers): Int8Array {
  if (orderHot !== hot || order.length < hot.link.len) {
    if (order.length < hot.link.len) { order = new Int8Array(hot.link.len * 2); finger = new Int32Array(hot.link.len * 2); }
    order.fill(-1); finger.fill(-1); orderHot = hot;
  }
  return order;
}
function markUnsorted(hot: HotBuffers, link: number): void { orderOf(hot)[link] = 0; }
function isSorted(hot: HotBuffers, link: number): boolean {
  const o = orderOf(hot);
  if (o[link] === -1) {
    const rec = hot.rec;
    let ok = 1, last = -Infinity;
    for (let q = hot.link.head[link]!; q >= 0 && ok === 1; q = rec.next[q]!) {
      if (!isWaiting(hot, q)) { if (last !== -Infinity) ok = 0; continue; }
      if (rec.finish[q]! < last) ok = 0;
      last = rec.finish[q]!;
    }
    o[link] = ok;
  }
  return o[link] === 1;
}

/*
 * Same-size joins (gang members). Right after r joins link l with b bits, everything behind it is a
 * waiting transfer of more than b bits: the scan passed exactly those. Until l is served or loses a
 * record, a next join of b bits scans past the same records and stops at r, so it goes right after
 * r. Hints are derived, kept per hot buffers object and dropped by serveLink and leaveLink.
 */
const NO_HINT = -2;
let hintHot: HotBuffers | null = null;
let hintRec = new Int32Array(0), hintBits = new Float64Array(0);

function noteJoin(hot: HotBuffers, link: number, r: number, bits: number): void {
  if (hintHot !== hot || hintRec.length < hot.link.len) {
    if (hintRec.length < hot.link.len) { hintRec = new Int32Array(hot.link.len * 2); hintBits = new Float64Array(hot.link.len * 2); }
    hintRec.fill(-1); hintHot = hot;
  }
  hintRec[link] = r; hintBits[link] = bits;
}

/** The record a join of `bits` goes right after, or NO_HINT when it must scan. */
function sameSizeSpot(hot: HotBuffers, link: number, bits: number): number {
  if (hintHot !== hot || link >= hintRec.length) return NO_HINT;
  const h = hintRec[link]!, rec = hot.rec;
  if (h < 0 || hintBits[link] !== bits || rec.loc[h] !== LOC.link || rec.owner[h] !== link
    || rec.start[h]! >= 0 || isSending(hot, h) || rec.finish[h] !== bits) return NO_HINT;
  return h;
}

/** Link `link` was served or lost a record: its join hint no longer holds. */
export function dropJoinHint(hot: HotBuffers, link: number): void {
  if (hintHot === hot && link < hintRec.length) hintRec[link] = -1;
}

/** A record that has started sending keeps its place (QoS reorders only waiting transfers). */
const isSending = (hot: HotBuffers, r: number): boolean => hot.rec.threads[r] === 1;

/*
 * Active links (derived, per hot buffers): every link with a transfer queued or busy time left, so
 * the links phase visits only these. joinLink adds a link; the links phase rebuilds the set by a
 * scan on the first tick of each advance call (each tick without a touch log) and drops links
 * that are empty and idle after serving.
 */
export interface ActiveLinks { hot: HotBuffers | null; log: unknown; mark: Uint8Array; list: Int32Array; n: number }
export const active: ActiveLinks = { hot: null, log: null, mark: new Uint8Array(0), list: new Int32Array(0), n: 0 };
function noteActive(hot: HotBuffers, link: number): void {
  if (active.hot !== hot || link >= active.mark.length || active.mark[link] === 1) return;
  active.mark[link] = 1;
  active.list[active.n] = link;
  active.n += 1;
}
/** Rescans the active set for these hot buffers. */
export function rescanActive(hot: HotBuffers, log: unknown): void {
  const n = hot.link.len;
  if (active.mark.length < n) { active.mark = new Uint8Array(n * 2); active.list = new Int32Array(n * 2); }
  else active.mark.fill(0);
  active.hot = hot; active.log = log; active.n = 0;
  const qlen = hot.link.qlen, busy = hot.link.busyS;
  for (let l = 0; l < n; l += 1) {
    if (qlen[l] === 0 && busy[l] === 0) continue;
    active.mark[l] = 1; active.list[active.n] = l; active.n += 1;
  }
}

/** Takes r off its link; its unsent bits leave the backlog. */
export function leaveLink(hot: HotBuffers, r: number): void {
  const link = hot.rec.owner[r]!;
  unlink(hot, linkList(hot, link), r);
  dropJoinHint(hot, link);
  hot.link.backlog[link] = hot.link.qlen[link] === 0 ? 0 : Math.max(0, hot.link.backlog[link]! - hot.rec.finish[r]!);
  if (hot.link.qlen[link] === 0 && orderHot === hot && link < order.length) order[link] = 1;
  hot.rec.threads[r] = 0;
}

export function addTransit(hot: HotBuffers, k: number): void {
  hot.g[G.transitCount] = hot.g[G.transitCount]! + k;
}
