import { viewW } from '../core/constants';
import type { BuildState } from '../types/build';
import type { LockReason, OverSupply } from '../types/quotes';
import type { GameState } from '../types/state';
import { researchId } from '../types/ids';
import { rackPowerBudget, roomPowerBudget } from './powerBudget';

/** Hard installation limits. Reducing an excessive reservation remains possible. */
export function overSupply(state: GameState, after: BuildState): OverSupply | null {
  const before = state.build, u = state.research.unlocks;
  const racks = new Set<number>(), rooms = new Set<number>();
  for (let s = 0; s < after.systems.length; s += 1) {
    const a = after.systems[s];
    if (a && a !== before.systems[s]) racks.add(a.rack);
  }
  for (let r = 0; r < after.racks.length; r += 1) if (after.racks[r] && after.racks[r] !== before.racks[r]) racks.add(r);
  for (let m = 0; m < after.rooms.length; m += 1) {
    const room = after.rooms[m];
    if (!room || room === before.rooms[m]) continue;
    rooms.add(m);
    // Room port changes also change the watts carried by each rack's uplink.
    for (const r of room.racks) if (r !== null) racks.add(r);
  }
  for (let s = 0; s < after.sites.length; s += 1) {
    const site = after.sites[s];
    if (site && site !== before.sites[s]) for (const m of site.zones) if (m !== null) rooms.add(m);
  }
  for (const r of racks) {
    const rack = after.racks[r];
    if (!rack) continue;
    rooms.add(rack.room);
    const a = rackPowerBudget(after, r, u), b = rackPowerBudget(before, r, u);
    if (a.reserved > a.capacity && (a.reserved > b.reserved + 1e-6 || a.capacity < b.capacity)) {
      return { part: 'pdu', rack: rack.id, room: rack.room, capW: viewW(a.capacity), afterW: viewW(a.reserved) };
    }
  }
  for (const m of rooms) {
    const room = after.rooms[m];
    if (!room?.opened) continue;
    const a = roomPowerBudget(after, m, u), b = roomPowerBudget(before, m, u);
    if (a.reserved > a.capacity && (a.reserved > b.reserved + 1e-6 || a.capacity < b.capacity)) {
      return { part: 'ups', room: room.id, capW: viewW(a.capacity), afterW: viewW(a.reserved) };
    }
  }
  return null;
}

export function powerLock(state: GameState, over: OverSupply): LockReason {
  const starter = over.part === 'pdu' && !state.research.unlocks.levels.rack;
  return { code: 'power', node: starter ? researchId('rack') : null,
    text: starter ? 'Power limit · unlock Rack' : 'Power limit · upgrade ' + (over.part === 'ups' ? 'UPS' : 'Rack PDU') };
}
