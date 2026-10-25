import { LINK_KIND } from '../core/buffers';
import { DT_S, GATHER_WAIT_TICKS, MAX_ROOM_PORTS, MAX_SHARDS, MAX_UPS, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import { rqLen, rqLevel, rqRow } from '../core/routerQueue';
import type { World } from '../core/world';
import { canRunOn } from '../market/fleet';
import { hasRule } from '../exec/rules';
import { canAdmit } from '../exec/slots';
import { applyFilters, FILTER_BIT } from './filters';
import { FIRST, linkOf, nextLink } from './paths';
import { FAMILIES } from '../market/families';
import { REGION_IDS } from '../types/catalog';
import { beginDecision, memo } from './routeMemo';
import { routeStrategy } from './routers';
import { SINGLE_SITE } from './routers/latency';
import { childAt, FANOUT, GLOBAL, RACK, ROOM, routerOf, SITE } from './scope';
import { floorShards } from './floor';

/**
 * split(R, e) (spec §7.7, §7.8, D25.2): cuts entry e (a task of s units or a share of u units) at
 * router R into a split tree whose leaves are systems (one shard each) and child-router queues.
 * Candidates are the children with room now; filters narrow them; the strategy orders them and
 * weighs their shares. n = max(1, min(candidates, floor(u / ĝ))) shards of whole units, none below
 * ĝ, the remainder to the first in walk order. A share for a child router is split there in the
 * same step, or enters its queue. A minimum-split task (members > 1) counts systems with room only
 * and never enters a child queue. Nothing is reserved here: the caller commits `tree` atomically.
 */

/** The split tree of the last successful split: leaf i is a system (kind -1) or router queue (kind, id). */
export const tree = {
  n: 0, kind: new Int8Array(512), id: new Int32Array(512), units: new Float64Array(512),
  /** Route notes (the LB decision light) and strategy cursors to apply on commit. */
  notes: 0, noteKind: new Int8Array(2048), noteId: new Int32Array(2048), noteSlot: new Int16Array(2048),
  used: 0, usedKind: new Int8Array(2048), usedId: new Int32Array(2048), usedSlot: new Int16Array(2048), usedStrategy: new Uint8Array(2048),
};

/** Why the last split failed: `room` when no child of the router had room for it, or Gather waits for more. */
export const splitMiss = { room: false };

/** The entry being split. */
interface Entry { probe: number; size: number; grainHat: number; members: number; minZones: number; region: number; since: number }
const entry: Entry = { probe: -1, size: 0, grainHat: 1, members: 1, minZones: 1, region: -1, since: 0 };

const cand = [0, 1, 2, 3].map(() => new Int32Array(32));
const slots = [0, 1, 2, 3].map(() => new Int32Array(32));
const weight = [0, 1, 2, 3].map(() => new Float64Array(32));
const cols = { strategy: 0, filters: 0 };

/**
 * First-link room (spec §7.4): link l's queued, unsent bits are under one tick of its capacity. One
 * take may then queue every shard of the task on it (D25.4). Queued take is gone (D25.7).
 */
export const linkRoom = (w: World, l: number): boolean =>
  w.hot.link.backlog[l]! < Math.max(1, w.compiled.link.channels[l]!) * w.compiled.link.speed[l]! * DT_S;

/** First-link room of system s's path (no link: the lone pipe, checked by exec). */
export function firstLinkRoom(w: World, s: number): boolean {
  const l = nextLink(w, s, FIRST);
  return l < 0 || linkRoom(w, l);
}

/** A system that can take a shard now (spec §6.4): room, a take left this tick, first-link room. */
export const canTake = (w: World, s: number): boolean => canAdmit(w, s) && firstLinkRoom(w, s);

/** Rack-level first-link room per rack for this split (-1 unknown, 0 no, 1 yes, 2 checked per system). */
let rackStamp = 0;
let rackAt = new Int32Array(0), rackRoomOk = new Int8Array(0);
function rackLinkRoom(w: World, rack: number): number {
  if (rackAt[rack] === rackStamp) return rackRoomOk[rack]!;
  const c = w.compiled;
  let v = 2;
  for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
    const s = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
    if (s < 0 || c.sys.alive[s] !== 1) continue;
    let l = -1;
    for (let kind = LINK_KIND.backbone; kind > LINK_KIND.server && l < 0; kind -= 1) l = linkOf(w, s, kind);
    v = l < 0 ? 2 : linkRoom(w, l) ? 1 : 0;
    break;
  }
  rackAt[rack] = rackStamp; rackRoomOk[rack] = v;
  return v;
}

