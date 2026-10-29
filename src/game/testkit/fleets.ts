import { createInitialState } from '../core/state';
import { advanceGameOwned } from '../core/advance';
import { cloneCompiled, cloneHot } from '../core/buffers';
import { TICK_MS } from '../core/constants';
import { primeMarket } from '../market/prime';
import { LADDERS } from '../build/catalog';
import type { PartLevel, RackBuild, RoomBuild, SiteBuild, SystemBuild, SystemSpec } from '../types/build';
import type { RackId, SystemId } from '../types/ids';
import type { GameState } from '../types/state';
import { buildState, type FleetSpec } from './builders';
import { provisionInfrastructure } from './infrastructure';

/**
 * Synthetic stress fixtures (architecture §7.2), never earned campaign progress. Seed 42.
 * CPU/RAM retain their profiles; GPU slots use maximum catalog cards with synthetic infra headroom.
 * Top-hardware fleets open at the late-game intensity such hardware earns under the offset round
 * start (D12.1), so tasks are sized for the fleet; fleetMax then warms 600 ticks.
 */
const lvl = (gen: number, level: number): PartLevel => ({ gen, level });
const flowTop = (g: number) => lvl(g, 11 + g);

const core = lvl(3, 4);
/** Shared by every top server, as a copied or config-built fleet shares its spec (R20). */
const TOP_SPEC: SystemSpec = {
  kind: 'server', board: 'accelerator',
  cpu: { cpu: lvl(3, 1), cores: Array.from({ length: 32 }, () => core), clock: flowTop(3), cache: flowTop(3), },
  cpuCount: 2,
  scheduler: { gen: 3, level: 11, strategy: 'mlfq' },
  ram: Array.from({ length: 8 }, () => ({ gen: 5, level: 20, speedLevel: 20, ecc: true })),
  accels: Array.from({ length: 8 }, () => ({ kind: 'gpu' as const, model: '9990' as const })),
  drives: Array.from({ length: 4 }, () => ({ ...flowTop(3), speedLevel: 14 })),
  psu: { gen: 5, level: 16, capped: false },
    settings: { dvfs: true, turbo: true, cStateLimit: 1 },
};

/** Synthetic maximum population: existing GHz CPUs, 8 ECC DDR5, 8 G9990 cards, 4 drives. */
export const topSystem = (id: SystemId, rack: RackId, slot: number): SystemBuild => ({ id, rack, slot, online: true, spec: TOP_SPEC });

const topRouter = { gen: 2, level: 13, strategy: 'leastWork', filters: ['capability', 'health'], queueLevel: 32 } as const;

const TOP_RACK_PARTS: Pick<RackBuild, 'cooler' | 'pdu' | 'lb' | 'switch'> = {
  cooler: { gen: 3, level: 14, setpointF: 60 }, pdu: { gen: 2, level: 13, capped: false },
  lb: { ...topRouter, filters: [...topRouter.filters] },
  switch: { gen: 6, ports: Array(12).fill(21), uplinks: Array(4).fill(21), sameSpeed: true },
};
export const topRack = (rack: RackBuild): RackBuild => ({ ...rack, ...TOP_RACK_PARTS });
export const topRoom = (room: RoomBuild): RoomBuild => ({
  ...room,
  cooler: { gen: 5, level: 16, setpointF: 60 }, ups: [{ gen: 2, level: 13, capped: false }, { gen: 2, level: 13, capped: false }],
  lb: { ...topRouter, filters: [...topRouter.filters] },
  switch: { gen: 6, ports: Array(24).fill(21), uplinks: Array(4).fill(21), sameSpeed: true },
});
export const topSite = (site: SiteBuild): SiteBuild => ({
  ...site,
  dataPlane: { gen: 2, k: 24, router: { ...topRouter, filters: ['capability', 'health', 'thermal'] } },
  grid: { gen: 2, level: 13, capped: false },
  backbone: site.id === 0 ? null : { gen: 3, k: 24 },
});

