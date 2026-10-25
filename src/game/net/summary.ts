import { LINK_KIND, type CompiledBuffers } from '../core/buffers';
import { DT_S, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import type { World } from '../core/world';
import { backlogFor, clearDirty, estNominal, UNITS_PER_S, type Backlog } from '../exec/backlog';
import { canAdmit } from '../exec/slots';
import { classesOf, gateOn } from '../market/fleet';
import { FAMILIES } from '../market/families';
import { classIndex } from './finish';
import { transferBits } from './links';
import { linkOf } from './paths';
import { decisionFor, memo, Stamped } from './routeMemo';
import { GLOBAL, SITE } from './scope';

/*
 * Site- and global-scope routing summaries (program D24, spec §8.3). Above the room, `latency`
 * and `leastWork` rank a zone by its best predicted finish among the systems that can take the
 * task now: per capability class, the lowest backlog (exec/backlog.ts) over the zone's systems of
 * that class that can admit, over the class's Keff, plus the task's nominal est on the class and
 * its transfer time over the zone's own links (backbone and zone link). A site ranks as its best
 * zone. Rack and zone minima are kept per class and re-read only for racks whose backlog or
 * can-admit moved, so a decision costs O(zones × classes). Within a room routing stays exact.
 */

/** Test and bench hook: false ranks site and global scope by the exact finish again (the pre-D24 rule). */
export const routeSummary = { on: true };

interface Summary {
  backlog: Backlog;
  compiled: CompiledBuffers;
  classes: number;
  /** Per rack × class and room × class: the lowest backlog units over systems that can admit (Infinity: none). */
  rackMin: Float64Array;
  roomMin: Float64Array;
  roomDirty: Uint8Array;
}
let summary: Summary | null = null;

/** The lowest backlog per class over rack r's systems that can admit now, into rackMin. */
function readRack(w: World, s: Summary, cls: Int32Array, r: number): void {
  const c = w.compiled, C = s.classes, units = s.backlog.units, out = s.rackMin;
  out.fill(Infinity, r * C, r * C + C);
  let mask = 0;
  for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
    const sys = c.rack.servers[r * SERVERS_PER_RACK + k]!;
    if (sys < 0 || c.sys.alive[sys] !== 1 || !canAdmit(w, sys)) continue;
    // The mask the free-slot recount compares (every system that can admit, classed or not).
    mask |= 1 << k;
    const i = cls[sys] ?? -1;
    if (i < 0) continue;
    const u = units[sys]!;
    if (u < out[r * C + i]!) out[r * C + i] = u;
  }
  s.backlog.admitMask[r] = mask;
}

function readRoom(w: World, s: Summary, m: number): void {
  const c = w.compiled, C = s.classes, out = s.roomMin;
  out.fill(Infinity, m * C, m * C + C);
  for (let k = 0; k < RACKS_PER_ROOM; k += 1) {
    const r = c.room.racks[m * RACKS_PER_ROOM + k]!;
    if (r < 0) continue;
    for (let i = 0; i < C; i += 1) { const u = s.rackMin[r * C + i]!; if (u < out[m * C + i]!) out[m * C + i] = u; }
  }
}

/** The summary for this route phase, with every moved rack and its zone re-read. */
function current(w: World): Summary {
  const b = backlogFor(w, memo.phase);
  const c = w.compiled;
  if (!summary || summary.backlog !== b || summary.compiled !== c) {
    const C = Math.max(1, classesOf(c).length);
    summary = {
      backlog: b, compiled: c, classes: C,
      rackMin: new Float64Array(c.rack.len * C).fill(Infinity), roomMin: new Float64Array(c.room.len * C).fill(Infinity),
      roomDirty: new Uint8Array(c.room.len),
    };
  }
  const s = summary;
  if (b.dirtyN > 0) {
    const cls = classIndex(c);
    for (let i = 0; i < b.dirtyN; i += 1) {
      const r = b.dirtyList[i]!;
      readRack(w, s, cls, r);
      s.roomDirty[c.rack.room[r]!] = 1;
    }
    clearDirty(b);
    for (let m = 0; m < c.room.len; m += 1) if (s.roomDirty[m] === 1) { readRoom(w, s, m); s.roomDirty[m] = 0; }
  }
  return s;
}

/** Per decision: each class's gate, nominal est and Keff for the record being routed. */
let gateDecision = -1, gateEpoch = -1;
let classOk = new Uint8Array(0), classOwn = new Float64Array(0), classKeff = new Float64Array(0);
function classTerms(w: World, r: number, C: number): void {
  if (gateDecision === memo.decision && gateEpoch === memo.epoch && memo.exact) return;
  gateDecision = memo.decision; gateEpoch = memo.epoch;
  if (classOk.length < C) { classOk = new Uint8Array(C * 2); classOwn = new Float64Array(C * 2); classKeff = new Float64Array(C * 2); }
  const c = w.compiled, rec = w.hot.rec, family = rec.family[r]!, scale = rec.scale[r]!, def = FAMILIES[family]!;
  const classes = classesOf(c);
  for (let i = 0; i < C; i += 1) {
    const cls = classes[i];
    classOk[i] = cls !== undefined && gateOn(c, cls.rep, def, scale) === 0 ? 1 : 0;
    classOwn[i] = cls ? estNominal(c, cls.rep, family, scale) : Infinity;
    classKeff[i] = cls ? Math.max(1, c.sys.keff[cls.rep]!) : 1;
  }
}

