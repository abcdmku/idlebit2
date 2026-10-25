// Preview and test scenes that match the approved mockup's level stages and
// profiles. Hand-built snapshots; no sim code runs. Dev and tests only.
// 'shard' (D25): a shard on the port, a 2-thread Parallel shard on cores 1 and 2, and an
// Accelerated shard in its GPU stage on card 1 (its thread held on core 4).
import { FAMILIES, familyId, systemId } from '../../../game';
import type { ChipSnapshot, CoreView, FamilyDef, GpuStats, PartRef, PartView, Quote, SupplyView, SystemSnapshot, TaskRequirementsView, TaskView,
  TransferView } from '../../../game';

const ID = systemId(0), PARENT = { level: 'system', id: ID } as const;
interface Run { readonly taskId: number; readonly family: number; readonly shard: number; readonly threads: number }
const core = (lanes: number, busy: boolean, progress: number, research = 0, run: Run | null = null): CoreView => ({
  socket: 0, lanes, generation: 0, level: lanes, busy: busy ? 1 : 0, family: busy ? run?.family ?? 0 : null, taskId: busy ? run?.taskId ?? 380 + lanes : null,
  progress, threads: 1, research, cstate: 0, shard: busy ? run?.shard ?? 0 : null, shardThreads: busy ? run?.threads ?? 1 : 0, rate: lanes * 1024, hz: 1024, sleep: null,
});
const PARALLEL: Run = { taskId: 700, family: 13, shard: 1, threads: 2 }, ACCEL: Run = { taskId: 701, family: 22, shard: 0, threads: 1 };
export function chipScene(stage: 'boot' | 'chip' | 'system' | 'shard', online: ChipSnapshot['online'] = 'onMarket'): ChipSnapshot {
  if (stage === 'boot') return {
    level: 'chip', parent: null, systemId: ID, cpuCount: 1, online, tier: 0, psu: psu(0.65), clock: { hz: 1, effectiveHz: 1, generation: 0, level: 1 }, coreSites: 1,
    cores: [core(1, false, 0, 0.36)], cache: { levels: [{ kind: 'l1', bits: 1, generation: 0, level: 1 }], usedBits: 0, capacityBits: 1, spilledOutBits: 0 },
    scheduler: null, queue: [], researchShare: 0.36, pipe: { speed: 1000, transfer: null, waiting: false }, slots: [{ kind: 'core', index: 1, locked: true }, { kind: 'scheduler', index: 0, locked: true }],
  };
  const sys = stage !== 'chip', shard = stage === 'shard';
  const cores = shard ? [core(3, true, 0.3, 0, PARALLEL), core(3, true, 0.3, 0, PARALLEL), core(2, false, 0, 0.4), core(2, true, 0.6, 0, ACCEL)]
    : sys ? [core(3, true, 0.3), core(3, true, 0.6), core(2, false, 0, 0.4), core(2, true, 0.2)] : [core(2, false, 0, 0.51), core(1, false, 0, 0.51)];
  return {
    level: 'chip', parent: sys ? PARENT : null, systemId: ID, cpuCount: 1, online, tier: 0, psu: psu(5.5),
    clock: { hz: sys ? 8 : 4, effectiveHz: sys ? 8 : 4, generation: 0, level: sys ? 4 : 3 }, coreSites: sys ? 4 : 2, cores,
    cache: { levels: [{ kind: 'l1', bits: sys ? 64 : 8, generation: 0, level: sys ? 7 : 4 }], usedBits: sys ? 32 : 0, capacityBits: sys ? 64 : 8, spilledOutBits: 0 },
    scheduler: { generation: 0, level: sys ? 3 : 2, strategy: 'fifo', q: sys ? 8 : 4, queued: sys ? 3 : 0, k: sys ? 4 : 2, running: sys ? 3 : 0, reserved: 0 },
    queue: sys ? [{ taskId: 390, family: familyId(1) }, { taskId: 391, family: familyId(2) }, { taskId: 392, family: familyId(0) }] : [],
    researchShare: 0.5, pipe: { speed: 1000, transfer: null, waiting: false }, slots: sys ? [] : [{ kind: 'core', index: 2, locked: true }],
  };
}

