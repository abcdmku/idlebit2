// Room snapshots for the harness and tests, derived from the contract fixture. Port transfers
// advance with `timeMs` so packets move in the harness; nothing here runs the sim.
import { LEVEL_FIXTURES } from '../../../game/fixtures';
import { FAM, flowAt, queueOf } from '../rack/flowFixtures';
import type { FlowCase } from '../rack/flowFixtures';
import { UNIT_MODES, rackId, roomId } from '../../../game';
import type { CoolTech, LbView, PortView, RackSlotView, RoomSnapshot, SupplyView, UnitMode } from '../../../game';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const BASE = LEVEL_FIXTURES.room;
const mode = (m: UnitMode): number => UNIT_MODES.indexOf(m);

export interface RoomCase {
  rows?: number; built?: readonly number[]; zone?: number; zones?: readonly (number | null)[]; tempF?: number; tech?: CoolTech;
  gen?: number; duty?: number; crashed?: boolean; crashS?: number; dark?: boolean; upsGen?: number; upsUsage?: number;
  overloadS?: number; active?: readonly number[]; uplink?: boolean; rackTempF?: number; strategy?: RoomSnapshot['network']['lb']['strategy'];
  routed?: number; servers?: number; id?: number;
  /** D25: shard flows (`to` = the rack of a room slot) and the LB queue. */
  flows?: readonly FlowCase[]; queue?: LbView['queue'];
}
const supply = (u: SupplyView, o: RoomCase): SupplyView => ({
  ...u, generation: o.upsGen ?? 1, level: 2, usage: o.upsUsage ?? 0.27, deliveredW: u.capacityW * (o.upsUsage ?? 0.27),
  failed: !!o.dark, overloadS: o.overloadS ?? 0, rebootMs: o.dark ? 6000 : null,
});
const port = (peer: number | null, active: boolean, progress: number): PortView => ({
  speedHz: 1e6, rung: 9, peer, active, family: null, progress: active ? progress : 0, queued: 0,
});

/** A room with racks in `built` slots (row-major), loads and transfers at `timeMs`. */
export function roomCase(o: RoomCase, timeMs: number): RoomSnapshot {
  const rows = o.rows ?? 2, built = new Set(o.built ?? [0, 1, 2, 3, 8, 9]), crashed = !!o.crashed;
  const racks: RackSlotView[] = Array.from({ length: rows * 8 }, (_, i) => {
    const on = built.has(i), n = on ? Math.max(1, (o.servers ?? 12) - (i % 5)) : 0, servers = new Uint8Array(12);
    for (let k = 0; k < n; k++) servers[k] = mode(o.dark ? 'dark' : crashed ? 'crashed' : 'onMarket');
    return {
      rackId: on ? rackId(i) : null, state: !on ? 'empty' : o.dark ? 'dark' : crashed ? 'crashed' : 'onMarket',
      load: on ? Math.max(0.1, 0.9 - (i % 8) * 0.12) : 0, tempF: on ? (o.rackTempF ?? (o.tempF ?? 75) + 4) : 70, pduUsage: on ? 0.5 : 0, servers,
    };
  });
  const active = new Set(o.active ?? [0, 2]), t = timeMs / 1000;
  const ports = Array.from({ length: Math.max(4, built.size + 2) }, (_, i) => {
    const slot = [...built][i] ?? null;
    return port(slot, slot !== null && active.has(i) && !o.dark && !crashed, (t * 0.7 + i * 0.37) % 1);
  });
  const s: Mutable<RoomSnapshot> = {
    ...BASE, roomId: roomId(o.id ?? (o.zone ?? 0)), zone: o.zone ?? 0,
    zones: (o.zones ?? [0, null, null]).map(z => (z === null ? null : roomId(z))),
    online: o.dark ? 'dark' : crashed ? 'crashed' : 'onMarket', tempF: o.tempF ?? 75, crashed, crashS: o.crashS ?? (crashed ? 10 : 0),
    cooler: { ...BASE.cooler, tech: o.tech ?? 'air', generation: o.gen ?? 0, duty: o.duty ?? 0.6 },
    ups: [supply(BASE.ups[0], o)],
    network: {
      switch: { ...BASE.network.switch, generation: 1, ports, uplinks: [port(null, !!o.uplink, (t * 0.4) % 1)] },
      lb: { ...BASE.network.lb, strategy: o.strategy ?? 'leastConn', routedPerSec: o.routed ?? 4, queue: o.queue ?? BASE.network.lb.queue },
    },
    flows: (o.flows ?? []).map(f => flowAt(f, timeMs)),
    rows, maxRows: 3, racks,
  };
  return s;
}

