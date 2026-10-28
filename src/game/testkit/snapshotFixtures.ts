import { taskRequirements } from '../view/taskRequirements';
import { RACK_SLOTS_PER_ROW, REGIONS } from '../core/constants';
import { familyId, rackId, roomId, siteId, systemId, type LevelId } from '../types/ids';
import type { ChipSnapshot, LevelSnapshot } from '../types/snapshot';
import type { CoolerView, LbView, PortView, RackSlotView, SupplyView, SwitchView, TaskView } from '../types/views';

/**
 * One hand-written snapshot per level. They exist so the contract compiles for every level and
 * renderers have a shape to draw before S6's testkit-derived fixtures (view/fixtures.ts) land.
 */
const supply = (kind: SupplyView['kind'], capacityW: number, deliveredW: number): SupplyView => ({
  kind, generation: 0, level: 1, capacityW, deliveredW, usage: deliveredW / capacityW, overloadS: 0, failed: false,
  rebootMs: null, loss: 0.3, lossW: deliveredW * 0.3, capped: false, capFactor: 1, creditsPerMinute: deliveredW * 1.3 * 60 * 0.01,
});
const port = (peer: number | null, active: boolean): PortView => ({ speedHz: 1000, rung: 0, peer, active, family: active ? familyId(0) : null, progress: active ? 0.5 : 0, queued: 0 });
const sw = (ports: number): SwitchView => ({
  generation: 0, topHz: 10_000, sameSpeed: false, portCeiling: ports,
  ports: Array.from({ length: ports }, (_, i) => port(i, i === 0)), uplinks: [port(null, false)],
});
const lb: LbView = {
  generation: 0, level: 1, strategy: 'firstFit', filters: [], queue: { slots: 1, level: 1, entries: [] },
  routedPerSec: 1, misroutesThisRound: 0, lastTarget: 0,
};
const cooler: CoolerView = { tech: 'air', generation: 0, level: 1, duty: 1, setpointF: null, watts: 2, capacityW: 16, equilibriumF: 72 };
const task: TaskView = { ...taskRequirements(familyId(0), 1), taskId: 1, shard: 0, shards: 1, units: 1, threads: 1, key: 1, family: familyId(0), count: 1, stage: 0, resource: 'compute', progress: 0.25,
  placement: { cache: 1, ram: 0, disk: 0 }, memTier: null, windowEndTick: null,
  gpuCoresMin: 0, vramBits: 0, accelDomain: null };

const CHIP: ChipSnapshot = {
    level: 'chip', socket: 0, parent: { level: 'system', id: systemId(0) }, systemId: systemId(0), online: 'onMarket', tier: 0, cpuCount: 1,
    clock: { hz: 1, effectiveHz: 1, generation: 0, level: 1 }, coreSites: 1,
    cores: [{ socket: 0, generation: 0, level: 1, busy: 1, taskId: 1, family: 0, activity: 'compute', progress: 0.25, threads: 1, shard: 0, shardThreads: 1, research: 0, cstate: 0, hz: 1, sleep: null, rate: 1 }],
    cache: { generation: 0, level: 1, usedBits: 1, loadedBits: 1, capacityBits: 1, spilledOutBits: 0 },
    scheduler: null, queue: [], researchShare: 0, pipe: { speed: 1000, transfer: null, waiting: false }, psu: supply('psu', 4, 0.4), slots: [{ kind: 'core', index: 1, locked: true }],
};

const ROOM_RACKS: readonly RackSlotView[] = Array.from({ length: 16 }, (_, i) => ({
  rackId: i === 0 ? rackId(0) : null, state: i === 0 ? 'onMarket' : 'empty', load: i === 0 ? 0.5 : 0,
  tempF: 72, pduUsage: i === 0 ? 0.2 : 0, servers: new Uint8Array(12),
}));