const part = (kind: PartView['kind'], slot: number, level: number, active: boolean): PartView => ({ slot, kind, generation: 0, level, active, resourceBusy: active ? 1 : 0,
  ...(kind === 'ram' ? { capacityBits: 8192 * 2 ** (level - 1), rateBits: 1000 * level } : kind === 'drive' ? { capacityBits: 131072 * level, rateBits: 4 * level } : {}) });
/** Explicit native catalog row, not a second simulation or inferred model. */
export const GPU_SCENE_STATS: GpuStats = {
  model: '1330', generation: 1, series: 3, tier: 30, upgrades: 0, cores: 4, vramBits: 8192,
  clockHz: 1000, opsPerS: 4000, tensorOpsPerS: 4000, idleW: 200, loadW: 2000,
  efficiencyOpsPerJ: 4000 / 2200, maxUpgrades: 5,
};
const gpu = (slot: number, active: boolean, held = active ? 2048 : 0): PartView => ({ ...part('gpu', slot, 1, active), gpu: GPU_SCENE_STATS, vramUsedBits: held });
const psu = (deliveredW: number): SupplyView => ({
  kind: 'psu', generation: 0, level: 1, capacityW: 64, deliveredW, usage: deliveredW / 64, overloadS: 0, failed: false, rebootMs: null,
  loss: 0.3, lossW: deliveredW * 0.3, capped: false, capFactor: 1, creditsPerMinute: 0,
});
/** Freeze catalog facts at a chosen size (units) for hand-built scenes. */
export function sceneTaskRequirements(family: FamilyDef, size: number): TaskRequirementsView {
  return {
    family: family.id, label: family.name,
    stages: family.stages.map(s => ({ resource: s.resource, work: s.work.fixed + s.work.perSize * size })),
    grain: family.grain, size, workingSetBits: family.workingSet.fixed + family.workingSet.perSize * size,
    gpuCoresMin: family.gpuCoresMin, vramBits: family.vramBits.fixed + family.vramBits.perSize * size,
    deadline: null,
    members: family.members, minZones: family.minZones, region: family.region.kind === 'in' ? family.region.region : null,
    ecc: family.ecc, tensor: family.tensor,
  };
}
const byKey = (key: string): FamilyDef => FAMILIES.find(f => f.key === key)!;
/** One running shard: its requirements, stage, progress and the D25 shard fields. */
export function sceneTask(key: string, size: number, o: Partial<TaskView> & Pick<TaskView, 'resource' | 'progress'>): TaskView {
  return { ...sceneTaskRequirements(byKey(key), size), key: 1, count: 1, stage: 1, accelDomain: null, placement: { cache: 0, ram: 0, disk: 0 }, memTier: null, windowEndTick: null,
    taskId: 1, shard: 0, shards: 1, units: size, threads: 1, ...o };
}
/** A shard transfer on the system's port (all D25 fields). */
export function sceneInbound(o: Partial<TransferView> = {}): TransferView {
  return { taskId: 702, family: familyId(13), systemId: ID, link: 'server', bitsSent: 2600, bits: 6144, speed: 4096,
    shard: 3, shards: 4, units: 1024, from: null, to: { level: 'system', id: ID }, key: 9, ...o };
}

