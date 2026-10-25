import { LINK_KIND, type CompiledBuffers } from '../core/buffers';
import { ACCEL_CLOCKS, DT_S, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import type { World } from '../core/world';
import { estOn, estRecord } from '../exec/est';
import { canAdmit, keffOf } from '../exec/slots';
import { NRES } from '../exec/shape';
import { classesOf } from '../market/fleet';
import { transferBits } from './links';
import { someSystem } from './metrics';
import { linkOf } from './paths';
import { decisionFor, memo, Stamped } from './routeMemo';
import { RACK, ROOM, SITE } from './scope';

/*
 * finish(c, task) (spec §8.3): a system's backlog / Keff + the task's own est + its transfer time
 * from the market; an aggregate's is the minimum over its systems that can admit now. The leastWork
 * and latency strategies score every candidate with it, so during routing it is memoized and
 * bounded (routeMemo.ts); every value it returns is computed by the same float expression.
 */

/** System index → capability class index (fleet.ts classesOf), -1 outside every class. Per compiled. */
const classMemo = new WeakMap<CompiledBuffers, Int32Array>();
export function classIndex(c: CompiledBuffers): Int32Array {
  const hit = classMemo.get(c);
  if (hit) return hit;
  const map = new Int32Array(c.sys.len).fill(-1);
  classesOf(c).forEach((cls, i) => { for (const s of cls.members) map[s] = i; });
  classMemo.set(c, map);
  return map;
}

const list = new Stamped(), sysFinish = new Stamped(), rackLb = new Stamped(), rackMin = new Stamped(), rackUp = new Stamped();
/** Per rack, for the phase: a system standing for it, and whether its systems share one est (1) or not (0). */
let rackRep = new Int32Array(0), rackSame = new Uint8Array(0);
/** classIndex of the world being routed (set by ensure). */
let classOf: Int32Array = new Int32Array(0);

/** The backlog list sum of system s: Σ est of its queued and running records, in list order. */
function listSeconds(w: World, s: number): number {
  if (memo.exact && list.at[s] === memo.phase) return list.val[s]!;
  const h = w.hot.sys, rec = w.hot.rec;
  let secs = 0;
  for (let q = h.queueHead[s]!; q >= 0; q = rec.next[q]!) secs += rec.count[q]! * estRecord(w, s, q);
  for (let res = 0; res < NRES; res += 1) {
    for (let q = h.head[s * NRES + res]!; q >= 0; q = rec.next[q]!) secs += rec.count[q]! * estRecord(w, s, q);
  }
  for (let clock = 0; clock < ACCEL_CLOCKS; clock += 1) {
    for (let q = h.accelHead[s * ACCEL_CLOCKS + clock]!; q >= 0; q = rec.next[q]!) secs += rec.count[q]! * estRecord(w, s, q);
  }
  if (memo.exact) { list.at[s] = memo.phase; list.val[s] = secs; }
  return secs;
}

/*
 * estOn(s, task) reads only s's class columns, its rack's e(T), its etaCfg and its clock factor,
 * so within a decision systems with equal inputs share one value (compared with Object.is).
 */
const OWN_MAX = 32;
let ownN = 0, ownDecision = 0, ownEpoch = -1;
const ownCls = new Int32Array(OWN_MAX), ownEff = new Float64Array(OWN_MAX), ownEta = new Float64Array(OWN_MAX);
const ownClock = new Float64Array(OWN_MAX), ownVal = new Float64Array(OWN_MAX);
function ownOf(w: World, s: number, r: number): number {
  const rec = w.hot.rec;
  if (!memo.exact) return estOn(w, s, rec.family[r]!, rec.units[r]!, 0);
  const cls = classOf[s] ?? -1;
  if (cls < 0) return estOn(w, s, rec.family[r]!, rec.units[r]!, 0);
  if (ownDecision !== memo.decision || ownEpoch !== memo.epoch) { ownDecision = memo.decision; ownEpoch = memo.epoch; ownN = 0; }
  const eff = w.hot.rack.eff[w.compiled.sys.rack[s]!]!, eta = w.compiled.sys.etaCfg[s]!, clock = w.hot.sys.clockFactor[s]!;
  for (let i = 0; i < ownN; i += 1) {
    if (ownCls[i] === cls && Object.is(ownEff[i], eff) && Object.is(ownEta[i], eta) && Object.is(ownClock[i], clock)) return ownVal[i]!;
  }
  const value = estOn(w, s, rec.family[r]!, rec.units[r]!, 0);
  if (ownN < OWN_MAX) { ownCls[ownN] = cls; ownEff[ownN] = eff; ownEta[ownN] = eta; ownClock[ownN] = clock; ownVal[ownN] = value; ownN += 1; }
  return value;
}

/** transferBits(w, r), once per decision. */
let bitsDecision = 0, bitsEpoch = -1, bitsVal = 0;
function bitsOf(w: World, r: number): number {
  if (!memo.exact) return transferBits(w, r);
  if (bitsDecision !== memo.decision || bitsEpoch !== memo.epoch) { bitsDecision = memo.decision; bitsEpoch = memo.epoch; bitsVal = transferBits(w, r); }
  return bitsVal;
}

/** One link's term of pathSeconds (paths.ts), the same expression. */
function linkTerm(w: World, l: number, bits: number): number {
  const speed = w.compiled.link.speed[l]!;
  return (speed > 0 ? bits / speed : Infinity) + w.compiled.link.latencyTicks[l]! * DT_S;
}
/** pathSeconds' partial sum over the backbone, zone and rack links, which depend only on s's rack. */
function upperPath(w: World, s: number, bits: number): number {
  const rack = w.compiled.sys.rack[s]!;
  if (memo.exact && rackUp.at[rack] === memo.decision) return rackUp.val[rack]!;
  let secs = 0;
  for (let k = LINK_KIND.backbone; k > LINK_KIND.server; k -= 1) {
    const l = linkOf(w, s, k);
    if (l >= 0) secs += linkTerm(w, l, bits);
  }
  if (memo.exact) { rackUp.at[rack] = memo.decision; rackUp.val[rack] = secs; }
  return secs;
}
/** pathSeconds(w, s, bits) from the market: the rack's partial sum, then the server port. */
function pathFrom(w: World, s: number, bits: number): number {
  let secs = upperPath(w, s, bits);
  const port = linkOf(w, s, LINK_KIND.server);
  if (port >= 0) secs += linkTerm(w, port, bits);
  return secs;
}

/** finish(c, task) for one system. The backlog is Σ est of the admitted tasks, then the reserved ones costed like record r. */
export function finishOn(w: World, s: number, r: number): number {
  if (memo.exact) {
    decisionFor(r);
    if (sysFinish.at[s] === memo.decision) return sysFinish.val[s]!;
  }
  const reserved = w.hot.sys.reserved[s]!;
  const own = ownOf(w, s, r);
  let backlog = listSeconds(w, s);
  if (reserved > 0) backlog += reserved * own;
  const value = backlog / keffOf(w, s) + own + pathFrom(w, s, bitsOf(w, r));
  if (memo.exact) { sysFinish.at[s] = memo.decision; sysFinish.val[s] = value; }
  return value;
}

/*
 * Branch and bound. Every term of finishOn is ≥ 0 and IEEE rounding is monotone, so for each
 * admitting system s of a rack, finishOn(s) ≥ fl(fl(lb + own) + up), where lb = min fl(listSeconds /
 * Keff) over the rack (phase), own is the rack's shared est when its systems share one (else 0)
 * and up is the rack's partial path (decision). A rack whose bound is ≥ the best so far, or ≥ the
 * caller's bound, cannot change what the caller picks and is skipped.
 */
function rackBound(w: World, rack: number): number {
  if (rackLb.at[rack] === memo.phase) return rackLb.val[rack]!;
  const c = w.compiled, cls = classOf;
  let lb = Infinity, rep = -1, same = 1;
  for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
    const s = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
    if (s < 0 || c.sys.alive[s] !== 1 || !canAdmit(w, s)) continue;
    lb = Math.min(lb, listSeconds(w, s) / keffOf(w, s));
    if (c.sys.rack[s] !== rack) { rep = -2; same = 0; continue; }
    if (rep === -1) { rep = s; if ((cls[s] ?? -1) < 0) same = 0; continue; }
    if (rep < 0) continue;
    if (cls[s] !== cls[rep] || !Object.is(c.sys.etaCfg[s], c.sys.etaCfg[rep])
      || !Object.is(w.hot.sys.clockFactor[s], w.hot.sys.clockFactor[rep])) same = 0;
  }
  // A system filed under another rack has another partial path: no tight bound then (rep -1).
  rackLb.at[rack] = memo.phase; rackLb.val[rack] = lb; rackRep[rack] = Math.max(rep, -1); rackSame[rack] = same;
  return lb;
}

