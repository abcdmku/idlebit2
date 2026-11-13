import { MAX_ZONES_PER_SITE, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import type { World } from '../core/world';

/* Child iteration over the compiled topology, in slot order. */

export function forRackSystems(w: World, rack: number, fn: (sys: number) => void): void {
  const servers = w.compiled.rack.servers;
  for (let i = 0; i < SERVERS_PER_RACK; i += 1) {
    const s = servers[rack * SERVERS_PER_RACK + i]!;
    if (s >= 0) fn(s);
  }
}
export function forRoomRacks(w: World, room: number, fn: (rack: number) => void): void {
  const racks = w.compiled.room.racks;
  for (let i = 0; i < RACKS_PER_ROOM; i += 1) {
    const r = racks[room * RACKS_PER_ROOM + i]!;
    if (r >= 0) fn(r);
  }
}
export function forSiteRooms(w: World, site: number, fn: (room: number) => void): void {
  const zones = w.compiled.site.zones;
  for (let i = 0; i < MAX_ZONES_PER_SITE; i += 1) {
    const m = zones[site * MAX_ZONES_PER_SITE + i]!;
    if (m >= 0) fn(m);
  }
}
