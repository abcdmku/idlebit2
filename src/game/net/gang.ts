import { LINK_KIND, RECORD } from '../core/buffers';
import { MAX_UPS, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import { allocGang, allocRecord, freeRecord } from '../core/pool';
import { copyRow } from '../core/table';
import type { World } from '../core/world';
import { canRunOn, classesOf, gateOn } from '../market/fleet';
import { FAMILIES } from '../market/families';
import { takeHead } from '../market/queue';
import { shapeOf } from '../exec/shape';
import { admittedOf, canAdmit } from '../exec/slots';
import { applyFilters } from './filters';
import { cand, candidates, dispatch, firstLinkRoom, linkRoom, slots } from './hops';
import { linkOf } from './paths';
import { classIndex } from './finish';
import { beginDecision, memo } from './routeMemo';
import { routeStrategy } from './routers';
import { GLOBAL, noteRoute, RACK, ROOM, routerOf, SITE } from './scope';

/**
 * Distributed tasks (spec §7.8). Only a router with the `gang` placement places them. Walking down
 * from the top: a router without gang picks, by its filters and strategy, among children whose
 * subtree can host the whole gang; a router with gang delegates to a child router that also has
 * gang and can host it (lower scopes first), else places here. All members are reserved in this
 * routing step or none; that is the take.
 */
export const GANG_BIT = 1;
export const TOPOLOGY_BIT = 2;
export const ZONE_BIT = 4;

const cols = { strategy: 0, filters: 0, placements: 0 };
const childCols = { strategy: 0, filters: 0, placements: 0 };
let picked: number[] = [];

/**
 * The member gate of the gang being placed, per capability class: gateOn reads only class columns,
 * so one check per class answers it for every member. placeGang resets it. -1 unknown, 1 runs, 0 not.
 */
let classGate = new Int8Array(0);
let classOf: Int32Array = new Int32Array(0);

/** canRunOn(w, s, r) === 0, with the gate looked up per class. */
function runsOn(w: World, s: number, r: number): boolean {
  const cls = classOf[s] ?? -1;
  if (cls < 0) return canRunOn(w, s, r) === 0;
  const c = w.compiled, family = FAMILIES[w.hot.rec.family[r]!]!;
  if (family.members > 1 && c.rack.opened[c.sys.rack[s]!] !== 1) return false;
  let ok = classGate[cls]!;
  if (ok < 0) classGate[cls] = ok = gateOn(c, s, family, w.hot.rec.scale[r]!) === 0 ? 1 : 0;
  return ok === 1;
}

/*
 * Nothing eligibility reads changes while findTargets runs (members are dispatched after it), so
 * each system's answer and each rack's first-link room are memoized for one placeGang call.
 */
let stamp = 0;
let eligAt = new Int32Array(0), eligOk = new Uint8Array(0), rackAt = new Int32Array(0), rackRoom = new Int8Array(0);
function resetMemo(w: World): void {
  const c = w.compiled;
  if (eligAt.length < c.sys.len) { eligAt = new Int32Array(c.sys.len * 2); eligOk = new Uint8Array(c.sys.len * 2); }
  if (rackAt.length < c.rack.len) { rackAt = new Int32Array(c.rack.len * 2); rackRoom = new Int8Array(c.rack.len * 2); }
  stamp = (stamp + 1) | 0;
  if (stamp === 0) { eligAt.fill(0); rackAt.fill(0); stamp = 1; }
}

/**
 * firstLinkRoom(w, s). The links above the server port (backbone, zone, rack) depend only on the
 * rack, so the first of them answers for the whole rack; only a path that starts at the server
 * port is checked per system.
 */
function firstRoom(w: World, s: number): boolean {
  const rack = w.compiled.sys.rack[s]!;
  if (rackAt[rack] !== stamp) {
    rackAt[rack] = stamp;
    let l = -1;
    for (let k = LINK_KIND.backbone; k > LINK_KIND.server && l < 0; k -= 1) l = linkOf(w, s, k);
    rackRoom[rack] = l < 0 ? -1 : linkRoom(w, l, rack) ? 1 : 0;
  }
  const room = rackRoom[rack]!;
  return room < 0 ? firstLinkRoom(w, s) : room === 1;
}

/** A system that can take one member of record r now: canTake (room, first-link room) and canRunOn. */
function eligible(w: World, s: number, r: number): boolean {
  if (eligAt[s] === stamp) return eligOk[s] === 1;
  const ok = canAdmit(w, s) && runsOn(w, s, r) && firstRoom(w, s);
  eligAt[s] = stamp; eligOk[s] = ok ? 1 : 0;
  return ok;
}

/**
 * True when every capability class passes the member gate. Every system that can admit is a live
 * server, so it is in a class, and in an opened rack its eligibility is then canAdmit plus the
 * rack's first-link room.
 */
let allRun = false;

/**
 * Eligible systems in `rack` when they can be counted without visiting them: 0 with no free slot
 * or a hidden rack; with a rack-level first link, freeSlots (the systems that can admit) or 0.
 * -1 when the rack must be counted per system.
 */
function rackHosts(w: World, rack: number): number {
  const c = w.compiled;
  if (c.rack.alive[rack] !== 1) return -1;
  const free = w.hot.rack.freeSlots[rack]!;
  if (free === 0 || c.rack.opened[rack] !== 1) return 0;
  for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
    const s = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
    if (s < 0 || c.sys.alive[s] !== 1) continue;
    firstRoom(w, s);
    const room = rackRoom[rack]!;
    return room < 0 ? -1 : room === 1 ? free : 0;
  }
  return 0;
}