/**
 * Zone-level first-link room for this split (0 no, 1 yes, 2 no shared link): above the rack, a
 * room's systems share their first link (the site backbone, else the zone link), so a full one
 * leaves no system in the room with room to take.
 */
let roomAt = new Int32Array(0), roomRoomOk = new Int8Array(0);
function roomLinkRoom(w: World, room: number): number {
  if (roomAt[room] === rackStamp) return roomRoomOk[room]!;
  const c = w.compiled;
  let v = 2;
  for (let k = 0; k < RACKS_PER_ROOM && v === 2; k += 1) {
    const rack = c.room.racks[room * RACKS_PER_ROOM + k]!;
    if (rack < 0 || c.rack.alive[rack] !== 1) continue;
    for (let j = 0; j < SERVERS_PER_RACK; j += 1) {
      const s = c.rack.servers[rack * SERVERS_PER_RACK + j]!;
      if (s < 0 || c.sys.alive[s] !== 1) continue;
      let l = linkOf(w, s, LINK_KIND.backbone);
      if (l < 0) l = linkOf(w, s, LINK_KIND.zone);
      v = l < 0 ? 2 : linkRoom(w, l) ? 1 : 0;
      break;
    }
  }
  roomAt[room] = rackStamp; roomRoomOk[room] = v;
  return v;
}

/** Systems that can take now under rack `rack`, counted up to `cap`. */
function rackTakers(w: World, rack: number, cap: number): number {
  const c = w.compiled;
  if (c.rack.alive[rack] !== 1 || c.rack.opened[rack] !== 1) return 0;
  if (memo.exact && w.hot.rack.freeSlots[rack] === 0) return 0;
  const link = rackLinkRoom(w, rack);
  if (link === 0) return 0;
  let n = 0;
  for (let k = 0; k < SERVERS_PER_RACK && n < cap; k += 1) {
    const s = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
    if (s >= 0 && c.sys.alive[s] === 1 && (link === 1 ? canAdmit(w, s) : canTake(w, s))) n += 1;
  }
  return n;
}

/** Systems with room under child `u` of a router of `kind`, up to `cap` (0 = none). */
export function takers(w: World, kind: number, u: number, cap: number): number {
  const c = w.compiled;
  switch (kind) {
    case RACK: return canTake(w, u) ? 1 : 0;
    case ROOM: return rackTakers(w, u, cap);
    case SITE: {
      if (memo.exact && w.hot.room.freeSlots[u] === 0) return 0;
      if (roomLinkRoom(w, u) === 0) return 0;
      let n = 0;
      for (let k = 0; k < RACKS_PER_ROOM && n < cap; k += 1) { const r = c.room.racks[u * RACKS_PER_ROOM + k]!; if (r >= 0) n += rackTakers(w, r, cap - n); }
      return n;
    }
    default: {
      if (memo.exact && w.hot.site.freeSlots[u] === 0) return 0;
      let n = 0;
      for (let z = 0; z < MAX_ZONES_PER_SITE && n < cap; z += 1) { const m = c.site.zones[u * MAX_ZONES_PER_SITE + z]!; if (m >= 0) n += takers(w, SITE, m, cap - n); }
      return n;
    }
  }
}

/** Child u of a router of `kind` is connected (spec §7.7 step 1: a port, an opened unit, a backbone). */
function connected(w: World, kind: number, u: number): boolean {
  const c = w.compiled;
  switch (kind) {
    case RACK: return true;
    case ROOM: return c.rack.alive[u] === 1 && c.rack.opened[u] === 1 && c.room.portLink[c.rack.room[u]! * MAX_ROOM_PORTS + c.rack.slot[u]!]! >= 0;
    case SITE: return c.room.alive[u] === 1 && c.room.opened[u] === 1;
    default: return c.site.alive[u] === 1 && c.site.opened[u] === 1 && (u === 0 || c.site.backboneLink[u]! >= 0);
  }
}

