// Rack snapshots for the harness and tests, derived from the contract fixture. Port transfers
// advance with `timeMs` so packets move in the harness; nothing here runs the sim. `slot` and
// `row` follow R36 (RackSnapshot).
import { LEVEL_FIXTURES } from '../../../game/fixtures';
import { UNIT_MODES, familyId, rackId, systemId } from '../../../game';
import type { CoolTech, LbView, PortView, RackSlotView, RackSnapshot, ServerSlotView, UnitMode, StartCtlView } from '../../../game';
import { FAM, flowAt, queueOf } from './flowFixtures';
import type { FlowCase } from './flowFixtures';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type RackRowSnapshot = RackSnapshot & { readonly slot: number; readonly row: readonly RackSlotView[] };
const BASE = LEVEL_FIXTURES.rack;

export interface RackCase {
  id?: number; slot?: number; built?: readonly number[]; servers?: number; ports?: number; active?: readonly number[];
  uplink?: boolean; tempF?: number; crashed?: boolean; crashS?: number; dark?: boolean; tech?: CoolTech; gen?: number;
  modes?: Readonly<Record<number, UnitMode>>; cores?: number; usage?: number; overloadS?: number; lbTarget?: number | null;
  /** D25: shard flows (server slot → system in `to`) and the LB queue. */
  flows?: readonly FlowCase[]; queue?: LbView['queue'];
  /** Between rounds: every sled rests 'paused'; the slots in `out` sit out the next round (off market). */
  between?: boolean; out?: readonly number[];
  /** D31: Power control installed (battery charge share, seconds left, awake systems); the rest of the sleds sleep. */
  power?: { gen?: number; charge: number; secondsLeft: number | null; awake: number };
}
/** D31: a start controller view (rack, room or global). */
export function startView(awake: number, total: number, generation = 0, order: StartCtlView['order'] = 'slot'): StartCtlView {
  return { generation, level: 2, startWith: 1, headWaitS: 2, busyPct: generation >= 1 ? 75 : null, order, awake, total, nextWakeInMs: awake < total ? 600 : null };
}
const port = (peer: number | null, active: boolean, progress: number, rung: number): PortView => ({
  speedHz: [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6][Math.min(9, rung)], rung, peer, active, family: null, progress: active ? progress : 0, queued: 0,
});
function neighbour(id: number, servers: number, load: number, tempF: number, between = false, out: ReadonlySet<number> = new Set()): RackSlotView {
  const modes = new Uint8Array(12), market = new Uint8Array(12);
  for (let k = 0; k < servers; k++) {
    modes[k] = UNIT_MODES.indexOf(between ? 'paused' : k === 5 ? 'offline' : 'onMarket');
    market[k] = out.has(k) || (!between && k === 5) ? 0 : 1;
  }
  return { rackId: rackId(id), state: between ? 'paused' : 'onMarket', load: between ? 0 : load, tempF, pduUsage: 0.2 + load * 0.5, servers: modes, serversOnMarket: market, powered: true, wakeMs: null };
}
const EMPTY_SLOT: RackSlotView = { rackId: null, state: 'empty', load: 0, tempF: 0, pduUsage: 0, servers: new Uint8Array(12), serversOnMarket: new Uint8Array(12), powered: false, wakeMs: null };

/** A rack at room slot `slot` (row-major), with racks in `built` columns of its row. */
export function rackCase(o: RackCase, timeMs: number): RackRowSnapshot {
  const id = o.id ?? 0, slot = o.slot ?? 2, col = slot % 8, rowBase = slot - col, n = o.servers ?? 9, t = timeMs / 1000;
  const nPorts = o.ports ?? 12, active = new Set(o.between ? [] : o.active ?? [0, 3, 6]), crashed = !!o.crashed, dark = !!o.dark;
  const between = !!o.between, out = new Set(o.out ?? []), pw = o.power;
  const ports = Array.from({ length: nPorts }, (_, i) =>
    port(i < n ? i : null, i < n && active.has(i) && !dark && !crashed, (t * 0.6 + i * 0.29) % 1, Math.min(9, Math.floor(i / 2))));
  const servers: ServerSlotView[] = Array.from({ length: 12 }, (_, i) => {
    if (i >= n) return { ...BASE.servers[11], systemId: null, kind: null, state: 'empty', onMarket: false, port: ports[i] ?? null, load: 0, running: 0, cores: 0, busyCores: 0 };
    const mode: UnitMode = o.modes?.[i] ?? (dark ? 'dark' : crashed ? 'crashed' : between ? 'paused' : pw && i >= pw.awake ? 'asleep' : 'onMarket'), cores = o.cores ?? [1, 4, 8, 16, 32, 64][i % 6];
    const busy = mode === 'onMarket' ? Math.round(cores * ((i * 37) % 10) / 10) : 0;
    return {
      systemId: systemId(id * 12 + i), kind: i === 8 ? 'storageNode' : 'server', state: mode, onMarket: !out.has(i) && mode !== 'offline' && mode !== 'goingOffline', load: cores ? busy / cores : 0,
      running: busy > 0 ? 1 + (i % 3) : 0, admitted: busy > 0 ? 2 : 0, reserved: 0,
      timerS: mode === 'boot' ? 6 : null, timerTotalS: mode === 'boot' ? 10 : null, cores, busyCores: busy, port: ports[i] ?? null,
      family: busy > 0 && i % 4 !== 3 ? familyId((i * 3) % 12) : null,
    };
  });
  const built = new Set(o.built ?? [0, 1, col, 3, 4, 6].map(c => c)); built.add(col);
  const row = Array.from({ length: 8 }, (_, c) =>
    c === col ? neighbour(id, n, 0.6, o.tempF ?? 72, between, out)
      : built.has(c) ? neighbour(100 + rowBase + c, 4 + ((c * 5) % 9), (c % 3) * 0.4, 68 + c * 3, between, between && c % 2 ? new Set([1, 2]) : new Set()) : EMPTY_SLOT);
  const s: Mutable<RackRowSnapshot> = {
    ...BASE, rackId: rackId(id), online: dark ? 'dark' : crashed ? 'crashed' : between ? 'paused' : 'onMarket',
    tempF: o.tempF ?? 72, eff: (o.tempF ?? 72) > 80 ? 0.86 : 1, crashed, crashS: o.crashS ?? 0,
    cooler: { ...BASE.cooler, tech: o.tech ?? 'air', generation: o.gen ?? 1, duty: o.tempF && o.tempF > 80 ? 1 : 0.55 },
    pdu: { ...BASE.pdu, usage: o.usage ?? 0.39, failed: dark, rebootMs: dark ? 6000 : null, overloadS: o.overloadS ?? 0 },
    lb: { ...BASE.lb, strategy: 'leastConn', lastTarget: o.lbTarget === undefined ? 3 : o.lbTarget, queue: o.queue ?? BASE.lb.queue },
    flows: (o.flows ?? []).map(f => flowAt(f, timeMs)),
    switch: { ...BASE.switch, generation: 1, ports, uplinks: [port(null, !!o.uplink && !dark, (t * 0.45) % 1, 6)] },
    servers, saveable: true, slot, row,
    powerCtl: pw ? {
      generation: pw.gen ?? 0, level: 2,
      battery: { capacityJ: 120_000, chargeJ: 120_000 * pw.charge, secondsLeft: pw.secondsLeft, discharging: pw.charge > 0 && !between },
      start: startView(pw.awake, n, pw.gen ?? 0, 'fastest'),
    } : null,
  };
  return s;
}

