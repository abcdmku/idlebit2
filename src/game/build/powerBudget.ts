import type { BuildState, CoolerBuild, SwitchBuild } from '../types/build';
import type { Unlocks } from '../types/state';
import { capacity, LADDERS, lossFraction, PARTS, partWatts, portWatts, ladderSpeed } from './catalog';
import { fullLoadWatts } from './configModel';
import { supplyLossW } from '../phys/supplies';

/** Installed hardware reserves its full load, even when switched off. */
export function systemRatedWatts(build: BuildState, system: number, u: Unlocks): number {
  const s = build.systems[system];
  if (!s) return 0;
  const rack = build.racks[s.rack];
  const live = rack?.servers.filter(id => id !== null && build.systems[id]);
  const port = live?.indexOf(s.id) ?? -1, k = rack?.switch.ports[port];
  return fullLoadWatts(s.spec, u) + (k === undefined ? 0 : LADDERS.switch.wPerUnit * ladderSpeed(k));
}

function coolerWatts(kind: 'rackCooler' | 'roomCooler', c: CoolerBuild): number {
  const w = partWatts(PARTS[kind], c.gen, c.level);
  // Reserve maximum supported lift, so setpoint changes cannot overdraw the rack.
  return (w.idle + w.load) * 1.6;
}
function switchWatts(kind: 'switch' | 'roomSwitch', sw: SwitchBuild): number {
  return [...sw.ports, ...sw.uplinks].reduce((sum, k) => {
    const w = portWatts(LADDERS[kind], sw.gen, k);
    return sum + w.idle + w.load;
  }, 0);
}

export function rackPowerBudget(build: BuildState, rack: number, u: Unlocks): { reserved: number; capacity: number } {
  const r = build.racks[rack];
  if (!r) return { reserved: 0, capacity: 0 };
  let reserved = r.servers.reduce<number>((sum, id) => sum + (id === null ? 0 : systemRatedWatts(build, id, u)), 0);
  // The starter rack already contains these parts. Reserve them before its view opens too,
  // so unlocking Rack cannot put an approved board build over capacity.
  const lb = partWatts(PARTS.lb, r.lb.gen, r.lb.level);
  reserved += coolerWatts('rackCooler', r.cooler) + lb.idle + lb.load + switchWatts('switch', r.switch);
  if (r.powerCtl) { const w = partWatts(PARTS.powerCtl, r.powerCtl.gen, r.powerCtl.level); reserved += w.idle + w.load; }
  const room = build.rooms[r.room];
  if (room?.opened) {
    const port = room.racks.filter(id => id !== null && build.racks[id]).indexOf(r.id), k = room.switch.ports[port];
    if (k !== undefined) { const w = portWatts(LADDERS.roomSwitch, room.switch.gen, k); reserved += w.idle + w.load; }
  }
  return { reserved, capacity: capacity(PARTS.pdu, r.pdu.gen, r.pdu.level) };
}

export function roomPowerBudget(build: BuildState, room: number, u: Unlocks): { reserved: number; capacity: number } {
  const m = build.rooms[room];
  if (!m) return { reserved: 0, capacity: 0 };
  let reserved = 0;
  for (const id of m.racks) {
    if (id === null || !build.racks[id]) continue;
    const r = build.racks[id]!, b = rackPowerBudget(build, id, u);
    reserved += b.reserved + (r.opened ? supplyLossW(b.reserved, b.capacity, lossFraction(PARTS.pdu, r.pdu.gen, r.pdu.level)) : 0);
  }
  if (m.opened) {
    const lb = partWatts(PARTS.roomLb, m.lb.gen, m.lb.level);
    // Room downlink ports are included in the rack links above, as in the runtime power phase.
    reserved += coolerWatts('roomCooler', m.cooler) + lb.idle + lb.load + switchWatts('roomSwitch', { ...m.switch, ports: [] });
    if (m.start) { const w = partWatts(PARTS.roomStart, m.start.gen, m.start.level); reserved += w.idle + w.load; }
    const site = build.sites[m.site];
    if (site?.opened) { const w = portWatts(LADDERS.dataPlane, site.dataPlane.gen, site.dataPlane.k); reserved += w.idle + w.load; }
  }
  return { reserved, capacity: m.ups.length ? m.ups.length * Math.min(...m.ups.map(x => capacity(PARTS.ups, x.gen, x.level))) : 0 };
}
