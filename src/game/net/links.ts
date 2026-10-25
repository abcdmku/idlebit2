import { LINK_KIND, LOC } from '../core/buffers';
import { wakeRouters } from '../core/routerQueue';
import { DT_S } from '../core/constants';
import type { World } from '../core/world';
import { hasRule } from '../exec/rules';
import { memberPayload, shapeOf } from '../exec/shape';
import { active, dropJoinHint, joinLink, leaveLink, rescanActive } from './fifo';
import { nextLink } from './paths';

/**
 * Links phase (tick step 3, spec §7.4). Each link has `channels` channels of DT_S seconds per tick
 * and one FIFO. Channels serve the FIFO in order; a transfer occupies one channel at a time, partial
 * sends carry to the next tick and several small transfers can finish on one channel in one tick.
 * A transfer that finishes a link waits its latency, then joins the next link at the end of the step
 * (served from the next tick), or arrives at its system for the admit phase of this tick.
 */

let chanFree = new Float64Array(8);
const moving: number[] = [];
/** Records that finished their last link this tick, in arrival order; the admit phase consumes them. */
export const arrived: number[] = [];
/** Takes record r off this tick's arrivals (it was aborted before the admit phase). */
export function removeArrival(r: number): void {
  const i = arrived.indexOf(r);
  if (i >= 0) arrived.splice(i, 1);
}

/** Bits one record carries over each link: its tasks × the member payload. */
export const transferBits = (w: World, r: number): number =>
  w.hot.rec.count[r]! * memberPayload(shapeOf(w.hot.rec.family[r]!), w.hot.rec.units[r]!);

/** Sends for DT_S on link l. Collects records ready to move on into `moving`. */
function serveLink(w: World, l: number): void {
  dropJoinHint(w.hot, l);
  const rec = w.hot.rec, lh = w.hot.link, lc = w.compiled.link;
  const speed = lc.speed[l]!;
  const chans = Math.max(1, lc.channels[l]!);
  if (chanFree.length < chans) chanFree = new Float64Array(chans * 2);
  chanFree.fill(0, 0, chans);
  let bits = 0;
  for (let r = lh.head[l]!; r >= 0; r = rec.next[r]!) {
    if (rec.start[r]! >= 0) { if (rec.start[r]! <= w.tick) moving.push(r); continue; }
    let j = 0;
    for (let k = 1; k < chans; k += 1) if (chanFree[k]! < chanFree[j]!) j = k;
    const t0 = chanFree[j]!;
    // Started transfers lead the FIFO (joins go behind them), so once no channel is left a
    // transfer that has not started has only unstarted ones behind it: none can move this tick.
    if (t0 >= DT_S || !(speed > 0)) { if (rec.threads[r] === 0) break; continue; }
    rec.threads[r] = 1;
    const need = rec.finish[r]! / speed;
    if (t0 + need <= DT_S) {
      bits += rec.finish[r]!;
      chanFree[j] = t0 + need;
      rec.finish[r] = 0;
      const lat = lc.latencyTicks[l]!;
      if (lat > 0) rec.start[r] = w.tick + lat; else moving.push(r);
    } else {
      const sent = (DT_S - t0) * speed;
      bits += sent;
      rec.finish[r] = rec.finish[r]! - sent;
      chanFree[j] = DT_S;
    }
  }
  let busy = 0;
  for (let k = 0; k < chans; k += 1) busy += chanFree[k]!;
  lh.busyS[l] = busy;
  lh.bitClock[l] = lh.bitClock[l]! + bits;
  const before = lh.backlog[l]!, room = chans * speed * DT_S;
  lh.backlog[l] = Math.max(0, before - bits);
  // First-link room came back (net/split.ts linkRoom): the routers above may split again.
  if (before >= room && lh.backlog[l]! < room) wakeLink(w, l);
}

/** Wakes the routers whose systems take link l as a hop. */
function wakeLink(w: World, l: number): void {
  const kind = w.compiled.link.kind[l]!, owner = w.compiled.link.owner[l]!;
  wakeRouters(w, kind === LINK_KIND.backbone ? 2 : kind === LINK_KIND.zone ? 1 : 0, owner);
}

/** Moves record r (off any link) onto the next link of its path, or marks it arrived. */
export function forward(w: World, r: number, afterKind: number, qos: boolean): void {
  const target = w.hot.rec.target[r]!;
  const next = nextLink(w, target, afterKind);
  if (next >= 0) { joinLink(w.hot, next, r, transferBits(w, r), qos); return; }
  w.hot.rec.loc[r] = LOC.link;
  w.hot.rec.owner[r] = -1;
  arrived.push(r);
}

export function linkPhase(w: World): void {
  arrived.length = 0;
  moving.length = 0;
  const lh = w.hot.link;
  // Only active links can be served or reset; visited in ascending order, as a scan would.
  const log = w.touch;
  if (active.hot !== w.hot || log === undefined || active.log !== log || active.mark.length < lh.len) rescanActive(w.hot, log ?? null);
  const list = active.list.subarray(0, active.n).sort();
  for (let i = 0; i < list.length; i += 1) {
    const l = list[i]!;
    if (lh.qlen[l] === 0) { if (lh.busyS[l] !== 0) lh.busyS[l] = 0; continue; }
    serveLink(w, l);
  }
  if (log) {
    if (log.linkList.length < list.length) log.linkList = new Int32Array(list.length * 2);
    log.linkList.set(list); log.linkN = list.length; log.linkTick = w.tick;
  }
  let kept = 0;
  for (let i = 0; i < list.length; i += 1) {
    const l = list[i]!;
    if (lh.qlen[l] === 0 && lh.busyS[l] === 0) active.mark[l] = 0;
    else { active.list[kept] = l; kept += 1; }
  }
  active.n = kept;
  if (moving.length === 0) return;
  const qos = hasRule(w, 'qos');
  const kinds = w.compiled.link.kind;
  for (const r of moving) {
    const kind = kinds[w.hot.rec.owner[r]!]!;
    leaveLink(w.hot, r);
    forward(w, r, kind, qos);
  }
}

