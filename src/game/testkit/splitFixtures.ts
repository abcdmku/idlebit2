import { advanceGameOwned } from '../core/advance';
import { TICK_MS } from '../core/constants';
import { baseRouter } from '../core/defaults';
import { primeMarket } from '../market/prime';
import type { PartLevel, RackBuild, RoomBuild, RouterBuild, SystemBuild, SystemSpec } from '../types/build';
import type { RackId, SystemId } from '../types/ids';
import type { GameState } from '../types/state';
import { buildState } from './builders';

/**
 * Mid-game split fixtures (D25): kHz-era servers on kHz links, so a split task's shards are seen
 * crossing the shared uplink in turn and fanning out over the ports, each for 0.25 s or more.
 * Real sim state, warmed by advancing and never dressed, so a live store can keep running it:
 * credits start at 2.5M and grow (energy stays well under what the links can carry in pay).
 * Test, harness and dev only.
 */

const lvl = (gen: number, level: number): PartLevel => ({ gen, level });

/**
 * A kHz-era general server at the native clock (2 kHz cores: higher clock levels on old cores cost
 * more energy than kHz links can earn), 4 cores, a scheduler, 2 RAM sticks, a drive and an entry GPU
 * for Accelerated tasks. RAM is sized so a shard queued at a rack always fits its servers.
 */
const MID_SPEC: SystemSpec = {
  kind: 'server', board: 'general',
  cpu: { cpu: lvl(1, 1), cores: Array.from({ length: 4 }, () => lvl(1, 1)), clock: lvl(1, 1), l1: lvl(1, 8), l2: lvl(1, 4), l3: null },
  cpuCount: 1,
  scheduler: { gen: 1, level: 4, strategy: 'fifo' },
  ram: [{ gen: 1, level: 8, ecc: false }, { gen: 1, level: 8, ecc: false }],
  accels: [{ kind: 'gpu', model: '1330', upgrades: 0 }],
  drives: [lvl(1, 2)],
  psu: { gen: 1, level: 8, capped: false },
  settings: { dvfs: false, turbo: false, cStateLimit: 0 },
};
const NO_GPU: SystemSpec = { ...MID_SPEC, accels: [] };
/** Every `gpuEvery`-th slot carries the GPU (1: all). */
const midSystem = (gpuEvery: number) => (id: SystemId, rack: RackId, slot: number): SystemBuild =>
  ({ id, rack, slot, online: true, spec: slot % gpuEvery === gpuEvery - 1 ? MID_SPEC : NO_GPU });

const router = (queueLevel: number): RouterBuild => ({ ...baseRouter(1), level: 3, filters: ['capability'], queueLevel });

/** Ports at rung `port` (1-2-5 ladder from 1 kHz: 2 = 5 kHz, 3 = 10 kHz, 5 = 50 kHz), one uplink at rung `uplink`. */
const midRack = (ports: number, port: number, uplink: number, queue: number) => (rack: RackBuild): RackBuild => ({
  ...rack,
  cooler: { gen: 1, level: 8, setpointF: 70 }, pdu: { gen: 1, level: 8, capped: false }, lb: router(queue),
  switch: { gen: 0, ports: Array(ports).fill(port), uplinks: [uplink], sameSpeed: true },
});
/** Starter room infrastructure: enough for kHz racks, and cheap (a gen 1 L10 cooler alone draws 1.5 MW). */
const midRoom = (racks: number, port: number, uplink: number, queue: number) => (room: RoomBuild): RoomBuild => ({
  ...room,
  cooler: { gen: 0, level: 1, setpointF: 70 }, ups: [{ gen: 0, level: 1, capped: false }], lb: router(queue),
  switch: { gen: 0, ports: Array(racks).fill(port), uplinks: [uplink], sameSpeed: true },
});

/** Market intensity where Parallel and Accelerated families are drawn and sized to split 4+ ways. */
export const SPLIT_INTENSITY = 16;
const WARM_TICKS = 120;

interface SplitShape {
  readonly zones: number; readonly racks: number; readonly servers: number; readonly gpuEvery: number;
  /** Ladder rungs: rack ports, rack uplink, room ports, room uplink. */
  readonly port: number; readonly uplink: number; readonly roomPort: number; readonly roomUplink: number;
  readonly rackQueue: number; readonly roomQueue: number;
}
function splitFleet(o: SplitShape): GameState {
  const built = buildState({
    seed: 42, sites: 1, zonesPerSite: o.zones, racksPerZone: o.racks, serversPerRack: o.servers, unlocks: 'max',
    credits: '2500000', data: '40000', system: midSystem(o.gpuEvery), rack: midRack(o.servers, o.port, o.uplink, o.rackQueue),
    room: midRoom(o.racks, o.roomPort, o.roomUplink, o.roomQueue),
    // The gen 0 data plane opens at rung 50 and draws megawatts; kHz zones run it at the room uplink's rung.
    site: (site) => ({ ...site, dataPlane: { ...site.dataPlane, k: o.roomUplink } }),
  });
  return advanceGameOwned(primeMarket(built, SPLIT_INTENSITY), WARM_TICKS * TICK_MS).state;
}

export const SPLIT_FLEETS = {
  /** One rack of 8 GPU servers: 5 kHz ports, one 50 kHz uplink, LB queue L3. Splits 8 ways. */
  rackSplit: (): GameState => splitFleet({
    zones: 1, racks: 1, servers: 8, gpuEvery: 1, port: 2, uplink: 5, roomPort: 5, roomUplink: 5, rackQueue: 3, roomQueue: 3,
  }),
  /**
   * One room of 4 racks × 4 servers (GPUs on odd slots): 5 kHz ports, 10 kHz rack links, and a
   * 50 kHz room uplink that carries every shard in turn (they wait at its mouth). LB queues L3, room L4.
   */
  roomSplit: (): GameState => splitFleet({
    zones: 1, racks: 4, servers: 4, gpuEvery: 2, port: 2, uplink: 3, roomPort: 3, roomUplink: 5, rackQueue: 3, roomQueue: 4,
  }),
  /** One site of 2 zones, each 2 racks × 4 servers: the roomSplit links, split across zones over the data plane. */
  globalSplit: (): GameState => splitFleet({
    zones: 2, racks: 2, servers: 4, gpuEvery: 2, port: 2, uplink: 3, roomPort: 3, roomUplink: 5, rackQueue: 3, roomQueue: 4,
  }),
} as const;
export type SplitFleetName = keyof typeof SPLIT_FLEETS;