export type SystemStage = 'boot' | 'system' | 'full' | 'shard' | 'spill';
function runningOf(stage: SystemStage): TaskView[] {
  switch (stage) {
    case 'boot': return [];
    case 'full': return [
      sceneTask('thumbnail', 2048, { key: 1, resource: 'mem', progress: 0.45, accelDomain: 0 }),
      sceneTask('imageBlur', 2048, { key: 2, taskId: 2, resource: 'gpu', progress: 0.85, accelDomain: 6 }),
    ];
    case 'shard': return [
      sceneTask('hashBatch', 1024, { key: 1, taskId: PARALLEL.taskId, shard: 1, shards: 4, threads: 2, stage: 0, resource: 'compute', progress: 0.3 }),
      sceneTask('imageBlur', 512, { key: 2, taskId: ACCEL.taskId, shard: 0, shards: 2, resource: 'gpu', progress: 0.6, accelDomain: 0 }),
    ];
    // D26: a data-heavy shard grinding on disk (its current `mem` part reads the drive).
    case 'spill': return [sceneTask('mergeSort', 4096, { resource: 'mem', progress: 0.2, memTier: 'disk', placement: { cache: 64, ram: 32_768, disk: 24_576 } })];
    default: return [sceneTask('mergeSort', 16, { resource: 'mem', progress: 0.45 })];
  }
}
export function systemScene(stage: SystemStage, online: SystemSnapshot['online'] = 'onMarket'): SystemSnapshot {
  const s = baseScene(stage, online);
  if (stage !== 'spill') return s;
  // D26 tiers: RAM full of spilled cache overflow, the drive 60% used, all of it spilled.
  let ram = 0, disk = 0;
  for (const p of s.ram) ram += p.capacityBits ?? 0;
  for (const p of s.storage) disk += p.capacityBits ?? 0;
  const memory: SystemSnapshot['memory'] = { tiers: [
    { tier: 'cache', capacityBits: 64, usedBits: 64, spilledBits: 0, rateBits: null },
    { tier: 'ram', capacityBits: ram, usedBits: ram, spilledBits: ram, rateBits: 4096 },
    { tier: 'disk', capacityBits: disk, usedBits: Math.round(disk * 0.6), spilledBits: Math.round(disk * 0.6), rateBits: 2 },
  ] };
  return { ...s, memory, chip: { ...s.chip, cache: { ...s.chip.cache, spilledOutBits: ram + Math.round(disk * 0.6) } } };
}
function baseScene(stage: SystemStage, online: SystemSnapshot['online']): SystemSnapshot {
  const boot = stage === 'boot', full = stage === 'full', shard = stage === 'shard';
  return {
    level: 'system', parent: null, systemId: ID, kind: 'server', board: full ? 'accelerator' : 'general', cpuCount: 1,
    ramSlots: full ? 8 : boot ? 1 : 4, etaCfg: 1, chip: chipScene(boot ? 'boot' : shard ? 'shard' : 'system', online), cpuBusy: [boot ? 0 : 0.75],
    online, timerS: online === 'boot' ? 6 : null, timerTotalS: online === 'boot' ? 10 : null,
    cpu: part('cpu', 0, 1, true),
    ram: boot ? [] : full ? [0, 1, 2, 3, 4, 5].map(i => part('ram', i, 2, i < 2)) : [part('ram', 0, 2, !shard), part('ram', 1, 2, !shard)],
    gpu: boot ? [] : full ? Array.from({ length: 8 }, (_, i) => gpu(i, i === 6, i === 0 || i === 6 ? 2048 : 0)) : [gpu(0, shard)],
    storage: boot ? [] : full ? [0, 1, 2, 3].map(i => part('drive', i, 3, i === 1)) : [part('drive', 0, 1, false)],
    psu: psu(boot ? 0.65 : 5.5),
    running: runningOf(stage),
    inbound: shard ? sceneInbound() : null,
    memory: { tiers: [] }, queue: { cap: 8, count: 3, sample: [] }, reserved: 0, rates: { ops: 8, ramBits: 4, gpuOps: 0, ioBits: 0 },
    capacities: { cache: 64, ram: 256, vram: 0, storage: 0 }, used: { memory: 32, vram: 0, storage: 0 }, drawW: 5.5, saveable: !boot,
    slots: boot ? [{ kind: 'ram', index: 0, locked: true }, { kind: 'drive', index: 0, locked: true }, { kind: 'gpu', index: 0, locked: true }]
      : full ? [] : [{ kind: 'ram', index: 2, locked: true }, { kind: 'gpu', index: 1, locked: true }, { kind: 'drive', index: 1, locked: true }],
  };
}

/** A tray quote that upgrades a chip block or board part. */
export function upgradeQuote(slot: PartRef['slot'], affordable: boolean): Quote {
  return {
    action: { type: 'upgradePart', part: { unit: { kind: 'system', id: ID }, slot } }, label: 'Upgrade', cost: '10' as Quote['cost'], currency: 'credits',
    affordable, locked: null, cold: false, downtimeMs: 0, effect: null, workOps: null,
  };
}