/** A rack's exact minimum finish over its admitting systems (decision memo; min is order-free). */
function rackExact(w: World, rack: number, r: number): number {
  if (rackMin.at[rack] === memo.decision) return rackMin.val[rack]!;
  const c = w.compiled;
  let min = Infinity;
  for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
    const s = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
    if (s >= 0 && c.sys.alive[s] === 1 && canAdmit(w, s)) min = Math.min(min, finishOn(w, s, r));
  }
  rackMin.at[rack] = memo.decision; rackMin.val[rack] = min;
  return min;
}

/** Racks of one aggregate still to evaluate, with their tight bounds (NaN bounds sort first). */
let pend = new Int32Array(64), pendLb = new Float64Array(64), pendN = 0;

/** Folds rack's memoized minimum into best, or queues it unless its bound rules it out. Returns best. */
function collect(w: World, rack: number, r: number, best: number, bound: number): number {
  if (w.compiled.rack.alive[rack] === 1 && w.hot.rack.freeSlots[rack] === 0) return best;
  const lb = rackBound(w, rack);
  if (lb >= best || lb >= bound) return best;
  if (rackMin.at[rack] === memo.decision) return Math.min(best, rackMin.val[rack]!);
  const rep = rackRep[rack]!;
  const tight = rep < 0 ? lb : lb + (rackSame[rack] === 1 ? ownOf(w, rep, r) : 0) + upperPath(w, rep, bitsOf(w, r));
  if (tight >= best || tight >= bound) return best;
  if (pendN === pend.length) {
    const p = new Int32Array(pendN * 2), l = new Float64Array(pendN * 2);
    p.set(pend); l.set(pendLb); pend = p; pendLb = l;
  }
  pend[pendN] = rack; pendLb[pendN] = tight === tight ? tight : -Infinity; pendN += 1;
  return best;
}