/** Free slots in the queue of router (kind, id). */
export function queueFree(w: World, kind: number, id: number): number {
  const row = rqRow(w.hot, kind, id);
  return row < w.hot.rq.len ? Math.max(0, rqLevel(w.compiled, kind, id) - rqLen(w.hot, row)) : 0;
}
const queueEmpty = (w: World, kind: number, id: number): boolean => {
  const row = rqRow(w.hot, kind, id);
  return row >= w.hot.rq.len || rqLen(w.hot, row) === 0;
};

/** local (spec §8.4): keep the first candidate whose systems with room could take the whole split alone. */
function localFilter(w: World, kind: number, C: Int32Array, S: Int32Array, n: number, need: number): number {
  let m = n;
  if (kind === SITE) {
    let k = 0;
    for (let i = 0; i < m; i += 1) {
      let dark = false;
      for (let u = 0; u < MAX_UPS; u += 1) if (w.hot.room.upsFailed[C[i]! * MAX_UPS + u] === 1) dark = true;
      if (!dark) { C[k] = C[i]!; S[k] = S[i]!; k += 1; }
    }
    if (k > 0) m = k;
  }
  for (let i = 0; i < m; i += 1) {
    if (takers(w, kind, C[i]!, need) >= need) {
      C[0] = C[i]!; S[0] = S[i]!;
      return 1;
    }
  }
  return m;
}

function rollback(n: number, notes: number, used: number): false { tree.n = n; tree.notes = notes; tree.used = used; return false; }

function addLeaf(kind: number, id: number, units: number): void {
  tree.kind[tree.n] = kind; tree.id[tree.n] = id; tree.units[tree.n] = units; tree.n += 1;
}

