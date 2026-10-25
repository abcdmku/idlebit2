import { G } from '../core/buffers';
import { MAX_SITES, MAX_ZONES_PER_SITE, MAX_ROOM_PORTS, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import type { World } from '../core/world';
import { canAdmit } from '../exec/slots';

/**
 * Routing scopes (spec §7.1). A router is (kind, id): a rack load balancer over its systems, a room
 * load balancer over its racks, a site data plane over its zones, or the global scheduler over
 * sites. Children are listed in slot order; a child is a candidate when it can admit now (§7.7):
 * connected and something below it can admit (free-slot summaries). Routers have no budget (D12.5).
 */
export const RACK = 0;
export const ROOM = 1;
export const SITE = 2;
export const GLOBAL = 3;

/** Child count per router kind. */
export const FANOUT = [SERVERS_PER_RACK, RACKS_PER_ROOM, MAX_ZONES_PER_SITE, MAX_SITES] as const;

/** The child unit in `slot` of router (kind, id), or -1. */
export function childAt(w: World, kind: number, id: number, slot: number): number {
  const c = w.compiled;
  switch (kind) {
    case RACK: return c.rack.servers[id * SERVERS_PER_RACK + slot]!;
    case ROOM: return slot < c.room.rows[id]! * 8 ? c.room.racks[id * RACKS_PER_ROOM + slot]! : -1;
    case SITE: return c.site.zones[id * MAX_ZONES_PER_SITE + slot]!;
    default: return slot < c.site.len && c.site.alive[slot] === 1 ? slot : -1;
  }
}

export interface RouterCols { strategy: number; filters: number }

export function routerOf(w: World, kind: number, id: number, out: RouterCols): RouterCols {
  const c = w.compiled;
  switch (kind) {
    case RACK: out.strategy = c.rack.lbStrategy[id]!; out.filters = c.rack.lbFilters[id]!; break;
    case ROOM: out.strategy = c.room.lbStrategy[id]!; out.filters = c.room.lbFilters[id]!; break;
    case SITE: out.strategy = c.site.dpStrategy[id]!; out.filters = c.site.dpFilters[id]!; break;
    default: out.strategy = c.global.lbStrategy[0]!; out.filters = c.global.lbFilters[0]!;
  }
  return out;
}

/** Counts one route at router (kind, id) and records the picked child slot (the LB decision light). */
export function noteRoute(w: World, kind: number, id: number, slot: number): void {
  const h = w.hot;
  switch (kind) {
    case RACK: h.rack.lbRouted[id] = h.rack.lbRouted[id]! + 1; h.rack.lbLast[id] = slot; break;
    case ROOM: h.room.lbRouted[id] = h.room.lbRouted[id]! + 1; h.room.lbLast[id] = slot; break;
    case SITE: h.site.lbRouted[id] = h.site.lbRouted[id]! + 1; h.site.lbLast[id] = slot; break;
    default: h.g[G.globalRouted] = h.g[G.globalRouted]! + 1;
  }
}

/** Start of the route phase: per-tick routed counters reset. Routers have no capacity budget (D12.5). */
export function resetRouted(w: World): void {
  const h = w.hot;
  h.rack.lbRouted.fill(0); h.rack.lbLast.fill(-1);
  h.room.lbRouted.fill(0); h.room.lbLast.fill(-1);
  h.site.lbRouted.fill(0); h.site.lbLast.fill(-1);
  h.g[G.globalRouted] = 0;
}

/** Can child `u` of a router of `kind` admit a task now (spec §7.7 step 1)? */
export function childAdmits(w: World, kind: number, u: number): boolean {
  const c = w.compiled, h = w.hot;
  switch (kind) {
    case RACK: return canAdmit(w, u);
    case ROOM: return c.rack.alive[u] === 1 && c.rack.opened[u] === 1 && h.rack.freeSlots[u]! > 0
      && c.room.portLink[c.rack.room[u]! * MAX_ROOM_PORTS + c.rack.slot[u]!]! >= 0;
    case SITE: return c.room.alive[u] === 1 && c.room.opened[u] === 1 && h.room.freeSlots[u]! > 0;
    default: return c.site.alive[u] === 1 && c.site.opened[u] === 1 && h.site.freeSlots[u]! > 0 && (u === 0 || c.site.backboneLink[u]! >= 0);
  }
}

/** The router a child of `kind` owns: a rack's LB under a room, a room's LB under a site, a site's data plane. */
export const childKind = (kind: number): number => kind - 1;

/**
 * The highest router that exists (spec §7.1): the global scheduler, else the gateway site's data
 * plane, else room 0's load balancer, else rack 0's; -1 before Rack (the lone system pulls).
 */
export function topRouter(w: World, out: { kind: number; id: number }): boolean {
  const c = w.compiled;
  if (c.global.exists[0] === 1) { out.kind = GLOBAL; out.id = 0; return true; }
  if (c.site.len > 0 && c.site.opened[0] === 1) { out.kind = SITE; out.id = 0; return true; }
  const room = c.site.len > 0 ? c.site.zones[0]! : -1;
  if (room >= 0 && c.room.opened[room] === 1) { out.kind = ROOM; out.id = room; return true; }
  const rack = room >= 0 ? c.room.racks[room * RACKS_PER_ROOM]! : -1;
  if (rack >= 0 && c.rack.opened[rack] === 1) { out.kind = RACK; out.id = rack; return true; }
  return false;
}
