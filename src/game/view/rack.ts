import { MAX_RACK_PORTS, MAX_UPLINKS, RACK_SLOTS_PER_ROW, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import { familyId, systemId, type FamilyId, type NodeRef, type RackId } from '../types/ids';
import type { RackSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';
import type { ServerSlotView, SwitchView } from '../types/views';
import { containerMode, coolerView, lbView, modeName, probeTimerS, rackProbe, rackSurroundF, siteEnergyPrice, supplyView, switchPorts, systemCoreActivity, systemLoad, systemTimerS, ticksToS } from './common';
import { rackFlows } from './flows';
import { rackSlot } from './room';
import { powerCtlView } from './power';
import { forEachRunning } from './tasks';

export { systemLoad } from './common';

/** Oldest take across all resource lists; task ID breaks ties in the same tick. */
function runningFamily(state: GameState, s: number): FamilyId | null {
  const rec = state.hot.rec;
  let oldest = -1;
  forEachRunning(state, s, (r) => {
    if (oldest < 0 || rec.taken[r]! < rec.taken[oldest]!
      || (rec.taken[r] === rec.taken[oldest] && rec.taskId[r]! < rec.taskId[oldest]!)) oldest = r;
  });
  return oldest < 0 ? null : familyId(rec.family[oldest]!);
}

/** Port p's peer: the server slot whose system is wired to it. */
function portPeers(state: GameState, rack: number): (number | null)[] {
  const peers: (number | null)[] = Array(MAX_RACK_PORTS).fill(null);
  const c = state.compiled;
  for (let slot = 0; slot < SERVERS_PER_RACK; slot += 1) {
    const s = c.rack.servers[rack * SERVERS_PER_RACK + slot] ?? -1;
    if (s < 0) continue;
    const p = c.sys.port[s] ?? -1;
    // Before compile wires ports (S5), port i serves server slot i.
    const at = p >= 0 ? p : slot;
    if (at < MAX_RACK_PORTS) peers[at] = slot;
  }
  return peers;
}

export function rackSwitch(state: GameState, rack: number): SwitchView {
  const b = state.build.racks[rack]!;
  const c = state.compiled.rack;
  const { ports, uplinks, topHz } = switchPorts(state.compiled, state.hot, b.switch, c.portLink, c.uplinkLink,
    rack * MAX_RACK_PORTS, rack * MAX_UPLINKS, portPeers(state, rack));
  return { generation: b.switch.gen, topHz, sameSpeed: b.switch.sameSpeed, portCeiling: state.research.unlocks.ceilings.rackPorts, ports, uplinks };
}

function serverSlot(state: GameState, rack: number, slot: number, sw: SwitchView): ServerSlotView {
  const s = state.compiled.rack.servers[rack * SERVERS_PER_RACK + slot] ?? -1;
  if (s < 0 || state.compiled.sys.alive[s] !== 1) {
    return { systemId: null, kind: null, state: 'empty', onMarket: false, load: 0, running: 0, family: null, admitted: 0, reserved: 0, timerS: null, timerTotalS: null, cores: 0, busyCores: 0, port: null };
  }
  const h = state.hot.sys;
  const running = h.running[s] ?? 0;
  const p = state.compiled.sys.port[s] ?? -1;
  const port = sw.ports[p >= 0 ? p : slot] ?? null;
  const timerS = systemTimerS(state.hot, s);
  return {
    systemId: systemId(s), kind: (state.compiled.sys.kind[s] ?? 0) === 1 ? 'storageNode' : 'server', onMarket: state.compiled.sys.intent[s] === 1,
    state: modeName(h.mode[s]), load: systemLoad(state, s), running, admitted: running + (h.queueLen[s] ?? 0),
    family: runningFamily(state, s),
    ...systemCoreActivity(state, s),
    reserved: h.reserved[s] ?? 0, timerS, timerTotalS: timerS === null ? null : ticksToS(state.research.unlocks.bootTicks), port,
  };
}

export function rackSnapshot(state: GameState, id: RackId, parent: NodeRef | null): RackSnapshot {
  const b = state.build.racks[id]!;
  const c = state.compiled.rack, h = state.hot.rack;
  const crashed = (h.crashed[id] ?? 0) === 1, failed = (h.pduFailed[id] ?? 0) === 1;
  const sw = rackSwitch(state, id);
  const probe = rackProbe(state, id);
  const servers: ServerSlotView[] = [];
  for (let slot = 0; slot < SERVERS_PER_RACK; slot += 1) servers.push(serverSlot(state, id, slot, sw));
  const roomBase = (c.room[id] ?? b.room) * RACKS_PER_ROOM;
  let slot = 0;
  for (let i = 0; i < RACKS_PER_ROOM; i += 1) {
    if (state.compiled.room.racks[roomBase + i] === id) { slot = i; break; }
  }
  const rowBase = roomBase + Math.floor(slot / RACK_SLOTS_PER_ROW) * RACK_SLOTS_PER_ROW;
  const row = Array.from({ length: RACK_SLOTS_PER_ROW }, (_, column) =>
    rackSlot(state, state.compiled.room.racks[rowBase + column] ?? -1));
  return {
    level: 'rack', parent, rackId: id, slot, row, online: containerMode(state, c.alive[id], c.intent[id], failed, crashed, probe),
    timerS: probeTimerS(state, probe),
    tempF: h.tempF[id] ?? 70, eff: h.eff[id] ?? 1, crashS: ticksToS(h.crashTicks[id] ?? 0), crashed,
    throttled: (h.throttled[id] ?? 0) === 1,
    cooler: coolerView(c, h, id, b.cooler, rackSurroundF(state, id)),
    pdu: supplyView('pdu', b.pdu, {
      capacityW: c.pduCapW[id] ?? 0, usage: h.pduUsage[id] ?? 0, overTicks: h.pduOverTicks[id] ?? 0, failed,
      rebootTicks: h.pduRebootTicks[id] ?? 0, loss: c.pduLoss[id] ?? 0, capSwitch: (c.pduCapSwitch[id] ?? 0) === 1 && b.pdu.capped, capFactor: 1,
    }, siteEnergyPrice(state, state.compiled.room.site[c.room[id] ?? 0] ?? 0)),
    lb: lbView(state, b.lb, { kind: 0, id, strategy: c.lbStrategy[id] ?? 0, filters: c.lbFilters[id] ?? 0, routed: h.lbRouted[id] ?? 0, last: h.lbLast[id] ?? -1 }),
    switch: sw, powerCtl: powerCtlView(state, id), servers,
    saveable: state.research.unlocks.rules.includes('configSave'),
    flows: rackFlows(state, id),
  };
}