export const MAX_FLEET: FleetSpec = {
  seed: 42, sites: 8, zonesPerSite: 3, racksPerZone: 24, serversPerRack: 12, unlocks: 'max',
  system: topSystem, rack: topRack, room: topRoom, site: topSite,
  global: { scheduler: { ...topRouter, gen: 0, level: 11, strategy: 'latency', filters: ['region', 'capability', 'health'] }, start: null },
};

/**
 * Informational stress fleet (not a budget): MAX_FLEET with every link at its newest generation's
 * top rung, so uplinks carry what their ports can. Opened near the intensity a 6,912-server split
 * fleet sustains (D25.10: about +1 I per doubling).
 */
const TOP_K = { rack: LADDERS.switch.topK[6]!, room: LADDERS.roomSwitch.topK[6]!, dataPlane: LADDERS.dataPlane.topK[2]!, backbone: LADDERS.backbone.topK[3]! } as const;
export const MAX_LINK_FLEET: FleetSpec = {
  ...MAX_FLEET,
  rack: (rack) => ({ ...topRack(rack), switch: { gen: 6, ports: Array(12).fill(TOP_K.rack), uplinks: Array(4).fill(TOP_K.rack), sameSpeed: true } }),
  room: (room) => ({ ...topRoom(room), switch: { gen: 6, ports: Array(24).fill(TOP_K.room), uplinks: Array(4).fill(TOP_K.room), sameSpeed: true } }),
  site: (site) => {
    const top = topSite(site);
    return { ...top, dataPlane: { ...top.dataPlane, k: TOP_K.dataPlane }, backbone: top.backbone ? { gen: 3, k: TOP_K.backbone } : null };
  },
};
export const LINK_FLEET_INTENSITY = 42;

/**
 * Opening intensities sized for each fixture's top hardware, as the offset start gives a player who
 * owns it (D12.1, docs/tasks.md §12): every head is runnable and takes are bounded by real work.
 */
export const FLEET_MARKET_INTENSITY = 40;
export const RACK_MARKET_INTENSITY = 30;
export const FLEET_WARMUP_TICKS = 600;

/**
 * The warmed fleetMax is built once per process (600 ticks of real work under D10) and handed out
 * with its own hot and compiled buffers, so a caller may advance it in place or edit columns.
 */
let warmFleetMax: GameState | null = null;
const fresh = (s: GameState): GameState => ({ ...s, hot: cloneHot(s.hot), compiled: cloneCompiled(s.compiled) });

export const FLEETS = {
  boot: (): GameState => createInitialState(42),
  rackFull: (): GameState => primeMarket(buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 12, unlocks: 'max', system: topSystem, rack: topRack }), RACK_MARKET_INTENSITY),
  roomFull: (): GameState => primeMarket(buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 24, serversPerRack: 12, unlocks: 'max', system: topSystem, rack: topRack, room: topRoom }), RACK_MARKET_INTENSITY),
  fleetMax: (): GameState => fresh(warmFleetMax ??= advanceGameOwned(
    primeMarket(provisionInfrastructure(buildState(MAX_FLEET)), FLEET_MARKET_INTENSITY), FLEET_WARMUP_TICKS * TICK_MS,
  ).state),
  /** MAX_LINK_FLEET from a cold start (informational stress case; no warm-up). */
  fleetMaxLinks: (): GameState => primeMarket(provisionInfrastructure(buildState(MAX_LINK_FLEET)), LINK_FLEET_INTENSITY),
  /** Undersized PDUs and coolers, so supplies cycle and racks crash. */
  fleetMaxHot: (): GameState => primeMarket(buildState({
    ...MAX_FLEET,
    rack: (rack) => ({ ...topRack(rack), cooler: { gen: 0, level: 1, setpointF: 70 }, pdu: { gen: 0, level: 1, capped: false } }),
  }), FLEET_MARKET_INTENSITY), } as const;
export type FleetName = keyof typeof FLEETS;