export const LEVEL_FIXTURES: { readonly [L in LevelId]: Extract<LevelSnapshot, { level: L }> } = {
  chip: CHIP,
  system: {
    level: 'system', parent: { level: 'rack', id: rackId(0) }, systemId: systemId(0), kind: 'server', board: 'general', cpuCount: 1, ramSlots: 1, etaCfg: 1,
    online: 'onMarket', timerS: null, timerTotalS: null, chip: CHIP, chips: [CHIP], cpuBusy: [1],
    cpu: { slot: 0, kind: 'cpu', generation: 0, level: 1, active: true, resourceBusy: 1 },
    ram: [], gpu: [], storage: [], psu: supply('psu', 4, 0.4),
    running: [task], queue: { cap: 0, count: 0, sample: [] }, reserved: 0,
    rates: { ops: 1, ramBits: 0, gpuOps: 0, ioBits: 0 }, capacities: { cache: 1, ram: 0, vram: 0, storage: 0 },
    used: { memory: 1, vram: 0, storage: 0 },
    memory: { tiers: [
      { tier: 'cache', capacityBits: 1, usedBits: 1, spilledBits: 0, rateBits: null },
      { tier: 'ram', capacityBits: 0, usedBits: 0, spilledBits: 0, rateBits: 0 },
      { tier: 'disk', capacityBits: 0, usedBits: 0, spilledBits: 0, rateBits: 0 },
    ] }, drawW: 0.4, saveable: false, slots: [{ kind: 'ram', index: 0, locked: true }], inbound: null,
  },
  rack: {
    level: 'rack', parent: { level: 'room', id: roomId(0) }, rackId: rackId(0), online: 'onMarket', timerS: null, tempF: 72, eff: 1, crashS: 0, crashed: false, throttled: false,
    slot: 0, row: ROOM_RACKS.slice(0, RACK_SLOTS_PER_ROW),
    cooler, pdu: supply('pdu', 64, 12), lb, switch: sw(4),
    servers: Array.from({ length: 12 }, (_, i) => ({
      systemId: i === 0 ? systemId(0) : null, kind: i === 0 ? ('server' as const) : null, state: i === 0 ? ('onMarket' as const) : ('empty' as const),
      load: i === 0 ? 1 : 0, running: i === 0 ? 1 : 0, family: i === 0 ? task.family : null, admitted: i === 0 ? 1 : 0, reserved: 0, timerS: null, timerTotalS: null, cores: i === 0 ? 1 : 0, busyCores: i === 0 ? 1 : 0, port: i < 4 ? port(i, i === 0) : null,
    })),
    saveable: true, flows: [], },
  room: {
    level: 'room', parent: { level: 'global', id: 0 }, roomId: roomId(0), siteId: siteId(0), zone: 0, zones: [roomId(0), null, null],
    online: 'onMarket', timerS: null,
    tempF: 71, outsideF: 70, crashS: 0, crashed: false, cooler: { ...cooler, capacityW: 256 }, ups: [supply('ups', 1024, 80)],
    network: { switch: sw(4), lb }, rows: 2, maxRows: 2,
    racks: ROOM_RACKS,
    saveable: true, flows: [],
  },
  global: {
    level: 'global', regionsOpen: 1, gateway: 'us-east', scheduler: null, backbone: { links: [] }, flows: [],
    sites: REGIONS.map((region, i) => ({
      siteId: i === 0 ? siteId(0) : null, region: region.id, open: i === 0, online: i === 0 ? ('onMarket' as const) : ('empty' as const),
      zones: i === 0 ? [{ roomId: roomId(0), zone: 0, state: 'onMarket' as const, tempF: 71, load: 0.5, upsUsage: 0.08 }] : [],
      grid: i === 0 ? supply('grid', 262_144, 100) : null,
      dataPlane: i === 0 ? { generation: 0, bitsPerSec: 1e6, latencyMs: 200, active: false } : null,
      energyPrice: region.energyPrice, outsideF: region.outsideF, hottestF: i === 0 ? 72 : region.outsideF, timerS: null,
    })), }, };
