import { compileUnits } from '../build/compile';
import type { BuildState } from '../types/build';
import { REGION_IDS } from '../types/catalog';
import type { ResearchState } from '../types/state';
import {
  LINK_HOT, RACK_HOT, ROOM_HOT, SITE_HOT, SYS_HOT, allocCompiled, type CompiledBuffers, type FleetSize, type HotBuffers,
} from './buffers';
import { MAX_ZONES_PER_SITE, RACKS_PER_ROOM, SERVERS_PER_RACK } from './constants';
import { syncRouterQueues } from './routerQueue';
import { ensureRows } from './table';

export const fleetSize = (build: BuildState): FleetSize => ({
  systems: build.systems.length, racks: build.racks.length, rooms: build.rooms.length, sites: build.sites.length, links: 0,
});

/**
 * Writes the structural compiled columns (alive, opened, kind, intent, parents, slots, children)
 * from build. `intent` is 1 when the unit's own online switch and every ancestor's are on.
 */
export function writeTopology(c: CompiledBuffers, build: BuildState): void {
  for (const site of build.sites) {
    if (!site) continue;
    const i = site.id;
    c.site.alive[i] = 1; c.site.opened[i] = site.opened ? 1 : 0; c.site.intent[i] = site.online ? 1 : 0;
    c.site.region[i] = REGION_IDS.indexOf(site.region);
    for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) c.site.zones[i * MAX_ZONES_PER_SITE + z] = site.zones[z] ?? -1;
  }
  for (const room of build.rooms) {
    if (!room) continue;
    const i = room.id;
    c.room.alive[i] = 1; c.room.opened[i] = room.opened ? 1 : 0;
    c.room.intent[i] = room.online && c.site.intent[room.site] === 1 ? 1 : 0;
    c.room.site[i] = room.site; c.room.zone[i] = room.zone; c.room.rows[i] = room.rows;
    for (let s = 0; s < RACKS_PER_ROOM; s += 1) c.room.racks[i * RACKS_PER_ROOM + s] = room.racks[s] ?? -1;
  }
  for (const rack of build.racks) {
    if (!rack) continue;
    const i = rack.id;
    c.rack.alive[i] = 1; c.rack.opened[i] = rack.opened ? 1 : 0;
    c.rack.intent[i] = rack.online && c.room.intent[rack.room] === 1 ? 1 : 0;
    c.rack.room[i] = rack.room; c.rack.slot[i] = rack.slot;
    for (let s = 0; s < SERVERS_PER_RACK; s += 1) c.rack.servers[i * SERVERS_PER_RACK + s] = rack.servers[s] ?? -1;
  }
  for (const sys of build.systems) {
    if (!sys) continue;
    const i = sys.id;
    const room = c.rack.room[sys.rack]!;
    c.sys.alive[i] = 1; c.sys.kind[i] = sys.spec.kind === 'server' ? 0 : 1;
    c.sys.intent[i] = sys.online && c.rack.intent[sys.rack] === 1 ? 1 : 0;
    c.sys.rack[i] = sys.rack; c.sys.room[i] = room; c.sys.site[i] = c.room.site[room]!; c.sys.slot[i] = sys.slot;
  }
  c.global.exists[0] = build.global.scheduler ? 1 : 0;
}

/** Full compile: structural columns, then build/compile's values. Returns fresh buffers. */
export function compileAll(build: BuildState, research: ResearchState): CompiledBuffers {
  const compiled = allocCompiled(fleetSize(build));
  writeTopology(compiled, build);
  compileUnits(compiled, build, research);
  return compiled;
}

/** Grows hot unit tables (in place; caller owns `hot`) so every compiled row has a hot row. */
export function syncHotSizes(hot: HotBuffers, c: CompiledBuffers): void {
  ensureRows(SYS_HOT, hot.sys, c.sys.len);
  ensureRows(RACK_HOT, hot.rack, c.rack.len);
  ensureRows(ROOM_HOT, hot.room, c.room.len);
  ensureRows(SITE_HOT, hot.site, c.site.len);
  ensureRows(LINK_HOT, hot.link, c.link.len);
  syncRouterQueues(hot, c);
}
