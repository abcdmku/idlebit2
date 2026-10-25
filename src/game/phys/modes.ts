import { MAX_UPS, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import { MODE, restingMode, setUnitMode } from '../core/timers';
import type { World } from '../core/world';
import { physSettings } from './settings';

/**
 * Dark and crashed (spec §4.3) are derived from supply and lump state. Phys sets them through
 * core's setUnitMode and restores the §4.3 resting mode once nothing holds the system down.
 */

/** Every UPS of the zone has failed, or its grid is down and no battery carries it. */
export function zoneDark(w: World, room: number): boolean {
  const h = w.hot;
  const count = w.compiled.room.opened[room] === 1 ? Math.min(MAX_UPS, physSettings(w).upsCount[room]!) : 0;
  if (count > 0) {
    let failed = 0;
    for (let i = 0; i < count; i += 1) failed += h.room.upsFailed[room * MAX_UPS + i]!;
    if (failed >= count) return true;
  }
  const site = w.compiled.room.site[room]!;
  return h.site.gridFailed[site] === 1 && h.room.rideTicks[room] === 0;
}

/** Its PSU is rebooting, or an ancestor supply is down (spec §9.4). */
export function systemDark(w: World, sys: number): boolean {
  if (w.hot.sys.psuRebootTicks[sys]! > 0) return true;
  if (w.hot.rack.pduFailed[w.compiled.sys.rack[sys]!] === 1) return true;
  return zoneDark(w, w.compiled.sys.room[sys]!);
}

export const systemCrashed = (w: World, sys: number): boolean =>
  w.hot.rack.crashed[w.compiled.sys.rack[sys]!] === 1 || w.hot.room.crashed[w.compiled.sys.room[sys]!] === 1;

/** Puts one system in the mode its supplies and lumps dictate; returns true when it is held down. */
export function syncMode(w: World, sys: number): boolean {
  const mode = w.hot.sys.mode[sys]!;
  if (mode === MODE.empty) return true;
  const want = systemDark(w, sys) ? MODE.dark : systemCrashed(w, sys) ? MODE.crashed : -1;
  if (want >= 0) {
    if (mode !== want) setUnitMode(w, sys, want);
    return true;
  }
  if (mode === MODE.dark || mode === MODE.crashed) setUnitMode(w, sys, restingMode(w, sys));
  return false;
}

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

export const syncRack = (w: World, rack: number): void => forRackSystems(w, rack, (s) => { syncMode(w, s); });
export const syncRoom = (w: World, room: number): void => forRoomRacks(w, room, (r) => syncRack(w, r));
export const syncSite = (w: World, site: number): void => forSiteRooms(w, site, (m) => syncRoom(w, m));