/** Splits `u` units at router (kind, id). `exact` > 0: a minimum split of exactly that many shards. */
function splitAt(w: World, kind: number, id: number, u: number, exact: number, depth: number): boolean {
  const n0 = tree.n, notes0 = tree.notes, used0 = tree.used;
  const C = cand[depth]!, S = slots[depth]!, Wt = weight[depth]!;
  const rec = w.hot.rec, probe = entry.probe, gHat = entry.grainHat;
  let n = 0, connectedN = 0;
  // A rack's systems share their first link when it is the rack uplink or above (rackLinkRoom).
  const rackLink = kind === RACK ? rackLinkRoom(w, id) : 2;
  for (let k = 0; k < FANOUT[kind]!; k += 1) {
    const child = childAt(w, kind, id, k);
    if (child < 0 || !connected(w, kind, child)) continue;
    if (kind === RACK && w.compiled.sys.kind[child] !== 0) continue;
    connectedN += 1;
    let room: boolean;
    if (kind === RACK) room = rackLink === 0 ? false : rackLink === 1 ? canAdmit(w, child) : canTake(w, child);
    else if (exact > 0) room = takers(w, kind, child, 1) > 0;
    else room = (queueEmpty(w, kind - 1, child) && takers(w, kind, child, 1) > 0) || queueFree(w, kind - 1, child) > 0;
    if (!room) continue;
    C[n] = child; S[n] = k; n += 1;
  }
  if (n === 0) { if (depth === 0) splitMiss.room = true; return false; }
  // Gather (spec §8.5): wait until half the children have room, or the entry has waited 10 s.
  if (hasRule(w, 'gather') && n * 2 < connectedN && w.tick - entry.since < GATHER_WAIT_TICKS) { if (depth === 0) splitMiss.room = true; return false; }
  routerOf(w, kind, id, cols);
  rec.units[probe] = gHat;
  beginDecision();
  n = applyFilters(w, cols.filters, kind, probe, C, S, n);
  if (exact > 0 && entry.region >= 0 && kind === GLOBAL) {
    let k = 0;
    for (let i = 0; i < n; i += 1) if (w.compiled.site.region[C[i]!] === entry.region) { C[k] = C[i]!; S[k] = S[i]!; k += 1; }
    n = k;
    if (n === 0) return false;
  }
  if ((cols.filters & FILTER_BIT.local) !== 0 && kind !== RACK) {
    const need = exact > 0 ? exact : Math.min(MAX_SHARDS, Math.max(1, Math.floor(u / gHat)), floorShards(w.compiled, kind, id, rec.family[probe]!, u));
    n = localFilter(w, kind, C, S, n, need);
  }
  rec.units[probe] = u;
  beginDecision();
  const strategy = routeStrategy(cols.strategy);
  n = strategy.plan(w, kind, id, probe, C, S, Wt, n);
  if (kind === GLOBAL && exact === 0 && SINGLE_SITE.has(strategy.id)) n = Math.min(n, 1);

  if (exact > 0) {
    const cap = new Int32Array(n), alloc = new Int32Array(n);
    let total = 0;
    for (let i = 0; i < n; i += 1) { cap[i] = kind === RACK ? 1 : takers(w, kind, C[i]!, exact); total += cap[i]!; }
    if (total < exact) return rollback(n0, notes0, used0);
    // Round robin in walk order, so shards spread over racks and zones.
    for (let left = exact; left > 0;) for (let i = 0; i < n && left > 0; i += 1) if (alloc[i]! < cap[i]!) { alloc[i] = alloc[i]! + 1; left -= 1; }
    let first = -1, given = 0;
    const share = new Float64Array(n);
    for (let i = 0; i < n; i += 1) if (alloc[i]! > 0) { share[i] = Math.floor((u * alloc[i]!) / exact); given += share[i]!; if (first < 0) first = i; }
    share[first] = share[first]! + (u - given);
    for (let i = 0; i < n; i += 1) {
      if (alloc[i] === 0) continue;
      note(kind, id, S[i]!);
      if (kind === RACK) addLeaf(-1, C[i]!, share[i]!);
      else if (!splitAt(w, kind - 1, C[i]!, share[i]!, alloc[i]!, depth + 1)) return rollback(n0, notes0, used0);
    }
    return true;
  }

  // Shard count and choice (spec §7.7 steps 3 and 4).
  // The split floor (D25.11): no shard under 1 s of work at the fastest nominal rate below.
  const shards = Math.max(1, Math.min(n, Math.floor(u / gHat), floorShards(w.compiled, kind, id, rec.family[probe]!, u)));
  let pick: number[] = Array.from({ length: n }, (_, i) => i);
  if (strategy.weighted) pick.sort((a, b) => Wt[b]! - Wt[a]! || a - b);
  pick = pick.slice(0, shards).sort((a, b) => a - b);
  let share = new Float64Array(0);
  for (;;) {
    let sum = 0;
    for (const i of pick) sum += Wt[i]!;
    share = new Float64Array(pick.length);
    let low = false;
    for (let j = 0; j < pick.length; j += 1) {
      share[j] = sum > 0 ? Math.floor((u * Wt[pick[j]!]!) / sum) : Math.floor(u / pick.length);
      if (share[j]! < gHat) low = true;
    }
    if (!low || pick.length === 1) break;
    const kept = pick.filter((_, j) => share[j]! >= gHat);
    pick = kept.length > 0 ? kept : pick.slice(0, 1);
  }
  let given = 0;
  for (let j = 0; j < pick.length; j += 1) given += share[j]!;
  share[0] = share[0]! + (u - given);
  const capability = (cols.filters & FILTER_BIT.capability) !== 0;
  for (let j = 0; j < pick.length; j += 1) {
    const i = pick[j]!, child = C[i]!, part = share[j]!;
    note(kind, id, S[i]!);
    if (kind === RACK) {
      if (capability) { rec.units[probe] = part; if (canRunOn(w, child, probe) !== 0) return rollback(n0, notes0, used0); }
      addLeaf(-1, child, part);
      continue;
    }
    const before = tree.n, beforeNotes = tree.notes, beforeUsed = tree.used;
    if (queueEmpty(w, kind - 1, child) && takers(w, kind, child, 1) > 0 && splitAt(w, kind - 1, child, part, 0, depth + 1)) continue;
    rollback(before, beforeNotes, beforeUsed);
    if (queueFree(w, kind - 1, child) > 0) { addLeaf(kind - 1, child, part); continue; }
    return rollback(n0, notes0, used0);
  }
  if (strategy.used) {
    tree.usedKind[tree.used] = kind; tree.usedId[tree.used] = id; tree.usedSlot[tree.used] = S[pick[pick.length - 1]!]!;
    tree.usedStrategy[tree.used] = cols.strategy; tree.used += 1;
  }
  return true;
}

