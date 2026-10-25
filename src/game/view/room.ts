import { MAX_ROOM_PORTS, MAX_UPLINKS, MAX_UPS, RACK_SLOTS_PER_ROW, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import { MODE } from '../core/timers';
import { rackId, roomId, siteId, type NodeRef, type RoomId } from '../types/ids';
import type { RoomSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';
import type { RackSlotView, SupplyView } from '../types/views';
import { roomFlows } from './flows';
import { containerMode, coolerView, lbView, outsideF, probeTimerS, rackProbe, roomProbe, siteEnergyPrice, supplyView, switchPorts, systemLoad, ticksToS } from './common';

/** One rack in a room grid slot: mode, load, °F, PDU usage and its 12 server mode codes. */
export function rackSlot(state: GameState, rack: number): RackSlotView {
  const c = state.compiled.rack, h = state.hot.rack;
  const servers = new Uint8Array(SERVERS_PER_RACK);
  if (rack < 0 || c.alive[rack] !== 1) return { rackId: null, state: 'empty', load: 0, tempF: 0, pduUsage: 0, servers };
  let load = 0, n = 0;
  for (let slot = 0; slot < SERVERS_PER_RACK; slot += 1) {
    const s = c.servers[rack * SERVERS_PER_RACK + slot] ?? -1;
    if (s < 0 || state.compiled.sys.alive[s] !== 1) continue;
    servers[slot] = state.hot.sys.mode[s] ?? MODE.empty;
    load += systemLoad(state, s);
    n += 1;
  }
  const failed = (h.pduFailed[rack] ?? 0) === 1;
  return {
    rackId: rackId(rack), state: containerMode(state, c.alive[rack], c.intent[rack], failed, (h.crashed[rack] ?? 0) === 1, rackProbe(state, rack)),
    load: n > 0 ? load / n : 0, tempF: h.tempF[rack] ?? 70, pduUsage: failed ? 0 : (h.pduUsage[rack] ?? 0), servers,
  };
}

export function roomUps(state: GameState, room: number): SupplyView[] {
  const b = state.build.rooms[room]!;
  const c = state.compiled.room, h = state.hot.room;
  return b.ups.map((part, u) => {
    const i = room * MAX_UPS + u;
    const failed = (h.upsFailed[i] ?? 0) === 1;
    return supplyView('ups', part, {
      capacityW: c.upsCapW[i] ?? 0, usage: h.upsUsage[i] ?? 0, overTicks: h.upsOverTicks[i] ?? 0, failed,
      rebootTicks: h.upsRebootTicks[i] ?? 0, loss: c.upsLoss[i] ?? 0, capSwitch: part.capped, capFactor: 1,
    }, siteEnergyPrice(state, c.site[room] ?? 0));
  });
}

/** True when every UPS of the zone has failed: the zone is dark. */
export const roomDark = (state: GameState, room: number): boolean => {
  const n = state.compiled.room.upsCount[room] || (state.build.rooms[room]?.ups.length ?? 0);
  for (let u = 0; u < n; u += 1) if ((state.hot.room.upsFailed[room * MAX_UPS + u] ?? 0) === 0) return false;
  return n > 0;
};

export function roomSnapshot(state: GameState, id: RoomId, parent: NodeRef | null): RoomSnapshot {
  const b = state.build.rooms[id]!;
  const c = state.compiled.room, h = state.hot.room;
  const site = c.site[id] ?? 0;
  const out = outsideF(state, site);
  const crashed = (h.crashed[id] ?? 0) === 1;
  const probe = roomProbe(state, id);
  const rows = b.rows;
  const racks: RackSlotView[] = [];
  for (let i = 0; i < rows * RACK_SLOTS_PER_ROW; i += 1) racks.push(rackSlot(state, c.racks[id * RACKS_PER_ROOM + i] ?? -1));
  // Room port p serves the rack in room slot p (R25).
  const peers = Array.from({ length: MAX_ROOM_PORTS }, (_, p) => ((c.racks[id * RACKS_PER_ROOM + p] ?? -1) >= 0 ? p : null));
  const { ports, uplinks, topHz } = switchPorts(state.compiled, state.hot, b.switch, c.portLink, c.uplinkLink, id * MAX_ROOM_PORTS, id * MAX_UPLINKS, peers);
  const siteBuild = state.build.sites[site];
  return {
    level: 'room', parent, roomId: id, siteId: siteId(site), zone: b.zone,
    zones: (siteBuild?.zones ?? [id]).map((z) => (z === null ? null : roomId(z))),
    online: containerMode(state, c.alive[id], c.intent[id], roomDark(state, id), crashed, probe),
    timerS: probeTimerS(state, probe),
    tempF: h.tempF[id] ?? 70, outsideF: out, crashS: ticksToS(h.crashTicks[id] ?? 0), crashed,
    cooler: coolerView(c, h, id, b.cooler, out),
    ups: roomUps(state, id),
    network: {
      switch: { generation: b.switch.gen, topHz, sameSpeed: b.switch.sameSpeed, portCeiling: state.research.unlocks.ceilings.roomPorts, ports, uplinks },
      lb: lbView(state, b.lb, { kind: 1, id, strategy: c.lbStrategy[id] ?? 0, filters: c.lbFilters[id] ?? 0, routed: h.lbRouted[id] ?? 0, last: h.lbLast[id] ?? -1 }),
    },
    rows, maxRows: state.research.unlocks.ceilings.roomRows, racks,
    saveable: state.research.unlocks.rules.includes('configSave'),
    flows: roomFlows(state, id),
  };
}