/** Eligible systems counted so far by hosts. */
let hostN = 0;
function hostRack(w: World, rack: number, r: number, m: number): boolean {
  const k = allRun ? rackHosts(w, rack) : w.compiled.rack.alive[rack] === 1 && w.hot.rack.freeSlots[rack] === 0 ? 0 : -1;
  if (k >= 0) hostN += k;
  else {
    const c = w.compiled;
    for (let j = 0; j < SERVERS_PER_RACK && hostN < m; j += 1) {
      const s = c.rack.servers[rack * SERVERS_PER_RACK + j]!;
      if (s >= 0 && c.sys.alive[s] === 1 && eligible(w, s, r)) hostN += 1;
    }
  }
  return hostN >= m;
}
function hostRoom(w: World, room: number, r: number, m: number): boolean {
  for (let k = 0; k < RACKS_PER_ROOM; k += 1) {
    const rack = w.compiled.room.racks[room * RACKS_PER_ROOM + k]!;
    if (rack >= 0 && hostRack(w, rack, r, m)) return true;
  }
  return false;
}

/** At least m eligible systems under child u of a router of `kind` (someSystem's order and set). */
function hosts(w: World, kind: number, u: number, r: number, m: number): boolean {
  hostN = 0;
  switch (kind) {
    case RACK: return eligible(w, u, r) && 1 >= m;
    case ROOM: return hostRack(w, u, r, m);
    case SITE: return hostRoom(w, u, r, m);
    default:
      for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) {
        const room = w.compiled.site.zones[u * MAX_ZONES_PER_SITE + z]!;
        if (room >= 0 && hostRoom(w, room, r, m)) return true;
      }
      return false;
  }
}

/**
 * All eligible systems under router (kind, id), in index-path order: someAdmitting's walk (sites,
 * zones, racks, slots) with its free-slot skip, unrolled. A rack whose first link sits above the
 * server port and has no room holds no eligible system and is skipped whole.
 */
function gather(w: World, kind: number, id: number, r: number): number[] {
  const out: number[] = [];
  const c = w.compiled;
  const free = memo.exact ? w.hot.rack.freeSlots : null;
  const rack = (k: number) => {
    if (free !== null && c.rack.alive[k] === 1 && free[k] === 0) return;
    for (let j = 0; j < SERVERS_PER_RACK; j += 1) {
      const s = c.rack.servers[k * SERVERS_PER_RACK + j]!;
      if (s < 0 || c.sys.alive[s] !== 1) continue;
      if (rackAt[k] === stamp && rackRoom[k] === 0) return;
      if (eligible(w, s, r)) out.push(s);
    }
  };
  const room = (m: number) => {
    for (let k = 0; k < RACKS_PER_ROOM; k += 1) { const rk = c.room.racks[m * RACKS_PER_ROOM + k]!; if (rk >= 0) rack(rk); }
  };
  const site = (u: number) => {
    for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) { const m = c.site.zones[u * MAX_ZONES_PER_SITE + z]!; if (m >= 0) room(m); }
  };
  switch (kind) {
    case RACK: rack(id); break;
    case ROOM: room(id); break;
    case SITE: site(id); break;
    default: for (let u = 0; u < c.site.len; u += 1) site(u);
  }
  return out;
}

const upsDark = (w: World, room: number): boolean => {
  for (let k = 0; k < MAX_UPS; k += 1) if (w.hot.room.upsFailed[room * MAX_UPS + k] === 1) return true;
  return false;
};

