import { advanceGameOwned } from '../core/advance';
import { TICK_MS } from '../core/constants';
import { baseRouter } from '../core/defaults';
import { primeMarket } from '../market/prime';
import type { PartLevel, RackBuild, RouterBuild, SystemBuild, SystemSpec } from '../types/build';
import type { RackId, SystemId } from '../types/ids';
import type { GameState } from '../types/state';
import { buildState } from './builders';

/**
 * D26 fixtures: real sim state, warmed by advancing and never dressed, so a live store can keep
 * running it. `spillSystem`: small RAM and an SSD, data-heavy work whose working sets spill onto disk.
 * `spillRack`: a Rack-era rack of ECC servers, half with an NVMe drive, taking windowed Rack-scale
 * tasks (D26.5) through an LB queue. Test, harness and dev only.
 */

const lvl = (gen: number, level: number): PartLevel => ({ gen, level });
const router = (queueLevel: number): RouterBuild => ({ ...baseRouter(1), level: 3, filters: ['capability'], queueLevel });
const rack = (ports: number, port: number, uplink: number, queue: number) => (r: RackBuild): RackBuild => ({
  ...r,
  // Rear-door water: native MHz servers under the CSV energy ratio put out several GW.
  cooler: { gen: 2, level: 1, setpointF: 70 }, pdu: { gen: 1, level: 8, capped: false }, lb: router(queue),
  switch: { gen: 0, ports: Array(ports).fill(port), uplinks: [uplink], sameSpeed: true }, });

/**
 * A kHz server with 1 kbit of levelOne, one 1 kbit DDR stick and an SSD: a Data-heavy task's working set
 * (8–16 bits a unit) sits mostly on the drive, so its memory traffic runs at disk speed.
 */
const SMALL_RAM: SystemSpec = {
  kind: 'server', board: 'general',
  cpu: { cpu: lvl(1, 1), cores: Array.from({ length: 4 }, () => lvl(1, 1)), clock: lvl(1, 1), cache: lvl(1, 1), },
  cpuCount: 1,
  scheduler: { gen: 1, level: 4, strategy: 'fifo' },
  ram: [{ gen: 1, level: 4, ecc: false }],
  accels: [],
  drives: [lvl(1, 1)],
  psu: { gen: 1, level: 8, capped: false },
  settings: { dvfs: false, turbo: false, cStateLimit: 0 },
};
/** Data-heavy (storage band) families are in the mix and a task is about 16k units. */
const SPILL_INTENSITY = 17.5;

/**
 * ECC servers with DDR2 (162 kbit/s a stick at L5): even slots hold 16 Mbit of RAM and no drive; odd slots
 * 4 Mbit and an SSD at 1/16 of RAM speed. Rack-scale tasks (about 8M units at I 27) split over the rack;
 * the small-RAM shards overflow onto their SSDs. Every server holds a shard of an 8-way split, so a
 * capability-filtered split never waits on a box it can't use.
 */
const ECC_SPEC: SystemSpec = {
  kind: 'server', board: 'general',
  cpu: { cpu: lvl(2, 1), cores: Array.from({ length: 4 }, () => lvl(2, 1)), clock: lvl(2, 1), cache: lvl(2, 1), },
  cpuCount: 1,
  scheduler: { gen: 2, level: 4, strategy: 'fifo' },
  ram: [{ gen: 2, level: 5, ecc: true }, { gen: 2, level: 5, ecc: true }],
  accels: [],
  drives: [],
  // Four native MHz cores draw about 5.3e8 W under the CSV energy ratio (hardware-progression.md §3).
  psu: { gen: 3, level: 11, capped: false },
  settings: { dvfs: false, turbo: false, cStateLimit: 0 }, };
const ECC_DRIVE: SystemSpec = { ...ECC_SPEC, ram: [{ gen: 2, level: 2, ecc: true }, { gen: 2, level: 2, ecc: true }], drives: [lvl(1, 4)] };
/** Rack-scale families (D26.5 windows) are in the mix. */
const WINDOW_INTENSITY = 27;

const one = (spec: SystemSpec) => (id: SystemId, r: RackId, slot: number): SystemBuild => ({ id, rack: r, slot, online: true, spec });
const alternate = (id: SystemId, r: RackId, slot: number): SystemBuild => ({ id, rack: r, slot, online: true, spec: slot % 2 === 1 ? ECC_DRIVE : ECC_SPEC });

function warm(state: GameState, intensity: number, ticks: number): GameState {
  return advanceGameOwned(primeMarket(state, intensity), ticks * TICK_MS).state;
}

/** The spill rack before its warm-up (debugging and fixtures that warm differently). */
export const spillRackCold = (): GameState => buildState({
  seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 8, unlocks: 'max', credits: '1000000000000000', data: '40000',
  system: alternate, rack: rack(8, 12, 15, 4), });
export const SPILL_WINDOW_INTENSITY = 27;

export const SPILL_FLEETS = {
  /** Two small-RAM servers in an opened rack (fast ports), focus on system 0. */
  spillSystem: (): GameState => warm(buildState({
    seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 2, unlocks: 'max', credits: '5000000000', data: '40000',
    system: one(SMALL_RAM), rack: rack(2, 9, 12, 2), }), SPILL_INTENSITY, 300),
  /** Eight ECC servers, an SSD on odd slots, 10 MHz ports and a 100 MHz uplink; LB queue L4. */
  spillRack: (): GameState => warm(spillRackCold(), WINDOW_INTENSITY, 300), } as const;
export type SpillFleetName = keyof typeof SPILL_FLEETS;
