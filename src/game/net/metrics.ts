import { MAX_UPS, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import type { CompiledBuffers } from '../core/buffers';
import type { World } from '../core/world';
import { admittedOf, canAdmit, keffOf } from '../exec/slots';
import { memo } from './routeMemo';
import { RACK, ROOM, SITE } from './scope';

/**
 * Per-candidate quantities the strategies and filters compare (spec §8.3, §8.4). A candidate of a
 * router of `kind` is a system (rack LB), a rack (room LB), a room (data plane) or a site (global).
 */

type Visit = (s: number) => boolean;


/** Live systems of rack r in slot order; with `free`, a live rack with 0 free slots is skipped. */
function visitRack(c: CompiledBuffers, r: number, visit: Visit, free: ArrayLike<number> | null): boolean {
  if (free !== null && c.rack.alive[r] === 1 && free[r] === 0) return false;
  for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
    const s = c.rack.servers[r * SERVERS_PER_RACK + k]!;
    if (s >= 0 && c.sys.alive[s] === 1 && visit(s)) return true;
  }
  return false;
}
function visitRoom(c: CompiledBuffers, m: number, visit: Visit, free: ArrayLike<number> | null): boolean {
  for (let k = 0; k < RACKS_PER_ROOM; k += 1) { const r = c.room.racks[m * RACKS_PER_ROOM + k]!; if (r >= 0 && visitRack(c, r, visit, free)) return true; }
  return false;
}
function walk(c: CompiledBuffers, kind: number, u: number, visit: Visit, free: ArrayLike<number> | null): boolean {
  switch (kind) {
    case RACK: return visit(u);
    case ROOM: return visitRack(c, u, visit, free);
    case SITE: return visitRoom(c, u, visit, free);
    default:
      for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) { const m = c.site.zones[u * MAX_ZONES_PER_SITE + z]!; if (m >= 0 && visitRoom(c, m, visit, free)) return true; }
      return false;
  }
}

/** Calls `visit` for every live system under child `u` of a router of `kind`; stops when it returns true. */
export const someSystem = (w: World, kind: number, u: number, visit: Visit): boolean => walk(w.compiled, kind, u, visit, null);

/**
 * someSystem for a `visit` that is false for every system that cannot admit now. During routing
 * it skips racks with no free slot, which can change nothing; otherwise it is someSystem.
 */
export const someAdmitting = (w: World, kind: number, u: number, visit: Visit): boolean =>
  walk(w.compiled, kind, u, visit, memo.exact ? w.hot.rack.freeSlots : null);
/** conns(c): admitted + reserved tasks under the candidate. */
export function conns(w: World, kind: number, u: number): number {
  if (kind === RACK) return admittedOf(w, u);
  if (kind === ROOM) return w.hot.rack.admitted[u]!;
  let n = 0;
  someSystem(w, kind, u, (s) => { n += admittedOf(w, s); return false; });
  return n;
}

/** rated(c): Σ rated compute ops/s (lanes × clock × threads at e = 1, factor 1). */
export function rated(w: World, kind: number, u: number): number {
  let ops = 0;
  someSystem(w, kind, u, (s) => { ops += w.compiled.sys.threadRate[s]! * Math.max(1, w.compiled.sys.threads[s]!); return false; });
  return ops;
}

/** Last tick's usage of the candidate's own supply (rack LB: the PSU; room: the PDU; site: the UPS; global: the grid). */
export function supplyUsage(w: World, kind: number, u: number): number {
  const h = w.hot;
  switch (kind) {
    case RACK: return h.sys.psuUsage[u]!;
    case ROOM: return h.rack.pduUsage[u]!;
    case SITE: { let m = 0; for (let k = 0; k < MAX_UPS; k += 1) m = Math.max(m, h.room.upsUsage[u * MAX_UPS + k]!); return m; }
    default: return h.site.gridUsage[u]!;
  }
}

/** Overload timer of the candidate's own supply is running (spec §8.4 power / health). */
export function supplyOver(w: World, kind: number, u: number): boolean {
  const h = w.hot;
  switch (kind) {
    case RACK: return h.sys.psuOverTicks[u]! > 0;
    case ROOM: return h.rack.pduOverTicks[u]! > 0;
    case SITE: { for (let k = 0; k < MAX_UPS; k += 1) if (h.room.upsOverTicks[u * MAX_UPS + k]! > 0) return true; return false; }
    default: return h.site.gridOverTicks[u]! > 0;
  }
}

/** binPack: has a system that can admit now with running + reserved below its running limit. */
export const hasRunRoom = (w: World, kind: number, u: number): boolean =>
  someAdmitting(w, kind, u, (s) => canAdmit(w, s) && w.hot.sys.running[s]! + w.hot.sys.reserved[s]! < keffOf(w, s));