/** Picks `m` distinct systems at router (kind, id) per its placement modes (spec §7.8 step 3). */
function select(w: World, kind: number, id: number, r: number, m: number, placements: number): number[] {
  const minZones = shapeOf(w.hot.rec.family[r]!).def.minZones;
  if (minZones > 1 && (kind !== SITE && kind !== GLOBAL || (placements & ZONE_BIT) === 0)) return [];
  let pool = gather(w, kind, id, r);
  const c = w.compiled;
  const byLoad = (a: number, b: number) => admittedOf(w, a) - admittedOf(w, b) || a - b;
  if (kind === ROOM && (placements & TOPOLOGY_BIT) !== 0) {
    const perRack = new Map<number, number>();
    for (const s of pool) perRack.set(c.sys.rack[s]!, (perRack.get(c.sys.rack[s]!) ?? 0) + 1);
    pool = [...pool].sort((a, b) => perRack.get(c.sys.rack[b]!)! - perRack.get(c.sys.rack[a]!)! || c.sys.rack[a]! - c.sys.rack[b]! || byLoad(a, b));
    return pool.length >= m ? pool.slice(0, m) : [];
  }
  if ((placements & ZONE_BIT) !== 0 && (kind === SITE || kind === GLOBAL)) {
    pool = pool.filter((s) => !upsDark(w, c.sys.room[s]!));
    const zoneLoad = new Map<number, number>();
    for (const s of pool) zoneLoad.set(c.sys.room[s]!, (zoneLoad.get(c.sys.room[s]!) ?? 0) + admittedOf(w, s));
    const zones = [...zoneLoad.keys()].sort((a, b) => zoneLoad.get(a)! - zoneLoad.get(b)! || a - b).slice(0, minZones);
    if (zones.length < minZones) return [];
    const first = zones.map((z) => [...pool].filter((s) => c.sys.room[s] === z).sort(byLoad)[0]!);
    const rest = pool.filter((s) => !first.includes(s)).sort(byLoad);
    const out = [...first, ...rest];
    return out.length >= m ? out.slice(0, m) : [];
  }
  pool.sort(byLoad);
  return pool.length >= m ? pool.slice(0, m) : [];
}

/** Finds the placing router and its member targets for gang record r, walking from the top. */
function findTargets(w: World, r: number, m: number, kind: number, id: number): number[] {
  for (;;) {
    routerOf(w, kind, id, cols);
    if ((cols.placements & GANG_BIT) !== 0) {
      let delegated = false;
      if (kind !== RACK) {
        const n = candidates(w, kind, id);
        for (let i = 0; i < n && !delegated; i += 1) {
          routerOf(w, kind - 1, cand[i]!, childCols);
          if ((childCols.placements & GANG_BIT) !== 0 && hosts(w, kind, cand[i]!, r, m)) {
            noteRoute(w, kind, id, slots[i]!);
            id = cand[i]!; kind -= 1; delegated = true;
          }
        }
      }
      if (delegated) continue;
      return select(w, kind, id, r, m, cols.placements);
    }
    if (kind === RACK) return [];
    let n = candidates(w, kind, id);
    let keep = 0;
    for (let i = 0; i < n; i += 1) if (hosts(w, kind, cand[i]!, r, m)) { cand[keep] = cand[i]!; slots[keep] = slots[i]!; keep += 1; }
    if (keep === 0) return [];
    n = applyFilters(w, cols.filters, kind, r, cand, slots, keep);
    const pick = routeStrategy(cols.strategy).choose(w, kind, id, r, cand, slots, n);
    noteRoute(w, kind, id, slots[pick]!);
    id = cand[pick]!; kind -= 1;
  }
}

/**
 * Takes the distributed head probed as r (spec §7.8): every member is placed and reserved in this
 * routing step, or none is and false is returned. The head is taken once, as one logical task.
 */
export function placeGang(w: World, r: number, topKind: number, topId: number): boolean {
  const rec = w.hot.rec, c = w.compiled;
  const m = shapeOf(rec.family[r]!).members;
  classOf = classIndex(c);
  const classes = classesOf(c).length;
  if (classGate.length < classes) classGate = new Int8Array(classes * 2);
  classGate.fill(-1, 0, classes);
  resetMemo(w);
  const family = FAMILIES[rec.family[r]!]!;
  allRun = classesOf(c).every((cls, i) => (classGate[i] = gateOn(c, cls.rep, family, rec.scale[r]!) === 0 ? 1 : 0) === 1);
  beginDecision();
  picked = findTargets(w, r, m, topKind, topId);
  if (picked.length < m) return false;
  const task = takeHead(w, r);
  const g = allocGang(w.hot);
  const gang = w.hot.gang;
  gang.family[g] = rec.family[task]!; gang.members[g] = m; gang.placed[g] = m;
  gang.payout[g] = rec.payout[task]!; gang.next[g] = -1;
  const routedRack = new Set<number>(), routedRoom = new Set<number>();
  for (const s of picked) {
    const rack = c.sys.rack[s]!, room = c.sys.room[s]!;
    if (topKind !== RACK && !routedRack.has(rack)) { routedRack.add(rack); noteRoute(w, RACK, rack, c.sys.slot[s]!); }
    if ((topKind === SITE || topKind === GLOBAL) && !routedRoom.has(room)) { routedRoom.add(room); noteRoute(w, ROOM, room, c.rack.slot[rack]!); }
    if (topKind === RACK) noteRoute(w, RACK, rack, c.sys.slot[s]!);
    const member = allocRecord(w.hot);
    copyRow(RECORD, rec, task, member);
    rec.count[member] = 1; rec.gang[member] = g; rec.prev[member] = -1; rec.next[member] = -1;
    dispatch(w, member, s);
  }
  freeRecord(w.hot, task);
  return true;
}