/** Evaluates the queued racks lowest bound first, until no bound can go below min(best, bound). */
function settle(w: World, r: number, best: number, bound: number): number {
  while (pendN > 0) {
    let j = 0;
    for (let i = 1; i < pendN; i += 1) if (pendLb[i]! < pendLb[j]!) j = i;
    const t = pendLb[j]!, rack = pend[j]!;
    if (t >= best || t >= bound) break;
    pendN -= 1; pend[j] = pend[pendN]!; pendLb[j] = pendLb[pendN]!;
    best = Math.min(best, rackExact(w, rack, r));
  }
  pendN = 0;
  return best;
}
function collectRoom(w: World, room: number, r: number, best: number, bound: number): number {
  for (let k = 0; k < RACKS_PER_ROOM; k += 1) {
    const rack = w.compiled.room.racks[room * RACKS_PER_ROOM + k]!;
    if (rack >= 0) best = collect(w, rack, r, best, bound);
  }
  return best;
}

/** Sizes the memo columns for this world (once per call that may use them). */
function ensure(w: World): void {
  classOf = classIndex(w.compiled);
  const n = w.compiled.sys.len, racks = w.compiled.rack.len;
  list.ensure(n); sysFinish.ensure(n); rackLb.ensure(racks); rackMin.ensure(racks); rackUp.ensure(racks);
  if (rackRep.length < racks) { rackRep = new Int32Array(racks * 2); rackSame = new Uint8Array(racks * 2); }
}

/**
 * finish(c, task) when only a value below `bound` matters: the exact minimum when it is below
 * `bound`, else some value ≥ bound. A strategy that keeps the strictly lowest score and passes its
 * best so far picks exactly what it would pick with every exact score.
 */
export function finishBelow(w: World, kind: number, u: number, r: number, bound: number): number {
  if (memo.exact) ensure(w);
  if (kind === RACK) return finishOn(w, u, r);
  if (!memo.exact) {
    let best = Infinity;
    someSystem(w, kind, u, (s) => { if (canAdmit(w, s)) best = Math.min(best, finishOn(w, s, r)); return false; });
    return best;
  }
  decisionFor(r);
  pendN = 0;
  let best = Infinity;
  switch (kind) {
    case ROOM: best = collect(w, u, r, best, bound); break;
    case SITE: best = collectRoom(w, u, r, best, bound); break;
    default:
      for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) {
        const room = w.compiled.site.zones[u * MAX_ZONES_PER_SITE + z]!;
        if (room >= 0) best = collectRoom(w, room, r, best, bound);
      }
  }
  return settle(w, r, best, bound);
}

/** finish(c, task): for an aggregate, the minimum over its systems that can admit now. */
export const finish = (w: World, kind: number, u: number, r: number): number => finishBelow(w, kind, u, r, Infinity);
