import { G, RQ, routerRows, type CompiledBuffers, type HotBuffers } from './buffers';
import { ROUTER_QUEUE_MAX } from './constants';
import { allocTable } from './table';
import type { World } from './world';

type Routed = Pick<World, 'hot' | 'compiled'>;

/**
 * Router queues (D25.7, spec §7.1): fixed rings in hot.rq, one row per router. Rows run global 0,
 * then sites, zones (rooms) and racks in id order, for the site and room counts in hot.g
 * (G.rqSites, G.rqRooms). Router kinds follow net/scope: rack 0, room 1, site 2, global 3.
 * Pure data helpers; the routing rules live in net/.
 */

const Q = ROUTER_QUEUE_MAX;

/** The hot.rq row of router (kind, id). */
export function rqRow(hot: HotBuffers, kind: number, id: number): number {
  switch (kind) {
    case 3: return 0;
    case 2: return 1 + id;
    case 1: return 1 + hot.g[G.rqSites]! + id;
    default: return 1 + hot.g[G.rqSites]! + hot.g[G.rqRooms]! + id;
  }
}

/** The compiled queue level L (1–32) of router (kind, id); 0 when it does not exist. */
export function rqLevel(c: CompiledBuffers, kind: number, id: number): number {
  switch (kind) {
    case 3: return c.global.exists[0] === 1 ? c.global.lbQueueSlots[0]! : 0;
    case 2: return c.site.dpQueueSlots[id]!;
    case 1: return c.room.lbQueueSlots[id]!;
    default: return c.rack.lbQueueSlots[id]!;
  }
}

export const rqLen = (hot: HotBuffers, row: number): number => hot.rq.rqLen[row]!;
/** Ring index of the i-th entry (0 = front) of row `row`. */
export const rqAt = (hot: HotBuffers, row: number, i: number): number => row * Q + ((hot.rq.rqHead[row]! + i) % Q);

/** Appends an entry at the back. The caller checked the level. */
export function rqPush(hot: HotBuffers, row: number, task: number, parent: number, units: number, family: number, since: number): void {
  const q = hot.rq, len = q.rqLen[row]!;
  if (len >= Q) throw new Error('rqPush: router queue full');
  const at = rqAt(hot, row, len);
  q.rqTask[at] = task; q.rqParent[at] = parent; q.rqUnits[at] = units; q.rqFamily[at] = family; q.rqSince[at] = since;
  q.rqLen[row] = len + 1;
  hot.g[G.rqTotal] = hot.g[G.rqTotal]! + 1;
}

/**
 * Wakes router (kind, id) and every router above it: something below may now take a split (a slot
 * or queue slot freed, a first link cleared, a mode change), so their blocked front entries are
 * tried again in the next dispatch (net/hops.ts). Kinds as rqRow; a rack outside any room wakes
 * global only above itself.
 */
export function wakeRouters(w: Routed, kind: number, id: number): void {
  const hot = w.hot, c = w.compiled, wait = hot.rq.rqWait, n = hot.rq.len;
  if (n === 0) return;
  wait[0] = 0;
  let room = -1, site = -1;
  if (kind === 0) {
    const row = rqRow(hot, 0, id);
    if (row < n) wait[row] = 0;
    room = id < c.rack.len ? c.rack.room[id]! : -1;
  } else if (kind === 1) room = id;
  else if (kind === 2) site = id;
  if (room >= 0) {
    const row = rqRow(hot, 1, room);
    if (row < n) wait[row] = 0;
    site = room < c.room.len ? c.room.site[room]! : -1;
  }
  if (site >= 0) {
    const row = rqRow(hot, 2, site);
    if (row < n) wait[row] = 0;
  }
}

/** Wakes every router (a build or research change). */
export const wakeAllRouters = (hot: HotBuffers): void => { hot.rq.rqWait.fill(0); };

/** The router (kind, id) of hot.rq row `row`, into out. */
function routerOfRow(hot: HotBuffers, row: number, out: { kind: number; id: number }): void {
  const sites = hot.g[G.rqSites]!, rooms = hot.g[G.rqRooms]!;
  if (row === 0) { out.kind = 3; out.id = 0; }
  else if (row <= sites) { out.kind = 2; out.id = row - 1; }
  else if (row <= sites + rooms) { out.kind = 1; out.id = row - 1 - sites; }
  else { out.kind = 0; out.id = row - 1 - sites - rooms; }
}
const freed = { kind: 0, id: 0 };

