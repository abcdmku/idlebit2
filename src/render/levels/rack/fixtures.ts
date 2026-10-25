// Rack snapshots for the harness and tests, derived from the contract fixture. Port transfers
// advance with `timeMs` so packets move in the harness; nothing here runs the sim. The `slot`
// and `row` fields are R36's shape (open): the renderer reads them when present.
import { LEVEL_FIXTURES } from '../../../game/fixtures';
import { UNIT_MODES, familyId, rackId, systemId } from '../../../game';
import type { CoolTech, PortView, RackSlotView, RackSnapshot, ServerSlotView, UnitMode } from '../../../game';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type RackRowSnapshot = RackSnapshot & { readonly slot: number; readonly row: readonly RackSlotView[] };
const BASE = LEVEL_FIXTURES.rack;

export interface RackCase {
  id?: number; slot?: number; built?: readonly number[]; servers?: number; ports?: number; active?: readonly number[];
  uplink?: boolean; tempF?: number; crashed?: boolean; crashS?: number; dark?: boolean; tech?: CoolTech; gen?: number;
  modes?: Readonly<Record<number, UnitMode>>; cores?: number; usage?: number; overloadS?: number; lbTarget?: number | null;
}
const port = (peer: number | null, active: boolean, progress: number, rung: number): PortView => ({
  speedHz: [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6][Math.min(9, rung)], rung, peer, active, family: null, progress: active ? progress : 0, queued: 0,
});
function neighbour(id: number, servers: number, load: number, tempF: number): RackSlotView {
  const modes = new Uint8Array(12);
  for (let k = 0; k < servers; k++) modes[k] = UNIT_MODES.indexOf(k === 5 ? 'offline' : 'onMarket');
  return { rackId: rackId(id), state: 'onMarket', load, tempF, pduUsage: 0.2 + load * 0.5, servers: modes };
}
const EMPTY_SLOT: RackSlotView = { rackId: null, state: 'empty', load: 0, tempF: 0, pduUsage: 0, servers: new Uint8Array(12) };

/** A rack at room slot `slot` (row-major), with racks in `built` columns of its row. */
export function rackCase(o: RackCase, timeMs: number): RackRowSnapshot {
  const id = o.id ?? 0, slot = o.slot ?? 2, col = slot % 8, rowBase = slot - col, n = o.servers ?? 9, t = timeMs / 1000;
  const nPorts = o.ports ?? 12, active = new Set(o.active ?? [0, 3, 6]), crashed = !!o.crashed, dark = !!o.dark;
  const ports = Array.from({ length: nPorts }, (_, i) =>
    port(i < n ? i : null, i < n && active.has(i) && !dark && !crashed, (t * 0.6 + i * 0.29) % 1, Math.min(9, Math.floor(i / 2))));
  const servers: ServerSlotView[] = Array.from({ length: 12 }, (_, i) => {
    if (i >= n) return { ...BASE.servers[11], systemId: null, kind: null, state: 'empty', port: ports[i] ?? null, load: 0, running: 0, cores: 0, busyCores: 0 };
    const mode: UnitMode = o.modes?.[i] ?? (dark ? 'dark' : crashed ? 'crashed' : 'onMarket'), cores = o.cores ?? [1, 4, 8, 16, 32, 64][i % 6];
    const busy = mode === 'onMarket' ? Math.round(cores * ((i * 37) % 10) / 10) : 0;
    return {
      systemId: systemId(id * 12 + i), kind: i === 8 ? 'storageNode' : 'server', state: mode, load: cores ? busy / cores : 0,
      running: busy > 0 ? 1 + (i % 3) : 0, admitted: busy > 0 ? 2 : 0, reserved: 0,
      timerS: mode === 'boot' ? 6 : null, timerTotalS: mode === 'boot' ? 10 : null, cores, busyCores: busy, port: ports[i] ?? null,
      family: busy > 0 && i % 4 !== 3 ? familyId((i * 3) % 12) : null,
    };
  });
  const built = new Set(o.built ?? [0, 1, col, 3, 4, 6].map(c => c)); built.add(col);
  const row = Array.from({ length: 8 }, (_, c) =>
    c === col ? neighbour(id, n, 0.6, o.tempF ?? 72) : built.has(c) ? neighbour(100 + rowBase + c, 4 + ((c * 5) % 9), (c % 3) * 0.4, 68 + c * 3) : EMPTY_SLOT);
  const s: Mutable<RackRowSnapshot> = {
    ...BASE, rackId: rackId(id), online: dark ? 'dark' : crashed ? 'crashed' : 'onMarket',
    tempF: o.tempF ?? 72, eff: (o.tempF ?? 72) > 80 ? 0.86 : 1, crashed, crashS: o.crashS ?? 0,
    cooler: { ...BASE.cooler, tech: o.tech ?? 'air', generation: o.gen ?? 1, duty: o.tempF && o.tempF > 80 ? 1 : 0.55 },
    pdu: { ...BASE.pdu, usage: o.usage ?? 0.39, failed: dark, rebootMs: dark ? 6000 : null, overloadS: o.overloadS ?? 0 },
    lb: { ...BASE.lb, strategy: 'leastConn', lastTarget: o.lbTarget === undefined ? 3 : o.lbTarget },
    switch: { ...BASE.switch, generation: 1, ports, uplinks: [port(null, !!o.uplink && !dark, (t * 0.45) % 1, 6)] },
    servers, saveable: true, slot, row,
  };
  return s;
}

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
};