const rack = (slot: number): FlowCase['to'] => ({ level: 'rack', id: rackId(slot) });
/** A 6-shard Parallel task: three shards on rack uplinks in two rows, one on the zone link, two waiting;
 * a Distributed task waiting behind it; an unsplit Compute task on its rack's uplink. */
export const SPLIT_FLOWS: readonly FlowCase[] = [
  { task: 51, family: FAM.parallel, shard: 0, shards: 6, link: 'rack', to: rack(0), phase: 0.7 },
  { task: 51, family: FAM.parallel, shard: 1, shards: 6, link: 'rack', to: rack(2), phase: 0.5 },
  { task: 51, family: FAM.parallel, shard: 2, shards: 6, link: 'rack', to: rack(9), phase: 0.3 },
  { task: 51, family: FAM.parallel, shard: 3, shards: 6, link: 'zone', to: rack(3), phase: 0.4 },
  { task: 51, family: FAM.parallel, shard: 4, shards: 6, link: 'zone', to: rack(8), state: 'waiting' },
  { task: 51, family: FAM.parallel, shard: 5, shards: 6, link: 'zone', to: rack(1), state: 'waiting' },
  { task: 52, family: FAM.cluster, shard: 0, shards: 2, link: 'zone', to: rack(1), state: 'waiting' },
  { task: 53, family: FAM.compute, shard: 0, shards: 1, link: 'rack', to: rack(3), phase: 0.15 },
];
const ALL24 = Array.from({ length: 24 }, (_, i) => i);
export const CASES: Readonly<Record<string, (timeMs: number) => RoomSnapshot>> = {
  overview: t => roomCase({}, t),
  full: t => roomCase({ rows: 3, built: ALL24, zones: [0, 1, 2], active: [0, 3, 7, 11, 15, 19, 23], uplink: true, upsGen: 2, gen: 1, routed: 120 }, t),
  hot: t => roomCase({ tempF: 94, crashS: 4, rackTempF: 98, duty: 1, upsUsage: 0.95, overloadS: 3 }, t),
  crash: t => roomCase({ tempF: 103, crashed: true, duty: 1 }, t),
  dark: t => roomCase({ dark: true }, t),
  chilled: t => roomCase({ rows: 3, built: [0, 1, 2, 3, 4, 5, 8, 9, 10, 16], tech: 'water', tempF: 65, zones: [0, 1, null], strategy: 'leastWork' }, t),
  closedloop: t => roomCase({ rows: 3, built: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], tech: 'closedLoop', tempF: 65,
    zone: 1, zones: [0, 1, 2], upsGen: 2, uplink: true }, t),
  azB: t => roomCase({ zone: 1, zones: [0, 1, null], built: [0, 1, 2] }, t),
  empty: t => roomCase({ built: [] }, t),
  paused: t => roomCase({}, t),
  flows: t => roomCase({ active: [0, 1, 2, 3, 4], uplink: true, flows: SPLIT_FLOWS, queue: queueOf(8, [FAM.memory, FAM.cluster, FAM.parallel]) }, t),
  queue32: t => roomCase({ rows: 3, built: ALL24, queue: queueOf(32, Array.from({ length: 27 }, (_, i) => [FAM.cluster, FAM.parallel, FAM.accel][i % 3])) }, t),
};