/** Removes the entry at position i (0 = front), keeping the others in order. Its slot is free: wakes the router and those above. */
export function rqRemove(w: Routed, row: number, i: number): void {
  const hot = w.hot;
  routerOfRow(hot, row, freed);
  wakeRouters(w, freed.kind, freed.id);
  const q = hot.rq, len = q.rqLen[row]!;
  if (i === 0) {
    const at = rqAt(hot, row, 0);
    q.rqTask[at] = 0; q.rqParent[at] = -1; q.rqUnits[at] = 0; q.rqFamily[at] = 0; q.rqSince[at] = 0;
    q.rqHead[row] = (q.rqHead[row]! + 1) % Q;
    q.rqLen[row] = len - 1;
    hot.g[G.rqTotal] = hot.g[G.rqTotal]! - 1;
    return;
  }
  for (let j = i; j + 1 < len; j += 1) {
    const to = rqAt(hot, row, j), from = rqAt(hot, row, j + 1);
    q.rqTask[to] = q.rqTask[from]!; q.rqParent[to] = q.rqParent[from]!; q.rqUnits[to] = q.rqUnits[from]!;
    q.rqFamily[to] = q.rqFamily[from]!; q.rqSince[to] = q.rqSince[from]!;
  }
  const last = rqAt(hot, row, len - 1);
  q.rqTask[last] = 0; q.rqParent[last] = -1; q.rqUnits[last] = 0; q.rqFamily[last] = 0; q.rqSince[last] = 0;
  q.rqLen[row] = len - 1;
  hot.g[G.rqTotal] = hot.g[G.rqTotal]! - 1;
}

/** Empties every router queue (round end). */
export function rqClear(hot: HotBuffers): void {
  const q = hot.rq;
  q.rqLen.fill(0); q.rqHead.fill(0); q.rqWait.fill(0); q.rqParent.fill(-1); q.rqTask.fill(0); q.rqUnits.fill(0); q.rqFamily.fill(0); q.rqSince.fill(0);
  hot.g[G.rqTotal] = 0;
}

/**
 * Keeps hot.rq laid out for compiled `c` (in place; the caller owns hot): grows it, and when the
 * site or room count changed, moves every router's row to its new index.
 */
export function syncRouterQueues(hot: HotBuffers, c: CompiledBuffers): void {
  const sites = c.site.len, rooms = c.room.len, racks = c.rack.len;
  const oldSites = hot.g[G.rqSites]!, oldRooms = hot.g[G.rqRooms]!;
  const rows = routerRows({ sites, rooms, racks });
  const q = hot.rq;
  if (oldSites === sites && oldRooms === rooms && q.len >= rows) return;
  const oldRacks = Math.max(0, q.len - 1 - oldSites - oldRooms);
  const fresh = allocTable(RQ, Math.max(rows, q.len), Math.max(rows, q.len));
  const move = (from: number, to: number) => {
    if (from >= q.len || to >= fresh.len) return;
    for (const key of Object.keys(RQ) as (keyof typeof RQ)[]) {
      const stride = (RQ[key] as { stride?: number }).stride ?? 1;
      const src = q[key], dst = fresh[key];
      for (let j = 0; j < stride; j += 1) dst[to * stride + j] = src[from * stride + j]!;
    }
  };
  move(0, 0);
  for (let s = 0; s < oldSites; s += 1) move(1 + s, 1 + s);
  for (let m = 0; m < oldRooms; m += 1) move(1 + oldSites + m, 1 + sites + m);
  for (let r = 0; r < oldRacks; r += 1) move(1 + oldSites + oldRooms + r, 1 + sites + rooms + r);
  const table = q as unknown as Record<string, unknown>;
  for (const key of Object.keys(RQ)) table[key] = (fresh as unknown as Record<string, unknown>)[key];
  q.len = fresh.len; q.cap = fresh.cap;
  hot.g[G.rqSites] = sites; hot.g[G.rqRooms] = rooms;
}