function note(kind: number, id: number, slot: number): void {
  tree.noteKind[tree.notes] = kind; tree.noteId[tree.notes] = id; tree.noteSlot[tree.notes] = slot; tree.notes += 1;
}

/**
 * Splits the entry probed as record `probe` (family and size set; its units are used as scratch and
 * restored) at router (kind, id). `units` is the entry's units (s for a whole task, u for a share).
 * Returns true with the tree in `tree`, or false when it can't be split now.
 */
export function split(w: World, kind: number, id: number, probe: number, units: number, size: number, whole: boolean, since: number): boolean {
  const c = w.compiled, rec = w.hot.rec;
  const family = rec.family[probe]!;
  const def = familyDef(family);
  if (rackAt.length < c.rack.len) { rackAt = new Int32Array(c.rack.len * 2); rackRoomOk = new Int8Array(c.rack.len * 2); }
  if (roomAt.length < c.room.len) { roomAt = new Int32Array(c.room.len * 2); roomRoomOk = new Int8Array(c.room.len * 2); }
  rackStamp = (rackStamp + 1) | 0;
  if (rackStamp === 0) { rackAt.fill(0); roomAt.fill(0); rackStamp = 1; }
  entry.probe = probe; entry.size = size; entry.since = since;
  entry.grainHat = Math.max(Math.max(1, def.grain), Math.ceil(size / MAX_SHARDS));
  entry.members = whole ? Math.max(1, def.members) : 1;
  entry.minZones = whole ? def.minZones : 1;
  entry.region = def.region.kind === 'in' ? REGION_INDEX.get(def.region.region) ?? -1 : -1;
  tree.n = 0; tree.notes = 0; tree.used = 0;
  splitMiss.room = false;
  let ok: boolean;
  if (entry.members > 1) {
    let total = 0;
    for (let k = 0; k < FANOUT[kind]! && total < MAX_SHARDS; k += 1) {
      const child = childAt(w, kind, id, k);
      if (child >= 0 && connected(w, kind, child) && (kind !== RACK || c.sys.kind[child] === 0)) total += takers(w, kind, child, MAX_SHARDS - total);
    }
    const exact = Math.min(total, MAX_SHARDS, Math.max(1, Math.floor(size / entry.grainHat)), Math.max(entry.members, floorShards(c, kind, id, family, units)));
    if (exact < entry.members) splitMiss.room = true;
    ok = exact >= entry.members && splitAt(w, kind, id, units, exact, 0) && zonesOk(w);
  } else ok = splitAt(w, kind, id, units, 0, 0);
  rec.units[probe] = units;
  if (!ok) tree.n = 0;
  return ok && tree.n > 0;
}

/** A minimum split spans minZones zones and stays in its region (spec §7.8 item 1). */
function zonesOk(w: World): boolean {
  const c = w.compiled;
  const rooms = new Set<number>();
  for (let i = 0; i < tree.n; i += 1) {
    const s = tree.id[i]!;
    rooms.add(c.sys.room[s]!);
    if (entry.region >= 0 && c.site.region[c.sys.site[s]!] !== entry.region) return false;
  }
  return rooms.size >= entry.minZones;
}

const REGION_INDEX = new Map<string, number>(REGION_IDS.map((r, i) => [r, i]));
const familyDef = (f: number) => FAMILIES[f]!;