/** zonePath per room, for one decision. */
const pathMemo = new Stamped();

/** Transfer time of record r over room m's backbone and zone links (the path above its racks). */
function zonePath(w: World, m: number, r: number): number {
  if (memo.exact) {
    pathMemo.ensure(w.compiled.room.len);
    if (pathMemo.at[m] === memo.decision) return pathMemo.val[m]!;
    const v = zonePathOf(w, m, r);
    pathMemo.at[m] = memo.decision; pathMemo.val[m] = v;
    return v;
  }
  return zonePathOf(w, m, r);
}
function zonePathOf(w: World, m: number, r: number): number {
  const c = w.compiled;
  let s = -1;
  for (let k = 0; k < RACKS_PER_ROOM && s < 0; k += 1) {
    const rack = c.room.racks[m * RACKS_PER_ROOM + k]!;
    for (let j = 0; rack >= 0 && j < SERVERS_PER_RACK && s < 0; j += 1) {
      const sys = c.rack.servers[rack * SERVERS_PER_RACK + j]!;
      if (sys >= 0 && c.sys.alive[sys] === 1) s = sys;
    }
  }
  if (s < 0) return 0;
  const bits = transferBits(w, r);
  let secs = 0;
  for (const kind of [LINK_KIND.backbone, LINK_KIND.zone]) {
    const l = linkOf(w, s, kind);
    if (l < 0) continue;
    const speed = c.link.speed[l]!;
    secs += (speed > 0 ? bits / speed : Infinity) + c.link.latencyTicks[l]! * DT_S;
  }
  return secs;
}

function roomRank(w: World, s: Summary, m: number, r: number): number {
  const C = s.classes;
  let best = Infinity;
  for (let i = 0; i < C; i += 1) {
    const u = s.roomMin[m * C + i]!;
    if (classOk[i] !== 1 || u === Infinity) continue;
    const score = u / UNITS_PER_S / classKeff[i]! + classOwn[i]!;
    if (score < best) best = score;
  }
  return best === Infinity ? best : best + zonePath(w, m, r);
}

/** D24 rank of zone (room) m for record r: its summary finish (see the comment above). */
export function zoneRank(w: World, m: number, r: number): number {
  if (memo.exact) decisionFor(r);
  const s = current(w);
  classTerms(w, r, s.classes);
  return roomRank(w, s, m, r);
}

/** D24 rank of a site for record r: its best zone. */
export function siteRank(w: World, site: number, r: number): number {
  if (memo.exact) decisionFor(r);
  const s = current(w);
  classTerms(w, r, s.classes);
  let best = Infinity;
  for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) {
    const m = w.compiled.site.zones[site * MAX_ZONES_PER_SITE + z]!;
    if (m >= 0) best = Math.min(best, roomRank(w, s, m, r));
  }
  return best;
}

/**
 * The capability filter (spec §8.4) for a zone (SITE) or a site (GLOBAL) and a one-member task,
 * exactly: some system there can admit now and passes the task's gates. Gates read only class
 * columns, so that is a class that passes them with a system that can admit, which the minima
 * record (finite exactly when such a system exists).
 */
export function summaryCapable(w: World, kind: number, u: number, r: number): boolean {
  if (memo.exact) decisionFor(r);
  const s = current(w);
  classTerms(w, r, s.classes);
  if (kind === SITE) return roomCapable(s, u);
  const zones = w.compiled.site.zones;
  for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) { const m = zones[u * MAX_ZONES_PER_SITE + z]!; if (m >= 0 && roomCapable(s, m)) return true; }
  return false;
}

/** Room m has a system that can admit now in a class that passes the gates (classTerms). */
function roomCapable(s: Summary, m: number): boolean {
  const C = s.classes;
  for (let i = 0; i < C; i += 1) if (classOk[i] === 1 && s.roomMin[m * C + i]! !== Infinity) return true;
  return false;
}

/** Site (data plane) and global scope rank by summary while D24 is on. */
export const summarized = (kind: number): boolean => routeSummary.on && (kind === SITE || kind === GLOBAL);

/** The D24 rank of child u of a router of `kind` (SITE: a zone; GLOBAL: a site). */
export const summaryRank = (w: World, kind: number, u: number, r: number): number =>
  kind === SITE ? zoneRank(w, u, r) : siteRank(w, u, r);

/** Brute force for tests: the lowest backlog per class over room m's systems that can admit now. */
export function bruteRoomMin(w: World, m: number): number[] {
  const c = w.compiled, b = backlogFor(w, memo.phase), cls = classIndex(c);
  const out = Array.from({ length: Math.max(1, classesOf(c).length) }, () => Infinity);
  for (let k = 0; k < RACKS_PER_ROOM; k += 1) {
    const r = c.room.racks[m * RACKS_PER_ROOM + k]!;
    for (let j = 0; r >= 0 && j < SERVERS_PER_RACK; j += 1) {
      const sys = c.rack.servers[r * SERVERS_PER_RACK + j]!;
      if (sys < 0 || c.sys.alive[sys] !== 1 || (cls[sys] ?? -1) < 0 || !canAdmit(w, sys)) continue;
      out[cls[sys]!] = Math.min(out[cls[sys]!]!, b.units[sys]!);
    }
  }
  return out;
}

/** The maintained per-class minima of room m (tests). */
export function roomMinOf(w: World, m: number): number[] {
  const s = current(w);
  return Array.from(s.roomMin.subarray(m * s.classes, m * s.classes + s.classes));
}
