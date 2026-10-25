import type {
  BoardKind, CoolerBuild, PartLevel, RackBuild, RoomBuild, RouterBuild, SiteBuild, SupplyBuild, SwitchBuild, SystemBuild, SystemSpec,
} from '../types/build';
import type { RegionId } from '../types/catalog';
import type { RackId, RoomId, SiteId, SystemId } from '../types/ids';
import { BACKBONE, DATA_PLANE, ROOM_SWITCH, SWITCH } from '../build/catalog/network';
import { MAX_ZONES_PER_SITE, RACK_SLOTS_PER_ROW, SERVERS_PER_RACK, SETPOINT_DEFAULT_F } from './constants';

/**
 * Barebones units (spec §13.2) as plain build objects: the boot machine, the hidden containers and
 * the testkit fleets use them. Prices and PSU sizing are S5's (build/configs); these carry only shape.
 */
export const L1 = (gen: number): PartLevel => ({ gen, level: 1 });
const supply = (gen: number): SupplyBuild => ({ gen, level: 1, capped: false });
const cooler = (gen: number): CoolerBuild => ({ gen, level: 1, setpointF: SETPOINT_DEFAULT_F });
export const baseRouter = (gen = 0): RouterBuild => ({ gen, level: 1, strategy: 'firstFit', filters: [], placements: [], reserveOnRoute: false });
/**
 * Starter switches (D13): ports at the generation's default rung (rack gen 0: 1 kHz, k = 0), and
 * one uplink on the upstream device's default port: a rack on a gen 0 room network-rack port, a
 * room on a gen 0 data-plane port.
 */
export const rackSwitch = (gen = 0, ports = 4): SwitchBuild =>
  ({ gen, ports: Array(ports).fill(SWITCH.baseK[gen]!), uplinks: [ROOM_SWITCH.baseK[0]!], sameSpeed: false });
export const roomSwitch = (gen = 0, ports = 4): SwitchBuild =>
  ({ gen, ports: Array(ports).fill(ROOM_SWITCH.baseK[gen]!), uplinks: [DATA_PLANE.baseK[0]!], sameSpeed: false });

const BAREBONES_SPECS = new Map<string, SystemSpec>();

/** The shared spec of a barebones system of CPU tier `tier` (one spec object per tier and board). */
export function barebonesSpec(tier = 0, board: BoardKind = 'general'): SystemSpec {
  const key = `${tier}:${board}`;
  let spec = BAREBONES_SPECS.get(key);
  if (!spec) {
    spec = {
      kind: 'server', board, cpu: { cpu: L1(tier), cores: [L1(tier)], clock: L1(tier), l1: L1(tier), l2: null, l3: null }, cpuCount: 1,
      scheduler: null, ram: [], accels: [], drives: [], psu: supply(0), settings: { dvfs: false, turbo: false, cStateLimit: 0 },
    };
    BAREBONES_SPECS.set(key, spec);
  }
  return spec;
}

export const barebonesSystem = (id: SystemId, rack: RackId, slot: number, tier = 0): SystemBuild =>
  ({ id, rack, slot, online: true, spec: barebonesSpec(tier) });

export function barebonesRack(id: RackId, room: RoomId, slot: number, opened = true): RackBuild {
  return {
    id, room, slot, online: true, opened,
    servers: Array<SystemId | null>(SERVERS_PER_RACK).fill(null),
    cooler: cooler(0), pdu: supply(0), lb: baseRouter(), switch: rackSwitch(),
  };
}

export function barebonesRoom(id: RoomId, site: SiteId, zone: number, opened = true, rows = 2): RoomBuild {
  return {
    id, site, zone, online: true, opened, rows,
    racks: Array<RackId | null>(rows * RACK_SLOTS_PER_ROW).fill(null),
    switch: roomSwitch(), lb: baseRouter(), cooler: cooler(0), ups: [supply(0)],
  };
}

/** Data plane and backbone gen 0 start at their default rungs (spec A.3). */
export function barebonesSite(id: SiteId, region: RegionId, opened = true): SiteBuild {
  return {
    id, region, online: true, opened,
    zones: Array<RoomId | null>(MAX_ZONES_PER_SITE).fill(null),
    dataPlane: { gen: 0, k: DATA_PLANE.baseK[0]!, router: baseRouter() }, grid: supply(0),
    backbone: id === 0 ? null : { gen: 0, k: BACKBONE.baseK[0]! },
  };
}