const sys = (slot: number, id = 0): FlowCase['to'] => ({ level: 'system', id: systemId(id * 12 + slot) });
/** A 6-shard Parallel task mid-split: two shards on ports, one crossing the uplink, three waiting;
 * a 2-shard Memory task on two ports; a short Compute shard landing. */
export const SPLIT_FLOWS: readonly FlowCase[] = [
  { task: 41, family: FAM.parallel, shard: 0, shards: 6, link: 'server', to: sys(0), phase: 0.6 },
  { task: 41, family: FAM.parallel, shard: 1, shards: 6, link: 'server', to: sys(3), phase: 0.3 },
  { task: 41, family: FAM.parallel, shard: 2, shards: 6, link: 'uplink', to: sys(5), phase: 0.45 },
  { task: 41, family: FAM.parallel, shard: 3, shards: 6, link: 'uplink', to: sys(6), state: 'waiting' },
  { task: 41, family: FAM.parallel, shard: 4, shards: 6, link: 'uplink', to: sys(7), state: 'waiting' },
  { task: 42, family: FAM.memory, shard: 0, shards: 2, link: 'uplink', to: sys(1), state: 'waiting' },
  { task: 43, family: FAM.accel, shard: 0, shards: 2, link: 'server', to: sys(9), phase: 0.2 },
  { task: 43, family: FAM.accel, shard: 1, shards: 2, link: 'server', to: sys(10), phase: 0.75 },
  { task: 44, family: FAM.compute, shard: 0, shards: 1, link: 'server', to: sys(2), state: 'landing' },
];
export const CASES: Readonly<Record<string, (timeMs: number) => RackRowSnapshot>> = {
  overview: t => rackCase({ uplink: true }, t),
  first: t => rackCase({ slot: 0, built: [0, 1, 2], uplink: true }, t),
  last: t => rackCase({ slot: 7, built: [4, 5, 6, 7] }, t),
  alone: t => rackCase({ slot: 0, built: [0], servers: 3, ports: 4 }, t),
  full: t => rackCase({ servers: 12, built: [0, 1, 2, 3, 4, 5, 6, 7], active: [0, 1, 2, 5, 9, 11], uplink: true }, t),
  hot: t => rackCase({ tempF: 94, crashS: 4, usage: 0.95, overloadS: 3 }, t),
  crash: t => rackCase({ tempF: 103, crashed: true }, t),
  dark: t => rackCase({ dark: true }, t),
  water: t => rackCase({ tech: 'water', gen: 2, tempF: 66 }, t),
  noport: t => rackCase({ servers: 10, ports: 8, modes: { 2: 'boot', 4: 'offline' } }, t),
  paused: t => rackCase({}, t),
  /** D31: Power control on battery (BAT 4:12), 4 of 12 systems awake, the rest asleep. */
  power: t => rackCase({ servers: 12, power: { gen: 1, charge: 0.7, secondsLeft: 252, awake: 4 } }, t),
  /** D31: the battery is empty (GRID); 9 of 11 awake. */
  grid: t => rackCase({ servers: 11, power: { charge: 0, secondsLeft: 0, awake: 9 } }, t),
  /** Between rounds: slots 2, 5 and 9 sit out the next round (On market off); the rest are ready. Use with ?paused. */
  sitout: t => rackCase({ servers: 12, between: true, out: [2, 5, 9] }, t),
  flows: t => rackCase({ servers: 12, active: [0, 2, 3, 9, 10], uplink: true, flows: SPLIT_FLOWS, queue: queueOf(8, [FAM.storage, FAM.parallel, FAM.cluster]) }, t),
  queue1: t => rackCase({ queue: queueOf(1, [FAM.memory]) }, t),
  queue32: t => rackCase({ servers: 12, queue: queueOf(32, Array.from({ length: 21 }, (_, i) => [FAM.compute, FAM.parallel, FAM.memory, FAM.accel][i % 4])) }, t),
};
